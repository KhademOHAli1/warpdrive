"""Recover a historically admitted main image bundle from GitHub Actions."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile

from candidate import CandidateError, REVISION, require
from component_inputs import InputError, decode
from publication_gate import (
    GitHub, GateError, REPO, WORKFLOW, admitted_artifact, download_verified, publication_policy,
)

ADMISSION_WORKFLOW = "image-candidates.yml"
ADMISSION_JOB = "Verify candidate source and artifact admission"
INSPECT_STEP = "Inspect the same checksum-bound bundle without publishing"
MAX_ADMISSION = 128 * 1024
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


def successful_main_run(api, workflow, run_id, revision, repository_id, *, events):
    identity = api.request(f"repos/{REPO}/actions/workflows/{workflow}")
    run = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(type(identity.get("id")) is int and identity.get("path") == f".github/workflows/{workflow}"
            and run.get("id") == run_id and run.get("workflow_id") == identity["id"]
            and run.get("path") == identity["path"] and run.get("head_sha") == revision
            and run.get("head_branch") == "main" and run.get("event") in events
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and (run.get("repository") or {}).get("id") == repository_id
            and (run.get("head_repository") or {}).get("id") == repository_id
            and type(run.get("run_attempt")) is int and run["run_attempt"] > 0,
            f"Successful same-repository main run required for {workflow}")
    return run


def artifact_for_run(api, run, repository_id, name, *, maximum):
    rows = api.pages(f"repos/{REPO}/actions/runs/{run['id']}/artifacts", "artifacts")
    matches = [row for row in rows if row.get("name") == name]
    require(len(matches) == 1, "Expected a single run-bound artifact")
    artifact = matches[0]
    source = artifact.get("workflow_run") or {}
    require(type(artifact.get("id")) is int and artifact["id"] > 0 and artifact.get("expired") is False
            and type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= maximum
            and isinstance(artifact.get("digest"), str) and DIGEST.fullmatch(artifact["digest"])
            and source.get("id") == run["id"] and source.get("head_sha") == run["head_sha"]
            and source.get("head_branch") == "main" and source.get("repository_id") == repository_id
            and source.get("head_repository_id") == repository_id, "Artifact origin, size or digest differs")
    return {"id": artifact["id"], "name": name, "digest": artifact["digest"], "sizeBytes": artifact["size_in_bytes"]}


def admission_bytes(artifact):
    result = subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip"],
                            capture_output=True, check=False, timeout=60)
    require(result.returncode == 0 and len(result.stdout) == artifact["sizeBytes"]
            and "sha256:" + hashlib.sha256(result.stdout).hexdigest() == artifact["digest"],
            "Historical admission ZIP differs from the API artifact")
    with zipfile.ZipFile(io.BytesIO(result.stdout)) as archive:
        files = archive.infolist()
        require(len(files) == 1 and files[0].filename == "admission.json"
                and 0 < files[0].file_size <= MAX_ADMISSION and not files[0].is_dir()
                and not stat.S_ISLNK(files[0].external_attr >> 16) and not (files[0].flag_bits & 1),
                "Unexpected admission ZIP inventory")
        return archive.read(files[0])


def load_historical_admission(api, run_id, revision, *, fetch=admission_bytes):
    require(type(run_id) is int and run_id > 0 and REVISION.fullmatch(revision),
            "An exact baseline revision and historical admission run are required")
    repository = api.request(f"repos/{REPO}")
    repository_id = repository.get("id")
    require(repository.get("full_name") == REPO and type(repository_id) is int and repository_id > 0,
            "Canonical repository identity required")
    run = successful_main_run(api, ADMISSION_WORKFLOW, run_id, revision, repository_id, events={"workflow_dispatch"})
    attempt = run["run_attempt"]
    jobs = api.pages(f"repos/{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    matches = [job for job in jobs if job.get("name") == ADMISSION_JOB]
    require(len(matches) == 1 and matches[0].get("conclusion") == "success",
            "Historical main admission job did not pass")
    steps = [step for step in matches[0].get("steps", []) if step.get("name") == INSPECT_STEP]
    require(len(steps) == 1 and steps[0].get("conclusion") == "success",
            "Historical admission must have downloaded and verified its bundle")
    artifact = artifact_for_run(api, run, repository_id, f"candidate-admission-{run_id}-{attempt}", maximum=MAX_ADMISSION)
    raw = fetch(artifact)
    doc = decode(raw)
    expected = admitted_artifact(doc, revision)
    policy = publication_policy()["required_workflows"]
    ci = doc.get("ci")
    require(isinstance(ci, list) and len(ci) == len(policy)
            and {row["workflow"]: row["jobs"] for row in ci} == policy
            and isinstance(doc.get("security"), dict), "Historical admission does not cover the full source policy")
    producer = doc["producer"]
    image_run = successful_main_run(api, WORKFLOW, producer["runId"], revision, repository_id,
                                   events={"push", "workflow_dispatch"})
    require(producer == {"runId": image_run["id"], "runAttempt": image_run["run_attempt"], "event": image_run["event"],
                         "ref": "refs/heads/main"}, "Original image producer differs from admission")
    image_name = f"image-bundle-{revision}-{image_run['id']}-{image_run['run_attempt']}"
    from publication_gate import MAX_ZIP_BYTES
    require(expected == artifact_for_run(api, image_run, repository_id, image_name, maximum=MAX_ZIP_BYTES),
            "Original image artifact differs from historical admission")
    return raw, doc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-revision", required=True)
    parser.add_argument("--admission-run-id", type=int, required=True)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--admission-output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        raw, doc = load_historical_admission(GitHub(), args.admission_run_id, args.baseline_revision)
        download_verified(doc, args.bundle_dir, expected_revision=args.baseline_revision)
        with args.admission_output.open("xb") as output:
            output.write(raw)
        print(json.dumps({"admissionSha256": hashlib.sha256(raw).hexdigest(),
                          "baselineRevision": args.baseline_revision, "imageRunId": doc["producer"]["runId"]}))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, zipfile.BadZipFile, subprocess.SubprocessError,
            InputError, GateError, CandidateError) as error:
        print(f"Web baseline verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
