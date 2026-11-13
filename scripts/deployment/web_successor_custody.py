"""Retain the exact admitted C Web bundle and receipt in private GHCR custody."""

from __future__ import annotations

import argparse
from hashlib import sha256
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import zipfile

from candidate import REVISION, require
from component_inputs import canonical, decode
from publication_gate import REPO, require_selected_main
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import _input_file
from web_custody_workflow import (
    BOOTSTRAP_JOB, MAX_HISTORY, NOT_STARTED, WORKFLOW as ORIGINAL_WORKFLOW,
    WRITE_STEP as ORIGINAL_WRITE_STEP, number, registry_auth, selected_objects,
)
from web_publication_gate import PublicGitHub, download, private_file
from web_release_build import checkout, git, private_destination, write_metadata
from web_release_custody import REPOSITORY, custody_manifest, manifest_digest, publish, verified_bytes
from web_repeat_publication import JOB, MAX_ZIP_BYTES, STEPS, WORKFLOW as REPEAT_WORKFLOW, repeat_policy
from web_repeat_successor import _publication


WORKFLOW = "web-successor-custody.yml"
PUBLISH_JOB = "Publish verified successor Web custody"
WRITE_STEP = "Publish the two pinned successor objects"
ORIGINAL_OBSERVE_JOB = "Observe immutable Web artifact custody"
ORIGINAL_OBSERVE_STEP = "Observe exact immutable manifests and payloads"
RETAIN_STEP = "Retain sanitized custody outcome"
SOURCE = "5c505b5cc4dfa5cbddb6d581b4034f90b48c4f0f"
RECEIPT = "scripts/deployment/repeat-web-c-publication.receipt"
RECEIPT_SHA = "a50c834bfed0291e46c9b74abd4c4208ef875f0946a263c47b9b27908835c456"
RECEIPT_BYTES = 6313
ARCHIVE_SHA = "sha256:d497eb4b4f38216c20ed7a8413a04c595bf02fb7675378de87d0996c2f2db44f"
ARCHIVE_BYTES = 1151961858
RUN_ID = 43367757674
JOB_ID = 131696087042
LINEAGE_SHA = "0a51b39635013c27a7838ccd596f5c9a651e8c76b145c82c57eb4e3634c1209f"
ORIGIN = {"kind": "github-actions", "repository": REPO, "event": "workflow_dispatch",
          "ref": "refs/heads/main", "runId": RUN_ID, "runAttempt": 1}
ARTIFACT = {"id": 14011423554, "name": f"web-repeat-image-bundle-{SOURCE}-{RUN_ID}-1",
            "digest": ARCHIVE_SHA, "sizeBytes": ARCHIVE_BYTES}
OBJECTS = (("web-repeat-bundle.zip", "archive", ARCHIVE_SHA, ARCHIVE_BYTES),
           ("receipt.json", "receipt", f"sha256:{RECEIPT_SHA}", RECEIPT_BYTES))
MAX_EVIDENCE_ZIP = 64 * 1024
MAX_EVIDENCE_FILE = 4096
FAILURES = (OSError, RuntimeError, ValueError, TypeError, KeyError, AttributeError,
            subprocess.SubprocessError, zipfile.BadZipFile)


def require_hosted(environment):
    revision = environment.get("GITHUB_SHA", "")
    require(environment.get("GITHUB_ACTIONS") == "true"
            and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO
            and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and environment.get("GITHUB_WORKFLOW_REF") == f"{REPO}/.github/workflows/{WORKFLOW}@refs/heads/main"
            and REVISION.fullmatch(revision), "Exact hosted successor custody workflow required")
    values = [environment.get(f"GITHUB_RUN_{key}", "") for key in ("ID", "ATTEMPT", "NUMBER")]
    require(all(len(value) <= 15 and value.isascii() and value.isdecimal() for value in values),
            "Bounded custody run identity required")
    result = tuple(int(value) for value in values)
    require(all(number(value) for value in result), "Positive custody run identity required")
    return revision, *result


