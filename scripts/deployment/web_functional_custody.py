"""Preserve the exact admitted functional Web ZIP and receipt in private GHCR."""
from __future__ import annotations

import argparse
from hashlib import sha256
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

from candidate import REVISION, require
from component_inputs import HASH, canonical, content_hash, decode
from installed_web_functional_image import bundle_manifest
from publication_gate import REPO, require_selected_main
from registry_absence import precheck_custody_manifest
from web_candidate import ARCHIVE, _input_file, verify_saved_web_image
from web_custody_workflow import MAX_HISTORY, NOT_STARTED, number, registry_auth
import web_functional_publication as publication
from web_functional_candidate import INPUTS, MANIFEST
from web_functional_successor import authenticate_functional_artifact, verify_functional_publication
from web_publication_gate import PublicGitHub, download, private_file
from web_release_build import checkout, git, private_destination, write_metadata
from web_release_custody import REPOSITORY, _verify_anonymous_denied, custody_manifest, manifest_digest, publish, verified_bytes
from web_successor_custody import repository_id, require_oras, run_jobs


WORKFLOW = "web-functional-custody.yml"
WORKFLOW_PATH = f".github/workflows/{WORKFLOW}"
PUBLISH_JOB = "Publish verified functional Web custody"
WRITE_STEP = "Publish immutable functional Web "
HISTORY = "scripts/deployment/web-history"
ZIP = "web-functional-bundle.zip"
RECEIPT = "receipt.json"
SOURCE = "web-functional-custody-source"
EVIDENCE = "web-functional-custody-evidence"
MAX_RECEIPT = 128 * 1024
FAILURES = (OSError, RuntimeError, ValueError, TypeError, KeyError, AttributeError,
            subprocess.SubprocessError, zipfile.BadZipFile)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def require_hosted(environment):
    revision = environment.get("GITHUB_SHA", "")
    require(environment.get("GITHUB_ACTIONS") == "true" and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and _matches(REVISION, revision)
            and environment.get("GITHUB_WORKFLOW_REF") == f"{REPO}/{WORKFLOW_PATH}@refs/heads/main",
            "Exact hosted main functional custody workflow required")
    raw = tuple(environment.get(f"GITHUB_RUN_{field}", "") for field in ("ID", "ATTEMPT", "NUMBER"))
    require(all(value.isascii() and value.isdecimal() and len(value) <= 15 for value in raw),
            "Bounded custody run identity required")
    run_id, attempt, run_number = map(int, raw)
    require(all(number(value) for value in (run_id, attempt, run_number)), "Positive custody run identity required")
    return revision, run_id, attempt, run_number


def admitted_receipt(root, revision, source, expected_sha256):
    """Read exactly the protected tracked receipt, including its raw-byte SHA."""
    require(_matches(REVISION, revision) and _matches(REVISION, source) and revision != source
            and _matches(HASH, expected_sha256), "Exact distinct producer source and publication digest required")
    git(root, "merge-base", "--is-ancestor", source, revision, allow_empty=True)
    path = f"{HISTORY}/{source}.receipt"
    require(git(root, "ls-tree", revision, "--", path).startswith(b"100644 blob "),
            "Functional publication must be a tracked regular non-executable receipt")
    raw = _input_file(root / path)
    require(0 < len(raw) <= MAX_RECEIPT and git(root, "cat-file", "blob", f"{revision}:{path}") == raw,
            "Functional publication differs from protected tracked bytes")
    return raw, verify_functional_publication(raw, expected_publication_sha256=expected_sha256, expected_revision=source)


def verify_archive(archive, destination, receipt):
    """Verify the exact Actions ZIP, member bytes, and saved image without loading it."""
    require(publication.extract_verified_zip(archive, destination, receipt["artifact"])
            == receipt["provenance"]["bundleManifestSha256"], "Functional ZIP manifest digest differs")
    files = bundle_manifest(_input_file(destination / MANIFEST), receipt)
    for name, record in files.items():
        if name != ARCHIVE:
            with verified_bytes(destination / name, "archive", "sha256:" + record["sha256"], record["sizeBytes"]):
                pass
    facts = decode(_input_file(destination / INPUTS))
    require(content_hash(facts) == receipt["baseline"]["inputSha256"] and facts.get("revision") == receipt["revision"],
            "Functional ZIP build input evidence differs")
    image = verify_saved_web_image(destination, expected_image_id=receipt["image"]["imageId"],
                                   expected_revision=receipt["revision"])
    require(image == {"image": receipt["image"], "archiveSha256": receipt["provenance"]["archiveSha256"],
                      "archiveSizeBytes": receipt["provenance"]["archiveSizeBytes"]},
            "Saved Web archive differs from its authenticated image identity")


