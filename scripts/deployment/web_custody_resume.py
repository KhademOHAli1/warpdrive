"""Reconcile the specific first partial original Web custody bootstrap."""

import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

from candidate import require
from component_inputs import canonical, decode
from publication_gate import REPO, require_selected_main
from web_baseline import artifact_for_run
from web_custody_diagnostic import diagnose
from web_custody_workflow import (
    BOOTSTRAP_JOB, MAX_HISTORY, NOT_STARTED, WORKFLOW, WORKFLOW_PATH, WRITE_STEP,
    registry_auth, run_identity, selected_objects, set_evidence,
)
from web_publication_gate import download
from web_release_custody import REPOSITORY, _verify_anonymous_denied, publish, verified_bytes


REPOSITORY_ID = 1438867356
WORKFLOW_ID = 416915222
FIRST_RUN = 43374916917
FIRST_REVISION = "eb0a0561999775c5cfd7a4502d382814ce4c9ef9"
FIRST_JOB = 131719043284
FIRST_ZIP = (14014750221, 832, "sha256:d40f09c47336b440310d63681b1820ee5d222f9e0ea701862904271b9a25bb1f")
DIAGNOSTIC_RUN = 43378366827
DIAGNOSTIC_REVISION = "23e5ad5f5afc8339ac022b2f0a5407349f74227b"
DIAGNOSTIC_JOB = 131730103093
DIAGNOSTIC_ZIP = (14015880454, 814, "sha256:37144a492d6b0ff4df651035808ec684db6067e230121b2380bbae26ccbe6bf3")
RESUME_STEP = "Resume only missing pinned custody objects"
OBSERVE_JOB = "Observe immutable Web artifact custody"
CORE, WEB, ADMISSION = selected_objects()
REMAINING = (WEB, ADMISSION)
MAX_EVIDENCE_BYTES = 4096


def _jobs(api, run, attempt):
    response = api.request(f"repos/{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=20")
    jobs = response.get("jobs")
    require(type(jobs) is list and type(response.get("total_count")) is int
            and len(jobs) == response["total_count"] <= 2
            and all(isinstance(job, dict) and job.get("run_id") == run["id"]
                    and job.get("run_attempt") == attempt and job.get("head_sha") == run["head_sha"] for job in jobs),
            "Complete exact custody job history required")
    return jobs


def _job(jobs, name):
    matches = [job for job in jobs if job.get("name") == name]
    require(len(matches) == 1 and matches[0].get("status") == "completed", "Custody job is unknown")
    return matches[0]


def _step(job, name, conclusion, *, required=True):
    steps = job.get("steps")
    require(isinstance(steps, list) and 0 < len(steps) <= 20 and all(isinstance(row, dict) for row in steps),
            "Complete custody step history required")
    matches = [step for step in steps if step.get("name") == name]
    if matches or required:
        require(len(matches) == 1 and matches[0].get("status") == "completed"
                and matches[0].get("conclusion") == conclusion, "Custody write or evidence step differs")


