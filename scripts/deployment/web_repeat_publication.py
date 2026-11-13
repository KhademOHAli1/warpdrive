"""Admit the tested repeat Web image for private off-host custody."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import zipfile

from candidate import CandidateError, IMAGE_ID, REVISION, require
from component_inputs import HASH, content_hash, decode
from publication_gate import (
    CODEQL_WORKFLOW, GateError, REPO, WORKFLOW as FULL_WORKFLOW, publication_policy,
    require_selected_main, verify_ci, verify_release_code_scanning,
)
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import _input_file
from web_composite_baseline import verify_web_composite_baseline
from web_publication_gate import CATEGORIES, CHUNK_BYTES, PublicGitHub, ZipReader, copy_bytes, download, private_file
from web_repeat_candidate import ARCHIVE, MANIFEST, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, METADATA, load_repeat_web_bundle


WORKFLOW = "web-repeat-qualification.yml"
JOB = "Qualify repeat Web image with the retained Core bundle"
STEPS = (
    "Authenticate the independent Web and Core baseline artifacts",
    "Verify exact source and unchanged retained component inputs",
    "Build exactly one repeat Web image",
    "Qualify native browser continuity and retain the tested repeat image",
    "Recheck selected main before retaining the repeat artifact",
    "Retain exact tested repeat Web artifact",
)
ZIP_NAME = "web-repeat-bundle.zip"
RECEIPT_NAME = "receipt.json"
INVENTORY = {name: MAX_METADATA_BYTES for name in (MANIFEST, *METADATA)} | {ARCHIVE: MAX_ARCHIVE_BYTES}
MAX_ZIP_BYTES = sum(INVENTORY.values()) + 64 * 1024 ** 2


def repeat_policy():
    workflows = publication_policy()["required_workflows"]
    require(FULL_WORKFLOW in workflows and WORKFLOW not in workflows, "Ambiguous repeat Web source policy")
    return {"required_workflows": {**{name: jobs for name, jobs in workflows.items() if name != FULL_WORKFLOW},
                                   WORKFLOW: [JOB]}}


def admit(api, run_id, revision):
    require(type(run_id) is int and run_id > 0 and isinstance(revision, str) and REVISION.fullmatch(revision),
            "Exact repeat workflow run and main revision required")
    require_selected_main(api, REPO, revision)
    repository = api.request(f"repos/{REPO}")
    require(type(repository) is dict and repository.get("full_name") == REPO
            and type(repository.get("id")) is int and repository["id"] > 0, "Canonical repository identity required")
    repository_id = repository["id"]
    run = successful_main_run(api, WORKFLOW, run_id, revision, repository_id, events={"workflow_dispatch"})
    attempt = run["run_attempt"]
    rows = api.pages(f"repos/{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    jobs = [row for row in rows if type(row) is dict and row.get("name") == JOB]
    require(len(jobs) == 1, "Unique repeat Web qualification job required")
    job = jobs[0]
    require(type(job.get("id")) is int and job["id"] > 0 and type(job.get("run_id")) is int and job["run_id"] == run_id
            and type(job.get("run_attempt")) is int and job["run_attempt"] == attempt and job.get("head_sha") == revision
            and job.get("status") == "completed" and job.get("conclusion") == "success",
            "Selected exact-attempt repeat Web qualification job did not pass")
    steps = job.get("steps")
    require(type(steps) is list and all(type(row) is dict for row in steps), "Exact hosted repeat steps required")
    for name in STEPS:
        matched = [row for row in steps if row.get("name") == name]
        require(len(matched) == 1 and matched[0].get("status") == "completed" and matched[0].get("conclusion") == "success",
                "A required repeat Web source, image, browser or retention step did not pass")
    ci = verify_ci(api, REPO, revision, repeat_policy(), dynamic_codeql_workflow=CODEQL_WORKFLOW)
    selected = [row for row in ci if row["workflow"] == WORKFLOW]
    require(len(selected) == 1 and selected[0]["run_id"] == run_id and selected[0]["attempt"] == attempt,
            "Selected attempt is no longer the latest exact-main repeat qualification")
    security = verify_release_code_scanning(api, REPO, revision, categories=CATEGORIES)
    name = f"web-repeat-image-bundle-{revision}-{run_id}-{attempt}"
    artifact = artifact_for_run(api, run, repository_id, name, maximum=MAX_ZIP_BYTES)
    require_selected_main(api, REPO, revision)
    origin = {"kind": "github-actions", "repository": REPO, "event": run["event"],
              "ref": "refs/heads/main", "runId": run_id, "runAttempt": attempt}
    return {"origin": origin, "jobId": job["id"], "artifact": artifact, "ci": ci, "security": security}


def extract_verified_zip(archive, destination, artifact):
    """Bind retained bytes to the API checksum before parsing the fixed ZIP inventory."""
    require(type(artifact.get("sizeBytes")) is int and 0 < artifact["sizeBytes"] <= MAX_ZIP_BYTES
            and isinstance(artifact.get("digest"), str) and IMAGE_ID.fullmatch(artifact["digest"]),
            "Exact repeat artifact ZIP size and digest required")
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with ZipReader(io.FileIO(descriptor, "rb")) as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == artifact["sizeBytes"],
                "Repeat artifact ZIP size or type differs")
        source.maximum_read = CHUNK_BYTES
        digest = hashlib.file_digest(source, "sha256").hexdigest()
        require("sha256:" + digest == artifact["digest"], "Repeat artifact ZIP digest differs")
        source.maximum_read = 128 * 1024
        with zipfile.ZipFile(source) as package:
            members = package.infolist()
            require(len(members) == len(INVENTORY) and {item.filename for item in members} == set(INVENTORY),
                    "Unexpected, duplicate or missing repeat artifact ZIP members")
            for item in members:
                mode = stat.S_IFMT(item.external_attr >> 16)
                require(item.orig_filename == item.filename and not item.is_dir() and mode in (0, stat.S_IFREG)
                        and not (item.flag_bits & 1) and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                        and 0 < item.file_size <= INVENTORY[item.filename], "Unsafe or oversized repeat ZIP member")
            destination.mkdir(mode=0o700)
            source.maximum_read = CHUNK_BYTES
            manifest_sha256 = None
            for name in INVENTORY:
                with package.open(name) as stream, private_file(destination / name) as target:
                    actual = copy_bytes(stream.read, target, package.getinfo(name).file_size)
                    target.flush()
                    os.fsync(target.fileno())
                if name == MANIFEST:
                    manifest_sha256 = actual
        after, named = os.fstat(source.fileno()), archive.lstat()
        def identity(info):
            return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        require(identity(before) == identity(after) == identity(named), "Repeat artifact ZIP changed during verification")
    _fsync_directory(destination)
    return manifest_sha256


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def retain(
    api, run_id, revision, output_dir, *, composite, installed_lineage, expected_installed_lineage_sha256,
    expected_profile_sha256, expected_harness_revision, expected_tooling_revision, fetch=download,
):
    """Keep unchanged GitHub ZIP bytes and emit a receipt after exact local readback."""
    require(type(installed_lineage) is dict and isinstance(expected_installed_lineage_sha256, str)
            and HASH.fullmatch(expected_installed_lineage_sha256)
            and content_hash(installed_lineage) == expected_installed_lineage_sha256,
            "Independently admitted full installed Web lineage required")
    require(isinstance(expected_profile_sha256, str) and HASH.fullmatch(expected_profile_sha256)
            and all(isinstance(pin, str) and REVISION.fullmatch(pin)
                    for pin in (expected_harness_revision, expected_tooling_revision)),
            "Exact protected presentation profile, harness and tooling pins required")
    output_dir = Path(output_dir)
    require(output_dir.is_absolute() and output_dir.parent == output_dir.parent.resolve(strict=True)
            and not os.path.lexists(output_dir), "Fresh canonical repeat output directory required")
    initial = admit(api, run_id, revision)
    output_dir.mkdir(mode=0o700)
    archive, destination = output_dir / ZIP_NAME, output_dir / "bundle"
    fetch(initial["artifact"], archive)
    manifest_sha256 = extract_verified_zip(archive, destination, initial["artifact"])
    loaded = load_repeat_web_bundle(
        destination, expected_revision=revision, expected_manifest_sha256=manifest_sha256,
        composite=composite, installed_lineage=installed_lineage, expected_installed_lineage_sha256=expected_installed_lineage_sha256,
        expected_profile_sha256=expected_profile_sha256, expected_harness_revision=expected_harness_revision,
        expected_tooling_revision=expected_tooling_revision, expected_origin=initial["origin"],
    )
    latest = admit(api, run_id, revision)
    require(all(initial[name] == latest[name] for name in ("origin", "jobId", "artifact")),
            "Authenticated repeat workflow attempt, job or artifact changed while verifying")
    candidate = loaded["candidate"]
    receipt = {"schemaVersion": 2, "kind": "warpdrive-web-repeat-publication-admission", "repository": REPO,
               "revision": revision, "workflow": WORKFLOW, **latest, "baseline": candidate["baseline"],
               "image": candidate["image"], "provenance": loaded["provenance"], "qualification": candidate["qualification"],
               "presentationProfileSha256": expected_profile_sha256, "harnessRevision": expected_harness_revision,
               "toolingRevision": expected_tooling_revision, "deploymentAuthorized": False}
    raw = json.dumps(receipt, sort_keys=True, allow_nan=False).encode() + b"\n"
    temporary = output_dir / ("." + RECEIPT_NAME)
    with private_file(temporary) as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, output_dir / RECEIPT_NAME)
    _fsync_directory(output_dir)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="command", required=True).add_parser("retain")
    command.add_argument("--repeat-run-id", type=int, required=True)
    for name in ("expected-main", "expected-profile-sha256", "expected-harness-revision", "expected-tooling-revision",
                 "expected-installed-lineage-sha256", "web-receipt-sha256", "core-manifest-sha256"):
        command.add_argument("--" + name, required=True)
    for name in ("installed-lineage", "web-receipt", "active-web-bundle-dir", "core-bundle-dir", "output-dir"):
        command.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        lineage = decode(_input_file(args.installed_lineage))
        composite = verify_web_composite_baseline(
            web_receipt=_input_file(args.web_receipt), expected_web_receipt_sha256=args.web_receipt_sha256,
            web_bundle_dir=args.active_web_bundle_dir, backend_bundle_dir=args.core_bundle_dir,
            expected_backend_manifest_sha256=args.core_manifest_sha256,
        )
        receipt = retain(PublicGitHub(), args.repeat_run_id, args.expected_main, args.output_dir, composite=composite,
                         installed_lineage=lineage, expected_installed_lineage_sha256=args.expected_installed_lineage_sha256,
                         expected_profile_sha256=args.expected_profile_sha256, expected_harness_revision=args.expected_harness_revision,
                         expected_tooling_revision=args.expected_tooling_revision)
    except CandidateError as error:
        print(f"Repeat Web artifact held: {error}", file=sys.stderr)
        return 1
    except (GateError, OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError,
            zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print(f"Repeat Web artifact held during API or local verification ({type(error).__name__})", file=sys.stderr)
        return 1
    print(json.dumps(receipt, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
