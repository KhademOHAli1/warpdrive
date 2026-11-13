"""Read-only main/CI admission and verified artifact download for candidate publication."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import zipfile

from bundle import ARCHIVE, MANIFEST, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, METADATA_FILES, load_bundle, metadata_files, regular_file
from candidate import CandidateError, REVISION, require
from component_inputs import InputError, decode as decode_inputs

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "delivery"))
from release_gates import verify_ci
from release_security import require_selected_main, verify_release_code_scanning
from release_support import GateError, GitHub, REPO, load_json

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = "production-images.yml"
CODEQL_WORKFLOW = "403980173"
MAX_ZIP_BYTES = MAX_ARCHIVE_BYTES + 64 * 1024 ** 2


def publication_policy(root: Path = ROOT) -> dict:
    # Add image gates to the existing full source policy; do not replace its scope.
    policy = load_json(root / "docs/delivery/release-policy.json")
    technical = load_json(root / "docs/delivery/technical-acceptance-policy.json")
    require(policy.get("repository") == REPO and technical.get("repository") == REPO,
            "publication policy repository mismatch")
    workflows = {key: list(value) for key, value in policy["required_workflows"].items()}
    additions = {
        "ci.yml": ["CRM checks", "Marketing site checks", "Documentation site checks"],
        "required-quality.yml": ["Browser smoke checks"],
        WORKFLOW: ["Deployment tooling checks", "Final production image smoke"],
        CODEQL_WORKFLOW: ["Analyze (javascript-typescript)", "Analyze (actions)", "Analyze (python)", "Analyze (go)"],
    }
    require(CODEQL_WORKFLOW in technical["required_workflows"], "managed CodeQL policy missing")
    for key, jobs in additions.items():
        workflows[key] = list(dict.fromkeys(workflows.get(key, []) + jobs))
    return {"required_workflows": workflows}


def admit(api, run_id: int, expected_main: str, *, policy: dict | None = None) -> dict:
    require(type(run_id) is int and run_id > 0, "positive image workflow run ID required")
    require(isinstance(expected_main, str) and bool(REVISION.fullmatch(expected_main)), "full expected main revision required")
    require_selected_main(api, REPO, expected_main)
    repository = api.request(f"repos/{REPO}")
    require(isinstance(repository, dict), "repository identity unavailable")
    repository_id = repository.get("id")
    require(type(repository_id) is int and repository_id > 0 and repository.get("full_name") == REPO,
            "repository identity unavailable")
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    require(isinstance(workflow, dict) and type(workflow.get("id")) is int and workflow["id"] > 0,
            "producer workflow identity unavailable")
    run = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(isinstance(run, dict) and run.get("id") == run_id and run.get("workflow_id") == workflow.get("id")
            and run.get("path") == f".github/workflows/{WORKFLOW}"
            and run.get("head_sha") == expected_main and run.get("head_branch") == "main"
            and run.get("event") in {"push", "workflow_dispatch"}
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and (run.get("repository") or {}).get("id") == repository_id
            and (run.get("head_repository") or {}).get("id") == repository_id,
            "only successful same-repository exact-main image runs may publish candidates")
    attempt = run.get("run_attempt")
    require(type(attempt) is int and attempt > 0, "producer run attempt missing")
    ci = verify_ci(api, REPO, expected_main, publication_policy() if policy is None else policy,
                   dynamic_codeql_workflow=CODEQL_WORKFLOW)
    image_checks = [row for row in ci if row["workflow"] == WORKFLOW]
    require(len(image_checks) == 1 and image_checks[0]["run_id"] == run_id,
            "selected image run is not the latest accepted exact-main qualification")
    security = verify_release_code_scanning(api, REPO, expected_main, categories={
        "/language:javascript-typescript", "/language:actions", "/language:python", "/language:go"})
    name = f"image-bundle-{expected_main}-{run_id}-{attempt}"
    artifacts = api.pages(f"repos/{REPO}/actions/runs/{run_id}/artifacts", "artifacts")
    matches = [item for item in artifacts if isinstance(item, dict) and item.get("name") == name]
    require(len(matches) == 1, "one unambiguous tested image bundle is required")
    artifact = matches[0]
    identity = artifact.get("workflow_run") or {}
    digest = artifact.get("digest")
    require(type(artifact.get("id")) is int and artifact["id"] > 0 and artifact.get("expired") is False
            and type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= MAX_ZIP_BYTES
            and isinstance(digest, str) and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", digest))
            and identity.get("id") == run_id and identity.get("head_sha") == expected_main
            and identity.get("head_branch") == "main" and identity.get("repository_id") == repository_id
            and identity.get("head_repository_id") == repository_id,
            "artifact provenance, digest, size or retention is invalid")
    require_selected_main(api, REPO, expected_main)
    return {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
            "repository": REPO, "revision": expected_main,
            "producer": {"runId": run_id, "runAttempt": attempt, "event": run["event"], "ref": "refs/heads/main"},
            "artifact": {"id": artifact["id"], "name": name, "digest": digest, "sizeBytes": artifact["size_in_bytes"]},
            "ci": ci, "security": security, "deploymentAuthorized": False}


def validate_zip_inventory(source):
    allowed_dirs = {"smoke/", "inspections/"}
    items = source.infolist()
    require(len(items) <= len(metadata_files(2)) + 2 + len(allowed_dirs), "artifact has unexpected entries")
    names = [item.filename for item in items]
    require(len(set(names)) == len(names), "duplicate artifact members are not admitted")
    require(MANIFEST in names, "artifact manifest is missing")
    header = source.getinfo(MANIFEST)
    require(not header.is_dir() and 0 < header.file_size <= MAX_METADATA_BYTES
            and not stat.S_ISLNK(header.external_attr >> 16) and not (header.flag_bits & 1), "unsafe artifact manifest")
    with source.open(header) as stream:
        raw_manifest = stream.read(MAX_METADATA_BYTES + 1)
    require(len(raw_manifest) <= MAX_METADATA_BYTES, "artifact manifest exceeds byte budget")
    try:
        manifest = decode_inputs(raw_manifest)
    except InputError as error:
        raise CandidateError("invalid artifact manifest JSON") from error
    require(isinstance(manifest, dict), "artifact manifest object required")
    inventory = (*metadata_files(manifest.get("schemaVersion")), ARCHIVE, MANIFEST)
    allowed = set(inventory)
    require(set(names) - allowed_dirs == allowed, "artifact file inventory differs from tested bundle")
    for item in items:
        require(item.filename in allowed or (item.is_dir() and item.filename in allowed_dirs), "unsafe artifact path")
        mode = item.external_attr >> 16
        require(not stat.S_ISLNK(mode) and not (item.flag_bits & 1), "artifact symlinks/encryption are not admitted")
        limit = MAX_ARCHIVE_BYTES if item.filename == ARCHIVE else MAX_METADATA_BYTES
        require(0 <= item.file_size <= limit, "artifact member exceeds its byte budget")
    return inventory


def extract_bundle_zip(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as source:
        inventory = validate_zip_inventory(source)
        destination.mkdir(parents=True, exist_ok=False, mode=0o700)
        # Only source-controlled names reach the filesystem, never an archive-provided path.
        for name in sorted(inventory):
            item = source.getinfo(name)
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as stream, target.open("xb") as output:
                shutil.copyfileobj(stream, output, length=1024 * 1024)


def admitted_artifact(admission: dict, expected_revision: str) -> dict:
    require(admission.get("schemaVersion") == 1
            and admission.get("kind") == "warpdrive-candidate-publication-admission"
            and admission.get("repository") == REPO and admission.get("revision") == expected_revision
            and admission.get("deploymentAuthorized") is False, "invalid publication admission")
    artifact = admission.get("artifact") or {}
    identifier = artifact.get("id")
    digest = artifact.get("digest")
    size = artifact.get("sizeBytes")
    require(type(identifier) is int and identifier > 0 and isinstance(digest, str)
            and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", digest))
            and type(size) is int and 0 < size <= MAX_ZIP_BYTES, "invalid admitted artifact")
    return artifact


def verify_downloaded(admission: dict, destination: Path, *, expected_revision: str) -> dict:
    artifact = admitted_artifact(admission, expected_revision)
    archive = destination.with_name(destination.name + ".zip")
    regular_file(archive.parent, archive.name, MAX_ZIP_BYTES)
    require(archive.stat().st_size == artifact["sizeBytes"], "downloaded artifact size changed")
    hashed = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hashed.update(chunk)
    require("sha256:" + hashed.hexdigest() == artifact["digest"], "downloaded artifact digest changed")
    with zipfile.ZipFile(archive) as source:
        validate_zip_inventory(source)
        trusted_manifest = source.read(MANIFEST)
    manifest_path = regular_file(destination.resolve(), MANIFEST, MAX_METADATA_BYTES)
    require(manifest_path.read_bytes() == trusted_manifest,
            "bundle manifest differs from the API-bound artifact ZIP")
    loaded = load_bundle(destination, expected_revision=expected_revision)
    origin = {"kind": "github-actions", "repository": REPO, **admission["producer"]}
    require(loaded["origin"] == origin, "bundle's producer differs from admitted workflow")
    return loaded


def download_verified(admission: dict, destination: Path, *, expected_revision: str,
                      runner=subprocess.run) -> dict:
    artifact = admitted_artifact(admission, expected_revision)
    require(not destination.exists(), "bundle destination already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    archive = destination.with_name(destination.name + ".zip")
    with archive.open("xb") as output:
        result = runner(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip"],
                        stdout=output, stderr=subprocess.PIPE, check=False, timeout=600)
    require(result.returncode == 0, "artifact download failed; no automatic retry performed")
    require(archive.stat().st_size == artifact["sizeBytes"], "downloaded artifact size changed")
    hashed = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hashed.update(chunk)
    require("sha256:" + hashed.hexdigest() == artifact["digest"], "downloaded artifact digest changed")
    extract_bundle_zip(archive, destination)
    return verify_downloaded(admission, destination, expected_revision=expected_revision)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    gate = commands.add_parser("admit")
    gate.add_argument("--image-run-id", type=int, required=True)
    gate.add_argument("--output", type=Path, required=True)
    download = commands.add_parser("download")
    download.add_argument("--admission", type=Path, required=True)
    download.add_argument("--bundle-dir", type=Path, required=True)
    for command in (gate, download):
        command.add_argument("--expected-main", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "admit":
            result = admit(GitHub(), args.image_run_id, args.expected_main)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x") as output:
                output.write(json.dumps(result, sort_keys=True, indent=2) + "\n")
        else:
            result = download_verified(load_json(args.admission), args.bundle_dir, expected_revision=args.expected_main)
        print(json.dumps({"revision": args.expected_main, "deploymentAuthorized": False,
                          "scope": "candidate artifact admission only; release/installation acceptance remains separate"}))
    except (CandidateError, GateError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile,
            subprocess.TimeoutExpired) as error:
        print(f"candidate publication held: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