def _prior_attempt(api, run, attempt, source):
    jobs = run_jobs(api, run, attempt=attempt)
    if attempt == run["run_attempt"] and run.get("status") in NOT_STARTED and all(
        job.get("status") in NOT_STARTED and job.get("steps") in (None, []) and job.get("conclusion") is None for job in jobs
    ):
        return
    matches = [job for job in jobs if job.get("name") == PUBLISH_JOB]
    require(len(matches) == 1 and matches[0].get("status") == "completed",
            "Prior functional custody job is unresolved; use observe")
    job = matches[0]
    if job.get("conclusion") == "skipped" and not job.get("steps"):
        return
    writes = [step for step in job.get("steps", []) if str(step.get("name")).startswith(WRITE_STEP)]
    require(len(writes) == 1 and writes[0].get("status") == "completed"
            and writes[0].get("conclusion") in {"success", "failure", "cancelled", "skipped", "timed_out", "action_required"},
            "Prior functional custody write step is unresolved; use observe")
    if writes[0]["conclusion"] == "skipped":
        return
    previous_source = writes[0]["name"].removeprefix(WRITE_STEP)
    require(_matches(REVISION, previous_source), "Prior functional custody source is unresolved; use observe")
    require(previous_source != source,
            "An earlier run reached or may have reached this Web write; use observe")


def no_prior_write(api, repo_id, identity, source):
    """Fence attempts for this release across distinct protected-main custody runs."""
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    require(workflow.get("path") == WORKFLOW_PATH and number(workflow.get("id")), "Canonical custody workflow required")
    workflow_id = workflow["id"]

    def matches(row):
        return (row.get("workflow_id") == workflow_id and row.get("path") == WORKFLOW_PATH
                and row.get("event") == "workflow_dispatch" and number(row.get("id"))
                and number(row.get("run_number")) and number(row.get("run_attempt")) and row["run_attempt"] <= MAX_HISTORY
                and _matches(REVISION, row.get("head_sha")) and isinstance(row.get("head_branch"), str)
                and (row.get("repository") or {}).get("id") == repo_id
                and (row.get("head_repository") or {}).get("id") == repo_id)

    def run_identity(row):
        return row["head_sha"], row["id"], row["run_attempt"], row["run_number"]

    current = api.request(f"repos/{REPO}/actions/runs/{identity[1]}")
    require(matches(current) and run_identity(current) == identity and current.get("head_branch") == "main"
            and current.get("status") == "in_progress", "Exact current functional custody run required")
    history = api.request(f"repos/{REPO}/actions/workflows/{workflow_id}/runs?per_page={MAX_HISTORY}")
    rows = history["workflow_runs"]
    require(type(rows) is list and type(history["total_count"]) is int and len(rows) == history["total_count"]
            and 0 < len(rows) <= MAX_HISTORY and all(matches(row) for row in rows)
            and len({row["id"] for row in rows}) == len(rows)
            and {row["run_number"] for row in rows} == set(range(1, len(rows) + 1))
            and any(run_identity(row) == identity and row["head_branch"] == "main" for row in rows),
            "Complete functional custody workflow history required")
    attempts = [(row, attempt) for row in rows if row["head_branch"] == "main"
                for attempt in range(1, identity[2] if row["id"] == identity[1] else row["run_attempt"] + 1)]
    require(len(attempts) <= MAX_HISTORY, "Functional custody history exceeds the attempt budget")
    for row, attempt in attempts:
        _prior_attempt(api, row, attempt, source)


def objects(raw, receipt):
    artifact = receipt["artifact"]
    return ((ZIP, "archive", artifact["digest"], artifact["sizeBytes"]),
            (RECEIPT, "receipt", "sha256:" + sha256(raw).hexdigest(), len(raw)))


def _prepared(identity, raw, receipt):
    return {"revision": identity[0], "runId": identity[1], "runAttempt": identity[2],
            "sourceRevision": receipt["revision"], "publicationSha256": sha256(raw).hexdigest(), "artifact": receipt["artifact"]}


def prepare(api, identity, runner_temp, raw, receipt):
    repo_id = repository_id(api)
    no_prior_write(api, repo_id, identity, receipt["revision"])
    source = runner_temp / SOURCE
    private_destination(source)
    artifact = authenticate_functional_artifact(api, receipt, repository_id=repo_id)
    require(shutil.disk_usage(runner_temp).free >= 3 * artifact["sizeBytes"] + 2 * 1024**3,
            "Insufficient private runner storage for functional custody verification")
    source.mkdir(mode=0o700)
    download(artifact, source / ZIP)
    extracted = source / "verified-bundle"
    verify_archive(source / ZIP, extracted, receipt)
    shutil.rmtree(extracted)
    with private_file(source / RECEIPT) as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    require(authenticate_functional_artifact(api, receipt, repository_id=repo_id) == artifact,
            "Original functional artifact changed during preparation")
    require_selected_main(api, REPO, identity[0])
    write_metadata(source / "prepared.json", _prepared(identity, raw, receipt))


def provider_check(raw, receipt):
    states = {}
    for name, kind, digest, size in objects(raw, receipt):
        manifest = custody_manifest(kind, digest, size)
        _verify_anonymous_denied(manifest_digest(manifest))
        states[name] = precheck_custody_manifest(manifest, environment=dict(os.environ), use_write_scope=True)
    return states