def _history(api, identity):
    revision, run_id, attempt, run_number = identity
    repository = api.request(f"repos/{REPO}")
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    require(repository.get("full_name") == REPO and repository.get("id") == REPOSITORY_ID
            and workflow.get("id") == WORKFLOW_ID and workflow.get("path") == WORKFLOW_PATH,
            "Exact repository and original custody workflow required")
    current = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(run_identity(current, WORKFLOW_ID, REPOSITORY_ID) and current.get("head_branch") == "main"
            and current.get("status") == "in_progress"
            and (current["head_sha"], current["id"], current["run_attempt"], current["run_number"]) == identity
            and run_number > 3, "Exact current main custody resume run required")
    history = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW_ID}/runs?per_page={MAX_HISTORY}")
    rows = history.get("workflow_runs")
    require(type(rows) is list and type(history.get("total_count")) is int
            and 4 <= len(rows) == history["total_count"] <= MAX_HISTORY
            and all(run_identity(row, WORKFLOW_ID, REPOSITORY_ID) for row in rows)
            and len({row["id"] for row in rows}) == len(rows)
            and {row["run_number"] for row in rows} == set(range(1, len(rows) + 1)),
            "Complete bounded custody workflow history required")
    by_id = {row["id"]: row for row in rows}
    require(all(by_id.get(run_id, {}).get(key) == current[key] for key in
                ("head_sha", "head_branch", "run_attempt", "run_number")), "Custody history omits the selected resume")
    first, diagnostic = by_id.get(FIRST_RUN, {}), by_id.get(DIAGNOSTIC_RUN, {})
    for row, known_revision, number in ((first, FIRST_REVISION, 1), (diagnostic, DIAGNOSTIC_REVISION, 3)):
        require(row.get("head_sha") == known_revision and row.get("run_number") == number
                and row.get("run_attempt") == 1 and row.get("head_branch") == "main"
                and row.get("status") == "completed" and row.get("conclusion") == "failure",
                "Exact original partial bootstrap and read-only diagnostic required")
    jobs = _jobs(api, first, 1)
    bootstrap = _job(jobs, BOOTSTRAP_JOB)
    require(bootstrap.get("id") == FIRST_JOB and bootstrap.get("conclusion") == "failure",
            "Original bootstrap job differs")
    _step(bootstrap, "Verify authenticated provider state without writing", "success")
    _step(bootstrap, WRITE_STEP, "failure")
    _step(bootstrap, "Retain sanitized custody outcome", "success")
    prior = [(row, n) for row in rows if row["head_branch"] == "main" and row["id"] != FIRST_RUN
             for n in range(1, attempt if row["id"] == run_id else row["run_attempt"] + 1)]
    require(len(prior) <= MAX_HISTORY, "Custody resume history exceeds the attempt budget")
    for row, previous_attempt in prior:
        jobs = _jobs(api, row, previous_attempt)
        if row["id"] == DIAGNOSTIC_RUN:
            observer = _job(jobs, OBSERVE_JOB)
            require(observer.get("id") == DIAGNOSTIC_JOB and observer.get("conclusion") == "failure",
                    "Original diagnostic job differs")
            _step(observer, "Diagnose the exact registry references without writing", "success")
            _step(observer, "Retain sanitized registry diagnostics", "success")
        if (previous_attempt == row["run_attempt"] and row.get("status") in NOT_STARTED
                and all(job.get("status") in NOT_STARTED and not job.get("steps")
                        and job.get("conclusion") is None for job in jobs)):
            continue
        job = _job(jobs, BOOTSTRAP_JOB)
        if job.get("conclusion") == "skipped":
            require(not job.get("steps"), "Skipped custody job reports unexpected steps")
            continue
        _step(job, WRITE_STEP, "skipped")
        _step(job, RESUME_STEP, "skipped", required=row["run_number"] > 3)
    return first, diagnostic


def _object_facts(item):
    filename, kind, digest, size, manifest = item
    return {"filename": filename, "kind": kind, "digest": digest, "bytes": size,
            "reference": f"{REPOSITORY}@{manifest}"}


def _first_records():
    base = {"schemaVersion": 1, "kind": "warpdrive-web-custody-workflow", "repository": REPOSITORY,
            "revision": FIRST_REVISION, "runId": FIRST_RUN, "runAttempt": 1, "mode": "bootstrap",
            "deploymentAuthorized": False}
    return {"core.zip.started.json": {**base, **_object_facts(CORE), "status": "readback-pending"},
            "hold.json": {**base, "status": "held", "failureClass": "CandidateError"}}


def _diagnostic_record(item, *, present):
    filename, _, digest, size, manifest = item
    state = "exact-manifest" if present else "manifest-unknown"
    return {"filename": filename, "manifestDigest": manifest, "payloadDigest": digest, "payloadBytes": size,
            "tag": state, "digest": state, "payload": "exact-blob-headers" if present else "blob-unknown"}


def _diagnostic_records():
    return {"web-custody-diagnostic.json": {
        "schemaVersion": 1, "kind": "warpdrive-web-custody-diagnostic", "repository": REPOSITORY,
        "revision": DIAGNOSTIC_REVISION, "runId": DIAGNOSTIC_RUN, "runAttempt": 1, "authorization": "token-obtained",
        "emptyConfig": "exact-blob-headers", "objects": [_diagnostic_record(CORE, present=True),
            *(_diagnostic_record(item, present=False) for item in REMAINING)],
        "publicationAuthorized": False, "deploymentAuthorized": False,
    }}


