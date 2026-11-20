"""Retain or verify the exact private Actions ZIPs used for the headless rollout."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from candidate import CandidateError, REVISION, require
from component_inputs import HASH, decode
from publication_gate import GateError, REPO, require_selected_main
from web_custody_workflow import number, registry_auth
from web_publication_gate import MAX_ZIP_BYTES, PublicGitHub, download
from web_release_build import checkout, git, write_metadata
from web_release_custody import REPOSITORY, custody_manifest, manifest_digest, publish


WORKFLOW_PATH = ".github/workflows/headless-web-artifact-custody.yml"
PRODUCER_PATH = ".github/workflows/headless-1-8-1-image-qualification.yml"
PRODUCER_BRANCH = "codex/headless-1.8.1-image-qualification"
PRODUCER_WORKFLOW_ID = 425294484
SOURCES = (
    ("core-and-web-1.8.1", "scripts/deployment/headless-web-baseline.json", ("artifact",),
     "Test actual 1.8.1 images on isolated PostgreSQL", (
         "Exercise final images on the owned fixture",
         "Save the exact tested Core and Web images",
         "Retain both tested images",
     )),
    ("web-1.8.2", "docs/deployment-evidence/headless-web-rollout-20261120.json", ("web", "imageArtifact"),
     "Qualify 1.8.2 Web with retained 1.8.1 Core", (
         "Exercise the 1.8.2 Web image with the pinned 1.8.1 backend",
         "Recheck exact main and save the tested Web image only",
         "Retain the exact Web image and its verified identities",
     )),
)


def require_hosted(environment):
    revision = environment.get("GITHUB_SHA", "")
    require(environment.get("GITHUB_ACTIONS") == "true"
            and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO
            and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and environment.get("GITHUB_WORKFLOW_REF") == f"{REPO}/{WORKFLOW_PATH}@refs/heads/main"
            and REVISION.fullmatch(revision), "Exact hosted custody workflow on canonical main required")
    fields = [environment.get(f"GITHUB_RUN_{key}", "") for key in ("ID", "ATTEMPT")]
    require(all(re.fullmatch(r"[1-9][0-9]{0,14}", value) for value in fields), "Exact custody run identity required")
    return revision, int(fields[0]), int(fields[1])


def artifact_pin(value, role):
    require(isinstance(value, dict), "Committed artifact binding must be an object")
    checksum = value.get("zipSha256")
    checksum = checksum.removeprefix("sha256:") if isinstance(checksum, str) else ""
    require(all(number(value.get(key)) for key in ("id", "runId", "runAttempt", "sizeBytes"))
            and value["sizeBytes"] <= MAX_ZIP_BYTES
            and isinstance(value.get("headSha"), str) and REVISION.fullmatch(value["headSha"])
            and value.get("headBranch") == PRODUCER_BRANCH and value.get("workflowPath") == PRODUCER_PATH
            and HASH.fullmatch(checksum), "Committed historical Actions artifact binding differs")
    names = {
        "core-and-web-1.8.1": f"warpdrive-181-tested-images-{value['runAttempt']}",
        "web-1.8.2": f"warpdrive-182-tested-web-{value['runId']}-{value['runAttempt']}",
    }
    require(value.get("name") == names[role], "Artifact name does not bind the original run attempt")
    fields = ("id", "name", "runId", "runAttempt", "headSha", "headBranch", "workflowPath", "sizeBytes")
    return {**{key: value[key] for key in fields}, "digest": f"sha256:{checksum}"}


def source_pins(root, revision):
    selected = []
    for role, path, keys, job, steps in SOURCES:
        value = decode(git(root, "show", f"{revision}:{path}"))
        for key in keys:
            require(isinstance(value, dict) and key in value, f"Missing committed {role} artifact binding")
            value = value[key]
        selected.append((role, artifact_pin(value, role), job, steps))
    for key in ("id", "digest", "runId"):
        require(len({pin[key] for _, pin, _, _ in selected}) == len(SOURCES), "Duplicate custody inputs")
    return selected


def successful(value):
    return value.get("status") == "completed" and value.get("conclusion") == "success"


def producer_readback(api, repository_id, pin, job_name, step_names, *, retaining):
    actions = f"repos/{REPO}/actions/runs/{pin['runId']}"
    attempt = f"{actions}/attempts/{pin['runAttempt']}"
    run = api.request(attempt)
    require(isinstance(run, dict) and successful(run) and run.get("id") == pin["runId"]
            and run.get("run_attempt") == pin["runAttempt"] and run.get("event") == "push"
            and run.get("workflow_id") == PRODUCER_WORKFLOW_ID and run.get("path") == pin["workflowPath"]
            and run.get("head_sha") == pin["headSha"] and run.get("head_branch") == pin["headBranch"]
            and (run.get("repository") or {}).get("id") == repository_id
            and (run.get("head_repository") or {}).get("id") == repository_id,
            "Historical producer attempt differs from the committed artifact origin")
    jobs = api.request(f"{attempt}/jobs?per_page=10")
    require(isinstance(jobs, dict) and isinstance(jobs.get("jobs"), list)
            and jobs.get("total_count") == len(jobs["jobs"]) == 1, "Expected one complete producer job")
    job = jobs["jobs"][0]
    require(isinstance(job, dict) and job.get("name") == job_name and successful(job)
            and number(job.get("id")) and job.get("run_id") == pin["runId"]
            and job.get("run_attempt") == pin["runAttempt"] and job.get("head_sha") == pin["headSha"],
            "Exact historical source retention job did not pass")
    steps = job.get("steps")
    require(isinstance(steps, list) and all(isinstance(step, dict) for step in steps),
            "Producer step evidence is unavailable")
    for name in step_names:
        matching = [step for step in steps if step.get("name") == name]
        require(len(matching) == 1 and successful(matching[0]), "Original image smoke, save or retention did not pass")
    artifacts = api.request(f"{actions}/artifacts?per_page=30")
    require(isinstance(artifacts, dict) and isinstance(artifacts.get("artifacts"), list)
            and len(artifacts["artifacts"]) == artifacts.get("total_count") <= 30
            and all(isinstance(row, dict) for row in artifacts["artifacts"]),
            "Complete producer artifact metadata required")
    matches = [row for row in artifacts["artifacts"] if row.get("id") == pin["id"] or row.get("name") == pin["name"]]
    require(len(matches) <= 1 and (matches or not retaining), "Expected one exact non-expired Actions artifact")
    if not matches:
        # Observe can read private custody after GitHub removes the expiring original.
        return {"jobId": job["id"], "actionsArtifact": "absent"}
    artifact = matches[0]
    origin = artifact.get("workflow_run") or {}
    require(artifact.get("id") == pin["id"] and artifact.get("name") == pin["name"]
            and artifact.get("digest") == pin["digest"] and artifact.get("size_in_bytes") == pin["sizeBytes"]
            and type(artifact.get("expired")) is bool and (not retaining or not artifact["expired"])
            and origin == {"id": pin["runId"], "head_sha": pin["headSha"], "head_branch": pin["headBranch"],
                           "repository_id": repository_id, "head_repository_id": repository_id},
            "Actions artifact metadata differs from the committed bytes or producer")
    return {"jobId": job["id"], "actionsArtifact": "expired" if artifact["expired"] else "verified"}


def execute(api, identity, mode, oras, workspace, runner_temp, evidence):
    revision, run_id, run_attempt = identity
    require_selected_main(api, REPO, revision)
    repository = api.request(f"repos/{REPO}")
    require(isinstance(repository, dict) and repository.get("full_name") == REPO
            and number(repository.get("id")), "Canonical repository identity required")
    selected = source_pins(workspace, revision)
    retaining = mode == "retain"
    verified_sources = [producer_readback(api, repository["id"], pin, job, steps, retaining=retaining)
                        for _, pin, job, steps in selected]
    if retaining:
        available = shutil.disk_usage(runner_temp).free
        required = 2 * sum(pin["sizeBytes"] for _, pin, _, _ in selected) + 1024**3
        require(available >= required, "Insufficient private runner storage to retain both ZIPs")
    common = {"schemaVersion": 1, "kind": "warpdrive-headless-web-artifact-custody",
              "repository": REPOSITORY, "revision": revision, "runId": run_id, "runAttempt": run_attempt,
              "mode": mode, "deploymentAuthorized": False}
    objects = []
    failures = []
    with tempfile.TemporaryDirectory(prefix="headless-web-custody.", dir=runner_temp) as directory:
        private = Path(directory)
        originals = private / "originals"
        if retaining:
            originals.mkdir(mode=0o700)
            for role, pin, _, _ in selected:
                download(pin, originals / f"{role}.zip")
        with registry_auth(runner_temp):
            for (role, pin, _, _), source in zip(selected, verified_sources):
                require_selected_main(api, REPO, revision)
                options = {"kind": "archive", "digest": pin["digest"], "size": pin["sizeBytes"]}
                manifest = manifest_digest(custody_manifest(**options))
                facts = {"role": role, "source": {**pin, **source}, "reference": f"{REPOSITORY}@{manifest}"}
                write_metadata(evidence / f"{role}.started.json", {**common, **facts, "status": "readback-pending"})
                try:
                    result = publish(oras, private / f"{role}.oci", originals / f"{role}.zip" if retaining else None,
                                     observe_only=not retaining, **options)
                    require(result == manifest, "Immutable custody readback returned a different manifest digest")
                except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
                    write_metadata(evidence / f"{role}.held.json", {**common, **facts, "status": "held",
                                                                  "failureClass": type(error).__name__})
                    if retaining:
                        raise
                    failures.append(role)
                    continue
                write_metadata(evidence / f"{role}.verified.json", {**common, **facts, "status": "verified"})
                objects.append(facts)
                print(f"Verified private custody {facts['reference']}", flush=True)
    require_selected_main(api, REPO, revision)
    require(not failures, "Private custody could not be verified for " + ", ".join(failures))
    write_metadata(evidence / "result.json", {**common, "status": "verified", "objects": objects})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("retain", "observe"))
    parser.add_argument("--oras", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        identity = require_hosted(os.environ)
        workspace = Path(os.environ["GITHUB_WORKSPACE"])
        checkout(workspace, identity[0])
        runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
        oras = args.oras
        require(oras.is_absolute() and oras == oras.resolve(strict=True) and oras.is_file()
                and oras.name == "oras" and oras.parent.parent == runner_temp
                and oras.parent.name.startswith("custody-oras."), "Verified private ORAS executable required")
        evidence = runner_temp / "headless-web-custody-evidence"
        evidence.mkdir(mode=0o700)
        execute(PublicGitHub(), identity, args.mode, oras, workspace, runner_temp, evidence)
    except (CandidateError, GateError, OSError, RuntimeError, ValueError, KeyError, TypeError,
            AttributeError, subprocess.SubprocessError) as error:
        print(f"Headless custody held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
