"""Admit the exact tested functional Web image to private off-host custody."""

from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import zipfile

from candidate import IMAGE_ID, REVISION, require
from component_inputs import HASH
from publication_gate import (
    CODEQL_WORKFLOW, REPO, WORKFLOW as FULL_WORKFLOW, publication_policy,
    require_selected_main, verify_ci, verify_release_code_scanning,
)
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES
from web_functional_candidate import ARCHIVE, INPUTS, MANIFEST, MIXED, load_functional_bundle
from web_publication_gate import CATEGORIES, CHUNK_BYTES, ZipReader, copy_bytes, download, private_file
from web_repeat_publication import _fsync_directory
from web_successor_lineage import verify_web_successor_lineage


WORKFLOW = "web-functional-qualification.yml"
JOB = "Qualify functional Web against the retained backend"
STEPS = (
    "Verify the selected functional release inputs",
    "Install attested ORAS",
    "Retrieve the exact accepted Web and backend artifacts",
    "Install frozen dependencies into isolated qualification roots",
    "Admit functional source, dependencies and exact Docker context",
    "Build exactly one functional Web image",
    "Qualify mixed browser continuity and retain the tested Web image",
    "Recheck selected main before retaining the functional artifact",
    "Retain exact tested functional Web artifact",
)
ZIP_NAME = "web-functional-bundle.zip"
RECEIPT_NAME = "receipt.json"
INVENTORY = {MANIFEST: MAX_METADATA_BYTES, INPUTS: MAX_METADATA_BYTES, MIXED: MAX_METADATA_BYTES, ARCHIVE: MAX_ARCHIVE_BYTES}
MAX_ZIP_BYTES = sum(INVENTORY.values()) + 64 * 1024**2


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def functional_policy():
    workflows = publication_policy()["required_workflows"]
    require(FULL_WORKFLOW in workflows and WORKFLOW not in workflows, "Ambiguous functional Web source policy")
    return {"required_workflows": {**{name: jobs for name, jobs in workflows.items() if name != FULL_WORKFLOW}, WORKFLOW: [JOB]}}


def admit(api, run_id, revision):
    require(type(run_id) is int and run_id > 0 and _matches(REVISION, revision), "Exact functional workflow run and main revision required")
    require_selected_main(api, REPO, revision)
    repository = api.request(f"repos/{REPO}")
    require(type(repository) is dict and repository.get("full_name") == REPO
            and type(repository.get("id")) is int and repository["id"] > 0, "Canonical repository identity required")
    repository_id = repository["id"]
    run = successful_main_run(api, WORKFLOW, run_id, revision, repository_id, events={"workflow_dispatch"})
    attempt = run["run_attempt"]
    rows = api.pages(f"repos/{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    jobs = [row for row in rows if type(row) is dict and row.get("name") == JOB]
    require(len(jobs) == 1, "Unique functional Web qualification job required")
    job = jobs[0]
    require(type(job.get("id")) is int and job["id"] > 0 and type(job.get("run_id")) is int and job["run_id"] == run_id
            and type(job.get("run_attempt")) is int and job["run_attempt"] == attempt and job.get("head_sha") == revision
            and job.get("status") == "completed" and job.get("conclusion") == "success",
            "Selected exact-attempt functional Web qualification job did not pass")
    steps = job.get("steps")
    require(type(steps) is list and all(type(row) is dict for row in steps), "Exact hosted functional steps required")
    for name in STEPS:
        matched = [row for row in steps if row.get("name") == name]
        allowed = {"success", "skipped"} if name == "Install attested ORAS" else {"success"}
        require(len(matched) == 1 and matched[0].get("status") == "completed" and matched[0].get("conclusion") in allowed,
                "A required functional source, SDK, image, browser or retention step did not pass")
    ci = verify_ci(api, REPO, revision, functional_policy(), dynamic_codeql_workflow=CODEQL_WORKFLOW)
    selected = [row for row in ci if row["workflow"] == WORKFLOW]
    require(len(selected) == 1 and selected[0]["run_id"] == run_id and selected[0]["attempt"] == attempt,
            "Selected attempt is no longer the latest exact-main functional qualification")
    security = verify_release_code_scanning(api, REPO, revision, categories=CATEGORIES)
    artifact = artifact_for_run(api, run, repository_id, f"web-functional-image-bundle-{revision}-{run_id}-{attempt}", maximum=MAX_ZIP_BYTES)
    require_selected_main(api, REPO, revision)
    origin = {"kind": "github-actions", "repository": REPO, "event": run["event"], "ref": "refs/heads/main",
              "runId": run_id, "runAttempt": attempt}
    return {"origin": origin, "jobId": job["id"], "artifact": artifact, "ci": ci, "security": security}


def _file_identity(info):
    return info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def extract_verified_zip(archive, destination, artifact):
    """Recheck exact API ZIP bytes before reading its bounded member inventory."""
    require(type(artifact.get("sizeBytes")) is int and 0 < artifact["sizeBytes"] <= MAX_ZIP_BYTES
            and _matches(IMAGE_ID, artifact.get("digest")), "Exact functional artifact ZIP size and digest required")
    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with ZipReader(io.FileIO(fd, "rb")) as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.geteuid()
                and stat.S_IMODE(before.st_mode) in (0o400, 0o600) and before.st_size == artifact["sizeBytes"],
                "Functional artifact ZIP size, type or custody differs")
        source.maximum_read = CHUNK_BYTES
        require("sha256:" + hashlib.file_digest(source, "sha256").hexdigest() == artifact["digest"], "Functional artifact ZIP digest differs")
        source.maximum_read = 128 * 1024
        with zipfile.ZipFile(source) as package:
            members = package.infolist()
            require(len(members) == len(INVENTORY) and {item.filename for item in members} == set(INVENTORY),
                    "Unexpected, duplicate or missing functional artifact ZIP members")
            for item in members:
                mode = stat.S_IFMT(item.external_attr >> 16)
                require(item.orig_filename == item.filename and not item.is_dir() and mode in (0, stat.S_IFREG)
                        and not (item.flag_bits & 1) and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                        and 0 < item.file_size <= INVENTORY[item.filename], "Unsafe or oversized functional ZIP member")
            destination.mkdir(mode=0o700)
            source.maximum_read = CHUNK_BYTES
            hashes = {}
            for item in members:
                with package.open(item) as stream, private_file(destination / item.filename) as target:
                    hashes[item.filename] = copy_bytes(stream.read, target, item.file_size)
                    target.flush()
                    os.fsync(target.fileno())
        require(_file_identity(before) == _file_identity(os.fstat(source.fileno())) == _file_identity(archive.lstat()),
                "Functional artifact ZIP changed during verification")
    _fsync_directory(destination)
    return hashes[MANIFEST]


