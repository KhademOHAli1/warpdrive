"""Retain and verify tested images without rebuilding or authorizing deployment."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import stat
import sys

from candidate import COMPONENTS, CandidateError, REVISION, create_candidate, load, require, sha256
from image_smoke import Docker, SmokeError

METADATA_FILES = ("candidate.json", "smoke/report.json", *(
    f"inspections/{name}.json" for name in COMPONENTS
))
INPUT_RECEIPT = "component-inputs.json"
ARCHIVE = "core-images.tar"
MANIFEST = "bundle.json"
MAX_METADATA_BYTES = 4 * 1024 ** 2
MAX_ARCHIVE_BYTES = 8 * 1024 ** 3


def metadata_files(version):
    require(type(version) is int and version in {1, 2, 3}, "unsupported bundle/candidate version")
    return METADATA_FILES if version == 1 else (*METADATA_FILES, INPUT_RECEIPT)


def regular_file(root: Path, name: str, maximum: int) -> Path:
    path = root / name
    require(path.resolve().is_relative_to(root.resolve()), "bundle path escapes its directory")
    current = path
    while current != root:
        require(not current.is_symlink(), "bundle symlinks are not admitted")
        current = current.parent
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum,
            f"bundle file has invalid type or size: {name}")
    return path


def reconstruct_candidate(directory: Path, expected_revision: str) -> dict:
    require(isinstance(expected_revision, str) and bool(REVISION.fullmatch(expected_revision)),
            "full expected source revision required")
    directory = directory.resolve()
    regular_file(directory, "candidate.json", MAX_METADATA_BYTES)
    stored = load(directory / "candidate.json")
    require(isinstance(stored, dict), "candidate metadata required")
    inventory = metadata_files(stored.get("schemaVersion"))
    for name in inventory:
        regular_file(directory, name, MAX_METADATA_BYTES)
    report_path = directory / "smoke/report.json"
    inspections = {}
    for name in COMPONENTS:
        rows = load(directory / f"inspections/{name}.json")
        require(isinstance(rows, list) and len(rows) == 1, "one image inspection per component required")
        inspections[name] = rows[0]
    receipt = load(directory / INPUT_RECEIPT) if stored["schemaVersion"] in {2, 3} else None
    candidate = create_candidate(expected_revision, load(report_path), sha256(report_path), inspections,
                                 input_receipt=receipt)
    require(json.dumps(stored, sort_keys=True, allow_nan=False)
            == json.dumps(candidate, sort_keys=True, allow_nan=False),
            "candidate differs from reconstructed final-image evidence")
    return candidate


def validate_origin(origin: dict) -> None:
    require(isinstance(origin, dict), "bundle origin required")
    if origin == {"kind": "local"}:
        return
    require(set(origin) == {"kind", "repository", "runId", "runAttempt", "event", "ref"}
            and origin["kind"] == "github-actions", "invalid bundle origin")
    require(isinstance(origin["repository"], str) and bool(re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", origin["repository"])),
        "invalid origin repository")
    for key in ("runId", "runAttempt"):
        require(type(origin[key]) is int and origin[key] > 0, "positive origin run identity required")
    require(origin["event"] in {"pull_request", "push", "workflow_dispatch"}, "unsupported origin event")
    require(isinstance(origin["ref"], str) and bool(re.fullmatch(
        r"refs/(?:heads/[A-Za-z0-9_./-]+|pull/[1-9][0-9]*/merge)", origin["ref"])),
        "invalid origin ref")


def create_bundle(candidate_dir: Path, output_dir: Path, *, expected_revision: str,
                  docker, origin: dict | None = None) -> dict:
    candidate = reconstruct_candidate(candidate_dir, expected_revision)
    origin = {"kind": "local"} if origin is None else origin
    validate_origin(origin)
    # Refuse to replace any previous accepted or partially-written bundle.
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    inventory = metadata_files(candidate["schemaVersion"])
    for name in inventory:
        destination = output_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate_dir / name, destination)
    identifiers = [candidate["components"][name]["imageId"] for name in COMPONENTS]
    docker.run(["image", "save", "--output", str(output_dir / ARCHIVE), *identifiers], timeout=600)
    archive = regular_file(output_dir, ARCHIVE, MAX_ARCHIVE_BYTES)
    archive.chmod(0o600)
    files = {}
    for name in (*inventory, ARCHIVE):
        path = regular_file(output_dir, name,
                            MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA_BYTES)
        files[name] = {"sha256": sha256(path), "sizeBytes": path.stat().st_size}
    manifest = {"schemaVersion": candidate["schemaVersion"], "kind": "warpdrive-tested-image-bundle",
                "revision": expected_revision, "platform": "linux/amd64",
                "origin": origin, "files": files}
    if candidate["schemaVersion"] in {2, 3}:
        manifest["releaseRevision"] = expected_revision
    with (output_dir / MANIFEST).open("x") as output:
        output.write(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return load_bundle(output_dir, expected_revision=expected_revision)


def load_bundle(directory: Path, *, expected_revision: str) -> dict:
    directory = directory.resolve()
    manifest_path = regular_file(directory, MANIFEST, MAX_METADATA_BYTES)
    manifest = load(manifest_path)
    require(isinstance(manifest, dict), "invalid bundle manifest")
    version = manifest.get("schemaVersion")
    inventory = metadata_files(version)
    require(set(manifest) == {"schemaVersion", "kind", "revision", "platform", "origin", "files"}
            | ({"releaseRevision"} if version in {2, 3} else set()), "invalid bundle manifest")
    require(type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] in {1, 2, 3}
            and manifest["kind"] == "warpdrive-tested-image-bundle", "unsupported bundle schema")
    require(manifest["revision"] == expected_revision and manifest["platform"] == "linux/amd64",
            "bundle source or platform mismatch")
    require(version == 1 or manifest["releaseRevision"] == expected_revision, "bundle release revision differs")
    validate_origin(manifest["origin"])
    files = manifest["files"]
    require(isinstance(files, dict) and set(files) == set((*inventory, ARCHIVE)),
            "complete exact bundle file inventory required")
    for name, record in files.items():
        require(isinstance(record, dict) and set(record) == {"sha256", "sizeBytes"}, "invalid bundle file record")
        require(isinstance(record["sha256"], str) and bool(re.fullmatch(r"[a-f0-9]{64}", record["sha256"]))
                and type(record["sizeBytes"]) is int, "invalid bundle hash or byte count")
        path = regular_file(directory, name,
                            MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA_BYTES)
        require(path.stat().st_size == record["sizeBytes"] and sha256(path) == record["sha256"],
                f"bundle content changed: {name}")
    candidate = reconstruct_candidate(directory, expected_revision)
    require(candidate["schemaVersion"] == version, "candidate and bundle versions differ")
    return {"candidate": candidate, "archivePath": directory / ARCHIVE, "origin": manifest["origin"],
            "provenance": {"archiveSha256": files[ARCHIVE]["sha256"],
                           "bundleManifestSha256": sha256(manifest_path)}}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack")
    pack.add_argument("--candidate-dir", type=Path, required=True)
    pack.add_argument("--output-dir", type=Path, required=True)
    for key in ("repository", "event", "ref"):
        pack.add_argument(f"--{key}")
    for key in ("run-id", "run-attempt"):
        pack.add_argument(f"--{key}", type=int)
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle-dir", type=Path, required=True)
    for command in (pack, verify):
        command.add_argument("--expected-revision", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "pack":
            values = (args.repository, args.run_id, args.run_attempt, args.event, args.ref)
            origin = {"kind": "local"} if not any(value is not None for value in values) else {
                "kind": "github-actions", "repository": args.repository, "runId": args.run_id,
                "runAttempt": args.run_attempt, "event": args.event, "ref": args.ref}
            result = create_bundle(args.candidate_dir, args.output_dir, expected_revision=args.expected_revision,
                                   docker=Docker(), origin=origin)
        else:
            result = load_bundle(args.bundle_dir, expected_revision=args.expected_revision)
        print(json.dumps({"revision": result["candidate"]["revision"], "provenance": result["provenance"],
                          "deploymentAuthorized": False}))
    except (CandidateError, SmokeError, OSError, ValueError, TypeError, KeyError) as error:
        print(f"image bundle rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