def admission_bytes(root, revision, source, receipt_path):
    require(source == SOURCE and receipt_path == root / RECEIPT,
            "The exact reviewed C revision and tracked receipt path are required")
    git(root, "merge-base", "--is-ancestor", source, revision, allow_empty=True)
    raw = _input_file(receipt_path)
    require(len(raw) == RECEIPT_BYTES and sha256(raw).hexdigest() == RECEIPT_SHA
            and git(root, "cat-file", "blob", f"{revision}:{RECEIPT}") == raw,
            "C admission bytes differ from the reviewed tracked receipt")
    receipt = _publication(raw, RECEIPT_SHA, source)
    required = repeat_policy()["required_workflows"]
    require(receipt["origin"] == ORIGIN and receipt["jobId"] == JOB_ID and receipt["artifact"] == ARTIFACT
            and receipt["baseline"]["installedLineageSha256"] == LINEAGE_SHA
            and len(receipt["ci"]) == len(required)
            and {row["workflow"]: row["jobs"] for row in receipt["ci"]} == required,
            "C admission does not bind the reviewed artifact, predecessor and required CI")
    return raw


def repository_id(api):
    repository = api.request(f"repos/{REPO}")
    require(repository.get("full_name") == REPO and number(repository.get("id")),
            "Canonical custody repository required")
    return repository["id"]


def succeeded(job, step):
    matches = [row for row in job.get("steps", []) if row.get("name") == step]
    return len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") == "success"


def run_jobs(api, run, *, attempt=None):
    attempt = run["run_attempt"] if attempt is None else attempt
    doc = api.request(f"repos/{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=20")
    jobs = doc["jobs"]
    require(type(jobs) is list and type(doc["total_count"]) is int and len(jobs) == doc["total_count"] <= 20
            and all(job.get("run_id") == run["id"] and job.get("run_attempt") == attempt
                    and job.get("head_sha") == run["head_sha"] for job in jobs),
            "Incomplete or mismatched custody job evidence")
    return jobs


def completed(job):
    return job.get("status") == "completed" and job.get("conclusion") == "success"


def authenticate_c(api, repo_id):
    run = successful_main_run(api, REPEAT_WORKFLOW, RUN_ID, SOURCE, repo_id, events={"workflow_dispatch"})
    jobs = [row for row in run_jobs(api, run) if row.get("name") == JOB]
    require(run["run_attempt"] == ORIGIN["runAttempt"] and len(jobs) == 1 and jobs[0].get("id") == JOB_ID
            and completed(jobs[0]) and all(succeeded(jobs[0], step) for step in STEPS),
            "Historical C producer job or attempt differs from its admission")
    artifact = artifact_for_run(api, run, repo_id, ARTIFACT["name"], maximum=MAX_ZIP_BYTES)
    require(artifact == ARTIFACT, "Historical C Actions artifact differs from its admission")
    return artifact


def original_run(api, repo_id, run_id, root, revision):
    require(number(run_id), "Exact original custody evidence run required")
    row = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    original_revision = row.get("head_sha")
    require(isinstance(original_revision, str) and REVISION.fullmatch(original_revision),
            "Exact original custody source required")
    run = successful_main_run(api, ORIGINAL_WORKFLOW, run_id, original_revision, repo_id,
                              events={"workflow_dispatch"})
    git(root, "merge-base", "--is-ancestor", original_revision, revision, allow_empty=True)
    jobs = run_jobs(api, run)
    steps = {BOOTSTRAP_JOB: ("bootstrap", ORIGINAL_WRITE_STEP),
             ORIGINAL_OBSERVE_JOB: ("observe", ORIGINAL_OBSERVE_STEP)}
    selected = [job for job in jobs if job.get("name") in steps and completed(job)]
    require(len(selected) == 1, "One completed original custody job required")
    mode, step = steps[selected[0]["name"]]
    require(succeeded(selected[0], step) and succeeded(selected[0], RETAIN_STEP),
            "Original custody did not verify all three objects and retain evidence")
    name = f"web-release-custody-{run_id}-{run['run_attempt']}"
    return mode, run, artifact_for_run(api, run, repo_id, name, maximum=MAX_EVIDENCE_ZIP)