def check_provider(api, identity, runner_temp, evidence, raw, receipt):
    no_prior_write(api, repository_id(api), identity, receipt["revision"])
    source = runner_temp / SOURCE
    require(_input_file(source / "prepared.json") == canonical(_prepared(identity, raw, receipt)) + b"\n",
            "Verified preparation from this exact custody attempt required")
    with registry_auth(runner_temp):
        states = provider_check(raw, receipt)
    require_selected_main(api, REPO, identity[0])
    write_metadata(evidence / "provider.json", {**_prepared(identity, raw, receipt), "state": "observed",
                                                "objects": states, "deploymentAuthorized": False})


def require_provider_observation(evidence, identity, raw, receipt):
    provider = decode(_input_file(evidence / "provider.json"))
    expected = {**_prepared(identity, raw, receipt), "state": "observed", "deploymentAuthorized": False}
    require(type(provider) is dict and set(provider) == {*expected, "objects"}
            and canonical({key: provider[key] for key in expected}) == canonical(expected)
            and type(provider["objects"]) is dict and set(provider["objects"]) == {ZIP, RECEIPT}
            and all(value in ("present", "absent") for value in provider["objects"].values()),
            "Exact authenticated provider observation required before the write opportunity")


def execute(api, identity, mode, oras, runner_temp, evidence, raw, receipt):
    require(mode in {"publish", "observe"}, "Exact functional custody operation required")
    source = runner_temp / SOURCE
    if mode == "publish":
        repo_id = repository_id(api)
        no_prior_write(api, repo_id, identity, receipt["revision"])
        require(authenticate_functional_artifact(api, receipt, repository_id=repo_id) == receipt["artifact"],
                "Original functional producer changed")
        require(_input_file(source / "prepared.json") == canonical(_prepared(identity, raw, receipt)) + b"\n",
                "Verified preparation from this exact custody attempt required")
        for name, kind, digest, size in objects(raw, receipt):
            with verified_bytes(source / name, kind, digest, size):
                pass
    require_selected_main(api, REPO, identity[0])
    count = 0
    with registry_auth(runner_temp):
        if mode == "publish":
            provider_check(raw, receipt)
            require_selected_main(api, REPO, identity[0])
        for name, kind, digest, size in objects(raw, receipt):
            if mode == "publish":
                require_selected_main(api, REPO, identity[0])
            immutable = manifest_digest(custody_manifest(kind, digest, size))
            facts = {"filename": name, "bytes": size, "payloadSha256": digest, "reference": f"{REPOSITORY}@{immutable}"}
            write_metadata(evidence / f"{name}.started.json", {**facts, "state": "readback-pending"})
            try:
                actual = publish(oras, runner_temp / f"web-functional-layout-{name}", source / name,
                                 kind=kind, digest=digest, size=size, observe_only=mode == "observe")
                require(actual == immutable, "Immutable functional custody reference differs")
            except FAILURES as error:
                write_metadata(evidence / f"{name}.held.json", {**facts, "state": "held", "failureClass": type(error).__name__})
                if mode == "publish":
                    break
            else:
                write_metadata(evidence / f"{name}.verified.json", {**facts, "state": "verified"})
                count += 1
    require_selected_main(api, REPO, identity[0])
    write_metadata(evidence / "result.json", {"schemaVersion": 1, "kind": "warpdrive-web-functional-custody",
        "revision": identity[0], "sourceRevision": receipt["revision"], "runId": identity[1], "runAttempt": identity[2],
        "publicationSha256": sha256(raw).hexdigest(), "mode": mode, "state": "verified" if count == 2 else "held",
        "verifiedObjects": count, "deploymentAuthorized": False})
    require(count == 2, "Both immutable functional Web custody objects were not verified; use observe")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "provider-check", "publish", "observe"))
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--publication-sha256", required=True)
    parser.add_argument("--oras", type=Path)
    args = parser.parse_args(argv)
    evidence = None
    try:
        identity = require_hosted(os.environ)
        root, runner_temp = Path(os.environ["GITHUB_WORKSPACE"]), Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
        checkout(root, identity[0])
        api = PublicGitHub()
        require_selected_main(api, REPO, identity[0])
        raw, receipt = admitted_receipt(root, identity[0], args.source_revision, args.publication_sha256)
        if args.mode == "prepare":
            prepare(api, identity, runner_temp, raw, receipt)
        else:
            path = runner_temp / EVIDENCE
            if args.mode in {"provider-check", "observe"}:
                path.mkdir(mode=0o700)
            else:
                require(path.is_dir() and not path.is_symlink() and path.stat().st_uid == os.geteuid()
                        and path.stat().st_mode & 0o7777 == 0o700, "Owned prior custody provider evidence required")
            evidence = path
            if args.mode == "provider-check":
                check_provider(api, identity, runner_temp, evidence, raw, receipt)
            else:
                require_oras(args.oras, runner_temp)
                if args.mode == "publish":
                    require_provider_observation(evidence, identity, raw, receipt)
                execute(api, identity, args.mode, args.oras, runner_temp, evidence, raw, receipt)
    except FAILURES as error:
        if evidence is not None:
            write_metadata(evidence / "hold.json", {"state": "held", "failureClass": type(error).__name__,
                                                     "deploymentAuthorized": False})
        print(f"Functional Web custody held ({type(error).__name__}); use observe after a write opportunity.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
