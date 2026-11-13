"""Coordinate the one-time hosted custody bootstrap and independent readback."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from candidate import REVISION, require
from publication_gate import REPO, require_selected_main
from registry_absence import precheck_custody_manifest
from web_publication_gate import PublicGitHub
from web_release_build import checkout, write_metadata
from web_release_custody import REPOSITORY, _verify_anonymous_denied, custody_manifest, manifest_digest, publish, verified_bytes

WORKFLOW = "web-release-custody.yml"
WORKFLOW_PATH = f".github/workflows/{WORKFLOW}"
BOOTSTRAP_JOB = "Bootstrap verified Web artifact custody"
WRITE_STEP = "Publish the three pinned custody objects"
RESUME_STEP = "Resume only missing pinned custody objects"
NOT_STARTED = {"queued", "pending", "requested", "waiting"}
MAX_HISTORY = 100
OBJECTS = (
    ("core.zip", "archive", "3af03220eb57f1fe3d1dc76acd8d838a9afc15ee3333cfe1954af7386c9b4d63", 1181930029),
    ("web-bundle.zip", "archive", "e6c1698ede466fa5306a53095af6992370e2eb70f08478aeb1a24f328d682fec", 1153846880),
    ("core-admission.json", "receipt", "baecbd9e5ac8a27a9948c43fc5bd16fef4b3e268c55b92ff6061f88f7664e3d8", 3212),
)


def number(value):
    return type(value) is int and 0 < value <= 10**15


def require_hosted(environment):
    revision = environment.get("GITHUB_SHA", "")
    require(environment.get("GITHUB_ACTIONS") == "true"
            and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO
            and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and environment.get("GITHUB_WORKFLOW_REF") == f"{REPO}/{WORKFLOW_PATH}@refs/heads/main"
            and REVISION.fullmatch(revision),
            "Exact hosted custody workflow on canonical main required")
    values = [environment.get(f"GITHUB_RUN_{key}", "") for key in ("ID", "ATTEMPT", "NUMBER")]
    require(all(re.fullmatch(r"[1-9][0-9]{0,14}", value) for value in values), "Bounded run identity required")
    return revision, *(int(value) for value in values)


def run_identity(row, workflow_id, repository_id):
    return (isinstance(row, dict) and number(row.get("id")) and number(row.get("run_number"))
            and number(row.get("run_attempt")) and row["run_attempt"] <= MAX_HISTORY
            and row.get("workflow_id") == workflow_id and row.get("path") == WORKFLOW_PATH
            and row.get("event") == "workflow_dispatch" and isinstance(row.get("head_branch"), str)
            and isinstance(row.get("head_sha"), str) and REVISION.fullmatch(row["head_sha"])
            and (row.get("repository") or {}).get("id") == repository_id
            and (row.get("head_repository") or {}).get("id") == repository_id)


def require_no_write_in_attempt(api, run, attempt):
    doc = api.request(f"repos/{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=20")
    jobs = doc.get("jobs")
    require(isinstance(jobs, list) and type(doc.get("total_count")) is int
            and len(jobs) == doc["total_count"] <= 2
            and all(isinstance(job, dict) and job.get("run_id") == run["id"]
                    and job.get("run_attempt") == attempt and job.get("head_sha") == run["head_sha"]
                    for job in jobs), "Complete custody job history required")
    latest_pending = attempt == run["run_attempt"] and run.get("status") in NOT_STARTED
    if latest_pending and all(job.get("status") in NOT_STARTED and job.get("steps") in (None, [])
                              and job.get("conclusion") is None for job in jobs):
        return
    matches = [job for job in jobs if job.get("name") == BOOTSTRAP_JOB]
    require(len(matches) == 1, "Prior bootstrap job is missing or ambiguous")
    job = matches[0]
    require(job.get("status") == "completed", "Earlier bootstrap remains active or uncertain")
    if job.get("conclusion") == "skipped":
        require(not job.get("steps"), "Skipped bootstrap reports unexpected step activity")
        return
    steps = job.get("steps")
    require(isinstance(steps, list) and 0 < len(steps) <= 16
            and all(isinstance(step, dict) for step in steps), "Earlier bootstrap steps are unavailable")
    writes = [step for step in steps if step.get("name") in (WRITE_STEP, RESUME_STEP)]
    require(1 <= len(writes) <= 2 and len({step["name"] for step in writes}) == len(writes)
            and any(step["name"] == WRITE_STEP for step in writes)
            and all(step.get("status") == "completed" and step.get("conclusion") == "skipped" for step in writes),
            "Earlier bootstrap reached or may have reached the write boundary; use observe")


def require_no_prior_write(api, *, revision, run_id, attempt, run_number):
    repository = api.request(f"repos/{REPO}")
    repository_id = repository.get("id")
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    workflow_id = workflow.get("id")
    require(repository.get("full_name") == REPO and number(repository_id)
            and number(workflow_id) and workflow.get("path") == WORKFLOW_PATH,
            "Canonical custody workflow identity required")
    current = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(run_identity(current, workflow_id, repository_id) and current["id"] == run_id
            and current["run_number"] == run_number and current["run_attempt"] == attempt
            and current["head_sha"] == revision and current["head_branch"] == "main"
            and current["status"] == "in_progress", "Current custody workflow identity differs")
    history = api.request(f"repos/{REPO}/actions/workflows/{workflow_id}/runs?per_page={MAX_HISTORY}")
    rows = history.get("workflow_runs")
    require(isinstance(rows, list) and type(history.get("total_count")) is int
            and 0 < len(rows) == history["total_count"] <= MAX_HISTORY
            and all(run_identity(row, workflow_id, repository_id) for row in rows),
            "Complete bounded custody workflow history required")
    require(len({row["id"] for row in rows}) == len(rows)
            and {row["run_number"] for row in rows} == set(range(1, len(rows) + 1))
            and any(all(row[key] == current[key] for key in
                        ("id", "run_number", "run_attempt", "head_sha", "head_branch"))
                    for row in rows), "Custody history contains missing or ambiguous run identities")
    prior = [(row, n) for row in rows if row["head_branch"] == "main"
             for n in range(1, (attempt if row["id"] == run_id else row["run_attempt"] + 1))]
    require(len(prior) <= MAX_HISTORY, "Custody workflow history exceeds the attempt budget")
    for row, old_attempt in prior:
        require_no_write_in_attempt(api, row, old_attempt)


def preflight(api, identity, runner_temp, *, staged=False):
    revision, run_id, attempt, run_number = identity
    require_selected_main(api, REPO, revision)
    require_no_prior_write(api, revision=revision, run_id=run_id, attempt=attempt, run_number=run_number)
    # Before downloads, cover the two ZIPs, their verified extraction and registry staging.
    # After staging originals, retain space for both layouts and runner reserve.
    require(shutil.disk_usage(runner_temp).free >= (3 if staged else 8) * 1024**3,
            "Insufficient private custody runner storage")


def selected_objects():
    for filename, kind, checksum, size in OBJECTS:
        digest = f"sha256:{checksum}"
        yield filename, kind, digest, size, manifest_digest(custody_manifest(kind, digest, size))


def write_auth(path, environment):
    actor, token = environment.get("GITHUB_ACTOR", ""), environment.get("GH_TOKEN", "")
    require(re.fullmatch(r"[a-zA-Z0-9-]+(?:\[bot\])?", actor)
            and 0 < len(token) <= 4096 and not any(c in token for c in "\r\n\0"),
            "Hosted package credentials are unavailable")
    encoded = base64.b64encode(f"{actor}:{token}".encode("utf-8")).decode("ascii")
    write_metadata(path / "config.json", {"auths": {"ghcr.io": {"auth": encoded}}})


@contextmanager
def registry_auth(runner_temp):
    with tempfile.TemporaryDirectory(prefix="web-custody-registry.", dir=runner_temp) as config:
        write_auth(Path(config), os.environ)
        prior_config = os.environ.get("DOCKER_CONFIG")
        os.environ["DOCKER_CONFIG"] = config
        try:
            yield
        finally:
            if prior_config is None:
                os.environ.pop("DOCKER_CONFIG", None)
            else:
                os.environ["DOCKER_CONFIG"] = prior_config


def set_evidence(path, status, identity, mode, **fields):
    revision, run_id, attempt, _ = identity
    write_metadata(path, {"schemaVersion": 1, "kind": "warpdrive-web-custody-workflow",
                          "repository": REPOSITORY, "revision": revision, "runId": run_id,
                          "runAttempt": attempt, "mode": mode, "status": status,
                          "deploymentAuthorized": False, **fields})


def observe_object(oras, mode, runner_temp, source, evidence, identity, item):
    filename, kind, digest, size, manifest = item
    facts = {"filename": filename, "kind": kind, "digest": digest, "bytes": size,
             "reference": f"{REPOSITORY}@{manifest}"}
    set_evidence(evidence / f"{filename}.started.json", "readback-pending", identity, mode, **facts)
    layout = runner_temp / f"web-custody-layout-{filename}"
    observed = publish(oras, layout, source / filename, kind=kind, digest=digest, size=size,
                       observe_only=mode == "observe")
    require(observed == manifest, "Immutable custody reference differs")
    set_evidence(evidence / f"{filename}.verified.json", "verified", identity, mode, **facts)
    print(f"Verified immutable custody object {facts['reference']}", flush=True)


def execute(api, identity, mode, oras, runner_temp, evidence):
    source = runner_temp / "web-custody-source"
    objects = tuple(selected_objects())
    if mode == "bootstrap":
        preflight(api, identity, runner_temp, staged=True)
        for filename, kind, digest, size, _ in objects:
            with verified_bytes(source / filename, kind, digest, size):
                pass
        require_selected_main(api, REPO, identity[0])
    with registry_auth(runner_temp):
        failures = 0
        for item in objects:
            try:
                observe_object(oras, mode, runner_temp, source, evidence, identity, item)
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
                if mode == "bootstrap":
                    raise
                failures += 1
                set_evidence(evidence / f"{item[0]}.held.json", "held", identity, mode,
                             filename=item[0], failureClass=type(error).__name__)
        require(failures == 0, "One or more custody objects could not be independently verified")
    require_selected_main(api, REPO, identity[0])
    set_evidence(evidence / "result.json", "verified", identity, mode, verifiedObjects=len(objects))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("preflight", "provider-check", "bootstrap", "observe", "resume-preflight", "resume"))
    parser.add_argument("--oras", type=Path)
    args = parser.parse_args(argv)
    evidence = None
    try:
        identity = require_hosted(os.environ)
        checkout(Path(os.environ["GITHUB_WORKSPACE"]), identity[0])
        runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
        api = PublicGitHub()
        require_selected_main(api, REPO, identity[0])
        if args.mode == "preflight":
            preflight(api, identity, runner_temp)
            return 0
        if args.mode == "resume-preflight":
            from web_custody_resume import verify_resume_authority

            verify_resume_authority(api, identity, runner_temp)
            return 0
        if args.mode == "provider-check":
            preflight(api, identity, runner_temp, staged=True)
            with registry_auth(runner_temp):
                for _, kind, digest, size, manifest in selected_objects():
                    _verify_anonymous_denied(manifest)
                    state = precheck_custody_manifest(custody_manifest(kind, digest, size),
                                                      environment=dict(os.environ), use_write_scope=True)
                    print(f"Verified custody provider status: {state}", flush=True)
            require_selected_main(api, REPO, identity[0])
            return 0
        require(args.oras is not None and args.oras.is_absolute() and not args.oras.is_symlink()
                and args.oras.parent.parent == runner_temp and args.oras.name == "oras"
                and args.oras.parent.name.startswith("custody-oras.") and args.oras.is_file(),
                "Verified private ORAS path required")
        evidence_path = runner_temp / "web-custody-evidence"
        evidence_path.mkdir(mode=0o700)
        evidence = evidence_path
        if args.mode == "resume":
            from web_custody_resume import resume

            resume(api, identity, args.oras, runner_temp, evidence)
        else:
            execute(api, identity, args.mode, args.oras, runner_temp, evidence)
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        if evidence is not None and evidence.is_dir():
            set_evidence(evidence / "hold.json", "held", identity, args.mode, failureClass=type(error).__name__)
        print(f"Custody workflow held ({type(error).__name__}). Inspect retained evidence; use observe after a write opportunity.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