def original_evidence(archive, mode, run):
    base = {"schemaVersion": 1, "kind": "warpdrive-web-custody-workflow", "repository": REPOSITORY,
            "revision": run["head_sha"], "runId": run["id"], "runAttempt": run["run_attempt"],
            "mode": mode, "status": "verified", "deploymentAuthorized": False}
    expected = {"result.json": {**base, "verifiedObjects": 3}}
    for name, kind, digest, size, manifest in selected_objects():
        expected[f"{name}.verified.json"] = {**base, "filename": name, "kind": kind, "digest": digest,
                                              "bytes": size, "reference": f"{REPOSITORY}@{manifest}"}
    for name in tuple(expected):
        if name.endswith(".verified.json"):
            expected[name.replace(".verified.json", ".started.json")] = {**expected[name], "status": "readback-pending"}
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        require(len(members) == len(expected) and {member.filename for member in members} == set(expected),
                "Original custody evidence inventory differs")
        for member in members:
            mode_bits = stat.S_IFMT(member.external_attr >> 16)
            require(member.orig_filename == member.filename and not member.is_dir() and mode_bits in (0, stat.S_IFREG)
                    and not member.flag_bits & 1 and 0 < member.file_size <= MAX_EVIDENCE_FILE,
                    "Unsafe or oversized original custody evidence member")
            require(canonical(decode(source.read(member))) == canonical(expected[member.filename]),
                    "Original custody immutable object evidence differs")


def no_prior_write(api, repo_id, identity):
    revision, run_id, attempt, run_number = identity
    path = f".github/workflows/{WORKFLOW}"
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    require(workflow.get("path") == path and number(workflow.get("id")), "Canonical successor workflow required")
    workflow_id = workflow["id"]

    def valid(row):
        return (row.get("workflow_id") == workflow_id and row.get("path") == path
                and row.get("event") == "workflow_dispatch" and number(row.get("id"))
                and number(row.get("run_number")) and number(row.get("run_attempt"))
                and row["run_attempt"] <= MAX_HISTORY and isinstance(row.get("head_branch"), str)
                and isinstance(row.get("head_sha"), str) and REVISION.fullmatch(row["head_sha"])
                and (row.get("repository") or {}).get("id") == repo_id
                and (row.get("head_repository") or {}).get("id") == repo_id)

    current = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(valid(current) and (current["head_sha"], current["id"], current["run_attempt"], current["run_number"]) == identity
            and current.get("head_branch") == "main" and current.get("status") == "in_progress",
            "Exact current successor custody run required")
    history = api.request(f"repos/{REPO}/actions/workflows/{workflow_id}/runs?per_page={MAX_HISTORY}")
    rows = history["workflow_runs"]
    require(type(rows) is list and type(history["total_count"]) is int and len(rows) == history["total_count"]
            and 0 < len(rows) <= MAX_HISTORY and all(valid(row) for row in rows)
            and len({row["id"] for row in rows}) == len(rows)
            and {row["run_number"] for row in rows} == set(range(1, len(rows) + 1))
            and any((row["head_sha"], row["id"], row["run_attempt"], row["run_number"]) == identity
                    and row["head_branch"] == "main" for row in rows), "Complete successor custody history required")
    prior = [(row, n) for row in rows if row["head_branch"] == "main"
             for n in range(1, attempt if row["id"] == run_id else row["run_attempt"] + 1)]
    require(len(prior) <= MAX_HISTORY, "Successor custody attempt budget exceeded")
    for row, old_attempt in prior:
        require_prior_skipped(api, row, old_attempt)


def require_prior_skipped(api, run, attempt):
    jobs = run_jobs(api, run, attempt=attempt)
    if attempt == run["run_attempt"] and run.get("status") in NOT_STARTED and all(
        job.get("status") in NOT_STARTED and job.get("steps") in (None, []) and job.get("conclusion") is None for job in jobs
    ):
        return
    matches = [job for job in jobs if job.get("name") == PUBLISH_JOB]
    require(len(matches) == 1 and matches[0].get("status") == "completed",
            "Prior successor publication job is unknown; use observe")
    job = matches[0]
    if job.get("conclusion") == "skipped" and not job.get("steps"):
        return
    writes = [step for step in job.get("steps", []) if step.get("name") == WRITE_STEP]
    require(len(writes) == 1 and writes[0].get("status") == "completed" and writes[0].get("conclusion") == "skipped",
            "An earlier successor run reached or may have reached the write boundary; use observe")


def prepare(api, identity, root, runner_temp, original_run_id, raw):
    repo_id = repository_id(api)
    no_prior_write(api, repo_id, identity)
    source = runner_temp / "web-successor-custody-source"
    private_destination(source, root)
    require(shutil.disk_usage(runner_temp).free >= 4 * 1024**3, "Insufficient successor custody disk reserve")
    source.mkdir(mode=0o700)
    mode, run, evidence = original_run(api, repo_id, original_run_id, root, identity[0])
    original_zip = source / "original-evidence.zip"
    download(evidence, original_zip)
    with verified_bytes(original_zip, "archive", evidence["digest"], evidence["sizeBytes"]) as archive:
        original_evidence(archive, mode, run)
    artifact = authenticate_c(api, repo_id)
    download(artifact, source / OBJECTS[0][0])
    with private_file(source / OBJECTS[1][0]) as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    require(authenticate_c(api, repo_id) == artifact, "Historical C artifact changed while staging")
    require_selected_main(api, REPO, identity[0])
    write_metadata(source / "prepared.json", prepared_record(identity, original_run_id))


