"""Verify received functional Web custody before its one-shot native image load."""

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path

from component_inputs import HASH, canonical, content_hash, decode
from installed_web_chain import REPOSITORY, _PROVENANCE_KEYS
from installed_web_image import load_verified_web_archive, require
from installed_web_runtime import ALIAS, IMAGE, REVISION
from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, PLATFORM, _directory, _opened, _record
from web_rollout import _validate as validate_rollout
from web_switch import SwitchConflict


WORKFLOW = "web-functional-qualification.yml"
JOB = "Qualify functional Web against the retained backend"
CATEGORIES = ["/language:actions", "/language:go", "/language:javascript-typescript", "/language:python"]
MANIFEST = "web-functional-bundle.json"
INPUTS = "web-functional-inputs.json"
REPORT = "web-functional-mixed-report.json"
MEMBERS = {INPUTS: MAX_METADATA_BYTES, REPORT: MAX_METADATA_BYTES, ARCHIVE: MAX_ARCHIVE_BYTES}
CHAIN_KEYS = {"targetKey", "backendFingerprint", "acceptedOperationId", "acceptedPlanSha256", "active", "previous"}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _exact(value, keys):
    return type(value) is dict and set(value) == keys


def _installed(chain, expected_sha256):
    require(_matches(HASH, expected_sha256) and _exact(chain, CHAIN_KEYS) and content_hash(chain) == expected_sha256
            and all(_matches(HASH, chain[key]) for key in ("backendFingerprint", "acceptedPlanSha256")),
            "Exact admitted current Web chain required")
    rows = []
    for side in ("active", "previous"):
        item = chain[side]
        require(_exact(item, {"slot", "alias", "provenance", "receiptSha256"}) and _matches(ALIAS, item["alias"])
                and _matches(HASH, item["receiptSha256"]) and _exact(item["slot"], {"runtime", "route"})
                and _exact(item["provenance"], _PROVENANCE_KEYS), "Exact current and previous private Web slots required")
        slot, provenance = item["slot"], item["provenance"]
        runtime = slot["runtime"]
        require(runtime["name"] == item["alias"] and provenance["repository"] == REPOSITORY
                and provenance["revision"] == runtime["sourceRevision"] and _matches(IMAGE, provenance["testedConfigDigest"])
                and all(_matches(HASH, provenance[key]) for key in ("manifestSha256", "archiveSha256", "authoritySha256")),
                "Current Web runtime, route or artifact provenance differs")
        rows.append(provenance)
    try:
        validate_rollout({"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": chain["acceptedOperationId"],
                          "targetKey": chain["targetKey"], "backendFingerprint": chain["backendFingerprint"],
                          "qualificationSha256": chain["acceptedPlanSha256"], "before": chain["previous"]["slot"],
                          "after": chain["active"]["slot"]})
    except (SwitchConflict, KeyError, TypeError):
        require(False, "Current installed Web slots or schema differ")
    active, previous = rows
    require(chain["active"]["receiptSha256"] != chain["previous"]["receiptSha256"]
            and all(active[key] != previous[key] for key in ("testedConfigDigest", "manifestSha256", "archiveSha256", "authoritySha256")),
            "Current installed Web slots must have distinct immutable custody")
    return active, previous