def _check_records(archive, records):
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        require(len(members) == len(records) and {member.filename for member in members} == set(records),
                "Exact custody reconciliation evidence inventory required")
        for member in members:
            require(member.orig_filename == member.filename and not member.is_dir() and not member.flag_bits & 1
                    and stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG)
                    and 0 < member.file_size <= MAX_EVIDENCE_BYTES, "Unsafe custody reconciliation evidence entry")
            require(canonical(decode(source.read(member))) == canonical(records[member.filename]),
                    "Custody reconciliation evidence differs")


def _verify_artifact(api, run, folder, name, pin, records):
    artifact_id, size, digest = pin
    artifact = artifact_for_run(api, run, REPOSITORY_ID, name, maximum=MAX_EVIDENCE_BYTES)
    require(artifact == {"id": artifact_id, "sizeBytes": size, "digest": digest, "name": name},
            "Pinned custody reconciliation artifact differs")
    path = folder / f"{artifact_id}.zip"
    download(artifact, path)
    with verified_bytes(path, "archive", digest, size) as source:
        _check_records(source, records)


def verify_resume_authority(api, identity, runner_temp):
    """Authenticate the exact failed first run, independent diagnostic and write history."""
    require_selected_main(api, REPO, identity[0])
    first, diagnostic = _history(api, identity)
    with tempfile.TemporaryDirectory(prefix="web-custody-resume-evidence.", dir=runner_temp) as folder:
        folder = Path(folder)
        _verify_artifact(api, first, folder, f"web-release-custody-{FIRST_RUN}-1", FIRST_ZIP, _first_records())
        _verify_artifact(api, diagnostic, folder, f"web-release-custody-diagnostic-{DIAGNOSTIC_RUN}-1",
                         DIAGNOSTIC_ZIP, _diagnostic_records())
    require_selected_main(api, REPO, identity[0])


def _require_provider_states(items, *, present):
    observed = diagnose(environment=dict(os.environ))
    require(observed["authorization"] == "token-obtained" and observed["emptyConfig"] == "exact-blob-headers",
            "Current private custody provider evidence is unavailable")
    by_name = {row["filename"]: row for row in observed["objects"]}
    require(all(by_name.get(item[0]) == _diagnostic_record(item, present=present) for item in items),
            "Current custody object state differs from the reviewed partial write")


def _handle_object(oras, runner_temp, evidence, identity, item, *, observe_only):
    filename, kind, digest, size, manifest = item
    facts = _object_facts(item)
    set_evidence(evidence / f"{filename}.started.json", "readback-pending", identity, "resume", **facts)
    observed = publish(oras, runner_temp / f"web-custody-layout-{filename}",
                       runner_temp / "web-custody-source" / filename,
                       kind=kind, digest=digest, size=size, observe_only=observe_only)
    require(observed == manifest, "Resumed custody manifest differs")
    set_evidence(evidence / f"{filename}.verified.json", "verified", identity, "resume", **facts)


def resume(api, identity, oras, runner_temp, evidence):
    """Read Core in full and write only the original two never-started objects once."""
    verify_resume_authority(api, identity, runner_temp)
    require(shutil.disk_usage(runner_temp).free >= 3 * 1024**3, "Insufficient private custody resume storage")
    for filename, kind, digest, size, _ in REMAINING:
        with verified_bytes(runner_temp / "web-custody-source" / filename, kind, digest, size):
            pass
    with registry_auth(runner_temp):
        _handle_object(oras, runner_temp, evidence, identity, CORE, observe_only=True)
        _require_provider_states(REMAINING, present=False)
        _history(api, identity)
        for item in REMAINING:
            require_selected_main(api, REPO, identity[0])
            _verify_anonymous_denied(item[4])
            _require_provider_states((item,), present=False)
            _handle_object(oras, runner_temp, evidence, identity, item, observe_only=False)
        _require_provider_states((CORE, *REMAINING), present=True)
    require_selected_main(api, REPO, identity[0])
    set_evidence(evidence / "result.json", "verified", identity, "resume", verifiedObjects=3)