def retain(api, run_id, revision, output_dir, *, composite, previous_web, installed_lineage, accepted_plan,
           expected_installed_lineage_sha256, expected_input_sha256, fetch=download,
           core_acceptance=None, core_projection=None, expected_core_acceptance_sha256=None):
    """Retain a tested D ZIP only after exact hosted and private installed admission.

    The caller independently authenticates the two Web projections and the
    original backend composite. Private installed chain and accepted plan are
    verified locally. The retained publication receipt contains no runtime IDs.
    """
    require(type(composite) is dict and composite.get("kind") == "warpdrive-web-composite-baseline"
            and composite.get("schemaVersion") == 1 and composite.get("repository") == REPO
            and composite.get("deploymentAuthorized") is False and _matches(REVISION, revision)
            and _matches(HASH, expected_input_sha256), "Exact functional Web composite and build input pin required")
    baseline, prior = deepcopy(composite), deepcopy(previous_web)
    verified = verify_web_successor_lineage(installed_lineage, expected_lineage_sha256=expected_installed_lineage_sha256,
        accepted_plan=accepted_plan, active_web=baseline["web"], previous_web=prior, original_backend=baseline["backend"],
        core_acceptance=core_acceptance, core_projection=core_projection, expected_core_acceptance_sha256=expected_core_acceptance_sha256)
    require(revision not in {verified[side]["slot"]["runtime"]["sourceRevision"] for side in ("active", "previous")}
            and revision != baseline["backend"]["sourceRevision"], "Functional Web candidate must be a distinct source")
    output = Path(output_dir)
    require(output.is_absolute() and output.parent == output.parent.resolve(strict=True) and not os.path.lexists(output),
            "Fresh canonical private functional output directory required")
    initial = admit(api, run_id, revision)
    output.mkdir(mode=0o700)
    archive, destination = output / ZIP_NAME, output / "bundle"
    fetch(deepcopy(initial["artifact"]), archive)
    manifest_sha256 = extract_verified_zip(archive, destination, initial["artifact"])
    loaded = load_functional_bundle(destination, composite=baseline, revision=revision, origin=initial["origin"],
        expected_manifest_sha256=manifest_sha256, expected_input_sha256=expected_input_sha256,
        installed_lineage_sha256=expected_installed_lineage_sha256)
    require(loaded["image"]["imageId"] != verified["previous"]["provenance"]["testedConfigDigest"],
            "Functional candidate image must differ from the retained previous Web artifact")
    latest = admit(api, run_id, revision)
    require(all(initial[key] == latest[key] for key in ("origin", "jobId", "artifact")),
            "Authenticated functional workflow attempt, job or artifact changed while verifying")
    receipt = {"schemaVersion": 1, "kind": "warpdrive-web-functional-publication-admission", "repository": REPO,
               "revision": revision, "workflow": WORKFLOW, **latest, "baseline": loaded["baseline"], "image": loaded["image"],
               "provenance": {"bundleManifestSha256": loaded["bundleManifestSha256"], "archiveSha256": loaded["archive"]["sha256"],
                              "archiveSizeBytes": loaded["archive"]["sizeBytes"]},
               "qualification": loaded["qualification"], "deploymentAuthorized": False}
    temporary = output / ("." + RECEIPT_NAME)
    with private_file(temporary) as stream:
        stream.write(json.dumps(receipt, sort_keys=True, allow_nan=False).encode() + b"\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, output / RECEIPT_NAME)
    _fsync_directory(output)
    _fsync_directory(output.parent)
    return receipt