def _publication(raw, pin, revision, lineage, active, previous):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_METADATA_BYTES and _matches(HASH, pin)
            and sha256(raw).hexdigest() == pin and _matches(REVISION, revision)
            and revision not in {active["revision"], previous["revision"]}, "Exact hosted functional publication and candidate source pins required")
    receipt = decode(raw)
    require(_exact(receipt, {"schemaVersion", "kind", "repository", "revision", "workflow", "origin", "jobId", "artifact", "ci",
                             "security", "baseline", "image", "provenance", "qualification", "deploymentAuthorized"})
            and type(receipt["schemaVersion"]) is int and receipt["schemaVersion"] == 1
            and receipt["kind"] == "warpdrive-web-functional-publication-admission" and receipt["repository"] == REPOSITORY
            and receipt["revision"] == revision and receipt["workflow"] == WORKFLOW and receipt["deploymentAuthorized"] is False
            and type(receipt["jobId"]) is int and receipt["jobId"] > 0, "Exact functional Web publication required")
    origin, artifact, security = (receipt[key] for key in ("origin", "artifact", "security"))
    require(_exact(origin, {"kind", "repository", "event", "ref", "runId", "runAttempt"}) and origin["kind"] == "github-actions"
            and origin["repository"] == REPOSITORY and origin["event"] == "workflow_dispatch" and origin["ref"] == "refs/heads/main"
            and all(type(origin[key]) is int and origin[key] > 0 for key in ("runId", "runAttempt")), "Exact functional Web workflow origin required")
    require(_exact(artifact, {"id", "name", "digest", "sizeBytes"}) and type(artifact["id"]) is int and artifact["id"] > 0
            and artifact["name"] == f"web-functional-image-bundle-{revision}-{origin['runId']}-{origin['runAttempt']}"
            and _matches(IMAGE, artifact["digest"]) and type(artifact["sizeBytes"]) is int
            and 0 < artifact["sizeBytes"] <= MAX_ARCHIVE_BYTES + 3 * MAX_METADATA_BYTES + 64 * 1024**2
            and type(security) is dict and security.get("tool") == "CodeQL" and security.get("ref") == origin["ref"]
            and security.get("revision") == revision and security.get("categories") == CATEGORIES
            and security.get("main_bound_before_and_after") is True and type(security.get("blocking_alerts")) is int
            and security["blocking_alerts"] == 0 and type(receipt["ci"]) is list and len(receipt["ci"]) == 7,
            "Functional Web artifact or exact source security evidence differs")
    selected = [row for row in receipt["ci"] if type(row) is dict and row.get("workflow") == WORKFLOW]
    require(len(selected) == 1 and type(selected[0].get("run_id")) is int and selected[0]["run_id"] == origin["runId"] and type(selected[0].get("attempt")) is int and selected[0]["attempt"] == origin["runAttempt"]
            and selected[0].get("jobs") == [JOB], "Exact functional Web attempt and job required")
    baseline, image, provenance, qualification = (receipt[key] for key in ("baseline", "image", "provenance", "qualification"))
    require(_exact(baseline, {"compositeSha256", "installedLineageSha256", "inputSha256", "activeWebRevision", "originalBackendRevision"})
            and baseline["installedLineageSha256"] == lineage and baseline["activeWebRevision"] == active["revision"]
            and all(_matches(HASH, baseline[key]) for key in ("compositeSha256", "inputSha256"))
            and _matches(REVISION, baseline["originalBackendRevision"])
            and baseline["originalBackendRevision"] not in {revision, active["revision"], previous["revision"]},
            "Functional Web artifact differs from current installed lineage or original backend")
    require(_exact(image, {"imageId", "sourceRevision", "runtimeUser", "generation"}) and _matches(IMAGE, image["imageId"])
            and image["imageId"] not in {active["testedConfigDigest"], previous["testedConfigDigest"]}
            and image["sourceRevision"] == revision and image["generation"] == "wd-" + revision
            and isinstance(image["runtimeUser"], str) and 0 < len(image["runtimeUser"]) <= 260,
            "Exact distinct tested functional Web image required")
    require(_exact(provenance, {"bundleManifestSha256", "archiveSha256", "archiveSizeBytes"})
            and all(_matches(HASH, provenance[key]) for key in ("bundleManifestSha256", "archiveSha256"))
            and type(provenance["archiveSizeBytes"]) is int and 0 < provenance["archiveSizeBytes"] <= MAX_ARCHIVE_BYTES
            and _exact(qualification, {"fixtureQualificationSha256", "fixtureBackendFingerprint", "fixtureSchemaSha256", "reportSha256"})
            and all(_matches(HASH, pin) for pin in qualification.values()), "Exact functional Web archive and qualification evidence required")
    return receipt


def import_receipt(receipt, manifest_raw, files, publication_sha256):
    """Return the exact persisted transport receipt. The transport hashes every member."""
    return {"schemaVersion": 1, "kind": "warpdrive-web-functional-artifact-import", "revision": receipt["revision"],
            "publicationReceiptSha256": publication_sha256, "origin": receipt["origin"], "artifactId": receipt["artifact"]["id"],
            "baseline": receipt["baseline"], "bundleManifestSha256": sha256(manifest_raw).hexdigest(),
            "testedConfigDigest": receipt["image"]["imageId"], "files": {MANIFEST: _record(manifest_raw), **files},
            "deploymentAuthorized": False}