def prepared_record(identity, original_run_id):
    return {"revision": identity[0], "runId": identity[1], "runAttempt": identity[2],
            "originalCustodyRunId": original_run_id, "sourceRevision": SOURCE,
            "publicationSha256": RECEIPT_SHA, "artifact": ARTIFACT}


def require_oras(path, runner_temp):
    require(path is not None and path.is_absolute() and path == path.resolve(strict=True)
            and path.parent.parent == runner_temp and path.name == "oras"
            and path.parent.name.startswith("custody-oras.") and path.is_file(),
            "Verified private ORAS binary required")


def transport_objects(oras, mode, runner_temp, source, evidence):
    failed = False
    for name, kind, digest, size in OBJECTS:
        manifest = manifest_digest(custody_manifest(kind, digest, size))
        facts = {"filename": name, "payloadSha256": digest, "bytes": size,
                 "reference": f"{REPOSITORY}@{manifest}"}
        write_metadata(evidence / f"{name}.started.json", {**facts, "state": "readback-pending"})
        try:
            result = publish(oras, runner_temp / f"web-successor-custody-layout-{name}", source / name,
                             kind=kind, digest=digest, size=size, observe_only=mode == "observe")
            require(result == manifest, "Successor immutable reference differs")
        except FAILURES:
            if mode == "publish":
                raise
            failed = True
            write_metadata(evidence / f"{name}.held.json", {**facts, "state": "held"})
            continue
        write_metadata(evidence / f"{name}.verified.json", {**facts, "state": "verified"})
    require(not failed, "Successor objects were not both verified")


def execute(api, identity, mode, oras, runner_temp, evidence, *, original_run_id=None):
    source = runner_temp / "web-successor-custody-source"
    if mode == "publish":
        no_prior_write(api, repository_id(api), identity)
        require(number(original_run_id)
                and canonical(decode(_input_file(source / "prepared.json")))
                == canonical(prepared_record(identity, original_run_id)),
                "A verified preparation from this workflow attempt is required")
        for name, kind, digest, size in OBJECTS:
            with verified_bytes(source / name, kind, digest, size):
                pass
        require_selected_main(api, REPO, identity[0])
    with registry_auth(runner_temp):
        transport_objects(oras, mode, runner_temp, source, evidence)
    require_selected_main(api, REPO, identity[0])
    write_metadata(evidence / "result.json", {"schemaVersion": 1, "kind": "warpdrive-web-successor-custody",
        "revision": identity[0], "sourceRevision": SOURCE, "runId": identity[1], "runAttempt": identity[2],
        "mode": mode, "state": "verified", "verifiedObjects": len(OBJECTS), "deploymentAuthorized": False})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("preflight", "prepare", "publish", "observe"))
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--publication-receipt", type=Path, required=True)
    parser.add_argument("--original-custody-run-id", type=int)
    parser.add_argument("--oras", type=Path)
    args = parser.parse_args(argv)
    evidence = None
    try:
        identity = require_hosted(os.environ)
        root = Path(os.environ["GITHUB_WORKSPACE"])
        checkout(root, identity[0])
        runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
        api = PublicGitHub()
        require_selected_main(api, REPO, identity[0])
        raw = admission_bytes(root, identity[0], args.source_revision, args.publication_receipt)
        if args.mode == "preflight":
            no_prior_write(api, repository_id(api), identity)
        elif args.mode == "prepare":
            prepare(api, identity, root, runner_temp, args.original_custody_run_id, raw)
        else:
            require_oras(args.oras, runner_temp)
            path = runner_temp / "web-successor-custody-evidence"
            path.mkdir(mode=0o700)
            evidence = path
            execute(api, identity, args.mode, args.oras, runner_temp, evidence, original_run_id=args.original_custody_run_id)
    except FAILURES as error:
        if evidence is not None:
            write_metadata(evidence / "hold.json", {"state": "held", "failureClass": type(error).__name__,
                                                    "deploymentAuthorized": False})
        print(f"Successor custody held ({type(error).__name__}); use observe after a write opportunity.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
