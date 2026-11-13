"""Authenticate and retain an exact-main Web-only artifact for private transfer."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import select
import stat
import subprocess
import sys
import time
import zipfile

from candidate import CandidateError, REVISION, require
from component_inputs import HASH
from publication_gate import (
    CODEQL_WORKFLOW, GateError, GitHub, REPO, WORKFLOW as FULL_WORKFLOW,
    publication_policy, require_selected_main, verify_ci, verify_release_code_scanning,
)
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import ARCHIVE, MANIFEST, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, METADATA, load_web_bundle


WORKFLOW = "web-image-qualification.yml"
JOB = "Qualify exact Web-only image and retain its bytes"
STEPS = ("Run native browser continuity and rollback against retained backend images",
         "Retain exact tested Web image and qualification")
CATEGORIES = {"/language:javascript-typescript", "/language:actions", "/language:python", "/language:go"}
ZIP_NAME = "web-bundle.zip"
RECEIPT_NAME = "receipt.json"
INVENTORY = {name: MAX_METADATA_BYTES for name in (MANIFEST, *METADATA)}
INVENTORY[ARCHIVE] = MAX_ARCHIVE_BYTES
MAX_ZIP_BYTES = sum(INVENTORY.values()) + 64 * 1024 ** 2
CHUNK_BYTES = 1024 ** 2


class PublicGitHub(GitHub):
    def request(self, path):
        return super().request("https://api.github.com/" + path)


def web_policy():
    workflows = publication_policy()["required_workflows"]
    require(FULL_WORKFLOW in workflows and WORKFLOW not in workflows, "ambiguous independent Web source policy")
    return {"required_workflows": {**{name: jobs for name, jobs in workflows.items() if name != FULL_WORKFLOW},
                                   WORKFLOW: [JOB]}}


def admit(api, run_id, revision):
    require_selected_main(api, REPO, revision)
    repository = api.request(f"repos/{REPO}")
    require(isinstance(repository, dict) and repository.get("full_name") == REPO
            and type(repository.get("id")) is int and repository["id"] > 0, "canonical repository identity required")
    repository_id = repository["id"]
    run = successful_main_run(api, WORKFLOW, run_id, revision, repository_id, events={"workflow_dispatch"})
    attempt = run["run_attempt"]
    jobs = api.pages(f"repos/{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    matches = [job for job in jobs if job.get("name") == JOB]
    require(len(matches) == 1, "one exact Web qualification job is required")
    job = matches[0]
    require(type(job.get("id")) is int and job["id"] > 0 and job.get("run_id") == run_id
            and job.get("run_attempt") == attempt and job.get("head_sha") == revision
            and job.get("status") == "completed" and job.get("conclusion") == "success",
            "the selected exact-attempt Web qualification job did not pass")
    for name in STEPS:
        steps = [step for step in job.get("steps", []) if step.get("name") == name]
        require(len(steps) == 1 and steps[0].get("status") == "completed" and steps[0].get("conclusion") == "success",
                "native Web qualification and artifact retention must both pass")
    ci = verify_ci(api, REPO, revision, web_policy(), dynamic_codeql_workflow=CODEQL_WORKFLOW)
    selected = [row for row in ci if row["workflow"] == WORKFLOW]
    require(len(selected) == 1 and selected[0]["run_id"] == run_id and selected[0]["attempt"] == attempt,
            "selected attempt is no longer the latest exact-main Web qualification")
    security = verify_release_code_scanning(api, REPO, revision, categories=CATEGORIES)
    artifact = artifact_for_run(api, run, repository_id, f"web-image-bundle-{revision}-{run_id}-{attempt}",
                                maximum=MAX_ZIP_BYTES)
    require_selected_main(api, REPO, revision)
    origin = {"kind": "github-actions", "repository": REPO, "event": run["event"],
              "ref": "refs/heads/main", "runId": run_id, "runAttempt": attempt}
    return {"origin": origin, "jobId": job["id"], "artifact": artifact, "ci": ci, "security": security}


def private_file(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb")


def copy_bytes(read, target, size):
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = read(min(CHUNK_BYTES, remaining))
        require(bool(chunk) and len(chunk) <= remaining, "artifact byte count differs")
        target.write(chunk)
        digest.update(chunk)
        remaining -= len(chunk)
    require(not read(1), "artifact exceeds its authenticated byte count")
    return digest.hexdigest()


def bounded_read(source, *, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds

    def read(limit):
        remaining = deadline - time.monotonic()
        require(remaining > 0 and select.select([source], [], [], remaining)[0], "artifact download timed out")
        return os.read(source.fileno(), limit)

    return read


def download(artifact, archive):
    """Read bounded stdout once. Never retain gh diagnostics or use an archive URL supplied by the caller."""
    command = ["gh", "api", "--hostname", "github.com", "--method", "GET",
               f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip"]
    with private_file(archive) as output, subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                           stderr=subprocess.DEVNULL) as process:
        try:
            digest = copy_bytes(bounded_read(process.stdout, timeout_seconds=600), output, artifact["sizeBytes"])
            require(process.wait(timeout=5) == 0, "artifact download failed")
            require("sha256:" + digest == artifact["digest"], "downloaded artifact digest differs")
            output.flush()
            os.fsync(output.fileno())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


class ZipReader(io.BufferedReader):
    """Bound metadata reads before ZipFile allocates a central directory."""

    def __init__(self, raw):
        super().__init__(raw)
        self.maximum_read = 128 * 1024
        self.size = os.fstat(raw.fileno()).st_size

    def read(self, size=-1):
        actual = self.size - self.tell() if size < 0 else size
        require(0 <= actual <= self.maximum_read, "ZIP metadata exceeds its read bound")
        return super().read(size)


def extract_verified_zip(archive, destination, artifact):
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with ZipReader(io.FileIO(descriptor, "rb")) as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and 0 < before.st_size == artifact["sizeBytes"] <= MAX_ZIP_BYTES,
                "downloaded artifact size or type differs")
        source.maximum_read = CHUNK_BYTES
        digest = hashlib.file_digest(source, "sha256").hexdigest()
        require("sha256:" + digest == artifact["digest"], "downloaded artifact digest differs")
        source.maximum_read = 128 * 1024
        with zipfile.ZipFile(source) as package:
            items = package.infolist()
            require(len(items) == len(INVENTORY) and {item.filename for item in items} == set(INVENTORY),
                    "unexpected, duplicate or missing Web artifact members")
            for item in items:
                mode = stat.S_IFMT(item.external_attr >> 16)
                require(item.orig_filename == item.filename and not item.is_dir() and mode in (0, stat.S_IFREG)
                        and not (item.flag_bits & 1) and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                        and 0 < item.file_size <= INVENTORY[item.filename], "unsafe or oversized Web artifact member")
            destination.mkdir(mode=0o700)
            source.maximum_read = CHUNK_BYTES
            hashes = {}
            for name in INVENTORY:
                with package.open(name) as stream, private_file(destination / name) as output:
                    hashes[name] = copy_bytes(stream.read, output, package.getinfo(name).file_size)
                    output.flush()
                    os.fsync(output.fileno())
        after = os.fstat(source.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "artifact changed during verification")
    return hashes[MANIFEST]


def retain(api, run_id, revision, baseline_revision, baseline_manifest_sha256, output_dir, *, fetch=download):
    require(type(run_id) is int and run_id > 0 and REVISION.fullmatch(revision)
            and REVISION.fullmatch(baseline_revision) and revision != baseline_revision
            and HASH.fullmatch(baseline_manifest_sha256), "exact run, distinct main and historical baseline pins required")
    require(output_dir.is_absolute() and output_dir.parent == output_dir.parent.resolve(strict=True)
            and not os.path.lexists(output_dir), "fresh canonical output directory required")
    initial = admit(api, run_id, revision)
    output_dir.mkdir(mode=0o700)
    archive, destination = output_dir / ZIP_NAME, output_dir / "bundle"
    fetch(initial["artifact"], archive)
    manifest = extract_verified_zip(archive, destination, initial["artifact"])
    loaded = load_web_bundle(destination, expected_revision=revision, expected_manifest_sha256=manifest,
                             baseline_revision=baseline_revision, baseline_manifest_sha256=baseline_manifest_sha256,
                             expected_origin=initial["origin"])
    latest = admit(api, run_id, revision)
    require(all(initial[name] == latest[name] for name in ("origin", "jobId", "artifact")),
            "authenticated workflow attempt, job or artifact changed while verifying")
    receipt = {"schemaVersion": 1, "kind": "warpdrive-web-publication-admission", "repository": REPO,
               "revision": revision, "workflow": WORKFLOW, **latest, "baseline": loaded["candidate"]["baseline"],
               "image": loaded["candidate"]["image"], "provenance": loaded["provenance"],
               "deploymentAuthorized": False}
    raw = json.dumps(receipt, sort_keys=True, allow_nan=False).encode() + b"\n"
    temporary = output_dir / ("." + RECEIPT_NAME)
    with private_file(temporary) as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, output_dir / RECEIPT_NAME)
    descriptor = os.open(output_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-run-id", type=int, required=True)
    parser.add_argument("--expected-main", required=True)
    parser.add_argument("--baseline-revision", required=True)
    parser.add_argument("--baseline-manifest-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        receipt = retain(PublicGitHub(), args.web_run_id, args.expected_main, args.baseline_revision,
                         args.baseline_manifest_sha256, args.output_dir)
    except CandidateError as error:
        print(f"Web artifact held: {error}", file=sys.stderr)
        return 1
    except (GateError, OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError, zipfile.BadZipFile,
            subprocess.SubprocessError) as error:
        print(f"Web artifact held during API or local verification ({type(error).__name__})", file=sys.stderr)
        return 1
    print(json.dumps(receipt, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