def bundle_manifest(raw, receipt):
    """Validate the authenticated manifest and return exact bounded member pins."""
    provenance, baseline = receipt["provenance"], receipt["baseline"]
    require(sha256(raw).hexdigest() == provenance["bundleManifestSha256"], "Functional Web manifest differs from publication")
    manifest = decode(raw)
    require(_exact(manifest, {"schemaVersion", "kind", "revision", "platform", "origin", "baseline", "imageId", "files", "deploymentAuthorized"})
            and type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 1
            and manifest["kind"] == "warpdrive-tested-functional-web-bundle" and manifest["platform"] == PLATFORM
            and manifest["revision"] == receipt["revision"] and manifest["origin"] == receipt["origin"]
            and manifest["baseline"] == baseline and manifest["imageId"] == receipt["image"]["imageId"]
            and manifest["deploymentAuthorized"] is False and _exact(manifest["files"], set(MEMBERS)),
            "Functional Web manifest source, image or baseline differs")
    files = manifest["files"]
    for name, maximum in MEMBERS.items():
        item = files[name]
        require(_exact(item, {"sha256", "sizeBytes"}) and _matches(HASH, item["sha256"])
                and type(item["sizeBytes"]) is int and 0 < item["sizeBytes"] <= maximum, "Exact bounded functional Web file pin required")
    require(files[ARCHIVE] == {"sha256": provenance["archiveSha256"], "sizeBytes": provenance["archiveSizeBytes"]}
            and files[REPORT]["sha256"] == receipt["qualification"]["reportSha256"],
            "Functional Web archive or report pin differs from publication")
    return files


def _metadata(parent, name):
    with _opened(parent, name, MAX_METADATA_BYTES) as (source, size):
        info = os.fstat(source.fileno())
        require(info.st_uid == os.geteuid() and info.st_mode & 0o7777 in (0o400, 0o600),
                "Exact private functional Web metadata file required")
        raw = source.read(size + 1)
        require(len(raw) == size, "Functional Web metadata size changed")
        return raw


def verify_received_functional(directory, publication_bytes, *, expected_publication_sha256, expected_lineage_sha256,
                               expected_revision, installed_chain, import_record):
    """Verify received metadata and import facts. The native loader reads the entire archive."""
    active, previous = _installed(installed_chain, expected_lineage_sha256)
    receipt = _publication(publication_bytes, expected_publication_sha256, expected_revision, expected_lineage_sha256, active, previous)
    require(type(import_record) is dict, "Exact persisted functional Web import receipt required")
    provenance, baseline = receipt["provenance"], receipt["baseline"]
    with _directory(Path(directory)) as parent:
        info = os.fstat(parent)
        require(info.st_uid == os.geteuid() and info.st_mode & 0o7777 == 0o700
                and set(os.listdir(parent)) == {MANIFEST, *MEMBERS}, "Exact private received functional Web bundle required")
        raw = _metadata(parent, MANIFEST)
        files = bundle_manifest(raw, receipt)
        require(canonical(import_record) == canonical(import_receipt(receipt, raw, files, expected_publication_sha256)),
                "Persisted functional Web import receipt differs from exact custody")
        build, report = (_metadata(parent, name) for name in (INPUTS, REPORT))
        facts = decode(build)
        require(_record(build) == files[INPUTS] and _record(report) == files[REPORT]
                and type(facts) is dict and facts.get("kind") == "warpdrive-functional-web-build-inputs"
                and facts.get("revision") == expected_revision and facts.get("activeWebRevision") == active["revision"]
                and facts.get("originalBackendRevision") == baseline["originalBackendRevision"]
                and content_hash(facts) == baseline["inputSha256"], "Functional Web input or report custody differs")
        with _opened(parent, ARCHIVE, MAX_ARCHIVE_BYTES) as (source, size):
            info = os.fstat(source.fileno())
            require(size == provenance["archiveSizeBytes"] and info.st_uid == os.geteuid() and info.st_mode & 0o7777 in (0o400, 0o600),
                    "Private functional Web archive size or mode differs")
    return receipt


def load_installed_functional_image(directory, *, publication_bytes, state_dir, docker, expected_publication_sha256,
                                    expected_lineage_sha256, expected_revision, installed_chain, import_record,
                                    expected_daemon, reconcile=False):
    """Delegate archive, native manifest and one-load journal checks to the installed loader."""
    directory, state_dir = map(Path, (directory, state_dir))
    chain = deepcopy(installed_chain)
    receipt = verify_received_functional(directory, publication_bytes, expected_publication_sha256=expected_publication_sha256,
        expected_lineage_sha256=expected_lineage_sha256, expected_revision=expected_revision, installed_chain=chain,
        import_record=import_record)
    active = chain["active"]["provenance"]
    return load_verified_web_archive(directory, state_dir=state_dir, docker=docker, image=receipt["image"], provenance=receipt["provenance"],
        baseline_revision=active["revision"], baseline_manifest_sha256=active["manifestSha256"], origin=receipt["origin"],
        expected_daemon=expected_daemon, reconcile=reconcile)
