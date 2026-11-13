"""Seal the first installed Web pair from accepted state and independent custody."""

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import re
import tempfile

from component_inputs import decode
from installed_web_chain import REPOSITORY, _admit_journals, _directory, _private_bytes, _state
from web_candidate import ARCHIVE, MANIFEST
from web_composite_baseline import _receipt as web_publication
from web_rollout import _record, _validate
from web_switch import HASH, IMAGE, MAX_BYTES, _fsync, _lock, _matches, canonical, content_hash, require


OPERATION = re.compile(r"web-([a-f0-9]{12})(?:-reapply)?\Z")
EVIDENCE_KEYS = {"originalPublication", "originalCustody", "originalLoad", "webPublication", "webImport", "webLoad", "boundRelease"}


def _pinned(raw, digest, name):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES and _matches(HASH, digest)
            and sha256(raw).hexdigest() == digest, f"Exact {name} receipt SHA-256 required")
    return decode(raw)


def _original_provenance(evidence, publication, plan, authority_sha, custody_sha, load_sha):
    original = _pinned(evidence["originalPublication"], authority_sha, "original publication")
    custody = _pinned(evidence["originalCustody"], custody_sha, "original artifact custody")
    loaded = _pinned(evidence["originalLoad"], load_sha, "original native load")
    baseline = publication["baseline"]
    runtime = plan["before"]["runtime"]
    origin = baseline["origin"]
    require(original["kind"] == "warpdrive-candidate-publication-admission"
            and original["repository"] == origin["repository"] == REPOSITORY
            and original["revision"] == baseline["revision"] == runtime["sourceRevision"]
            and original["deploymentAuthorized"] is False
            and original["producer"] == {key: origin[key] for key in ("ref", "event", "runId", "runAttempt")},
            "Original publication differs from the qualified Web baseline")
    require(custody["revision"] == original["revision"] and custody["artifactId"] == original["artifact"]["id"]
            and custody["zipDigest"] == original["artifact"]["digest"]
            and all(custody[key] == origin[key] for key in ("runId", "runAttempt"))
            and custody["bundleManifestSha256"] == baseline["manifestSha256"]
            and custody["archiveSha256"] == baseline["archiveSha256"] and custody["imageIds"] == baseline["imageIds"],
            "Original artifact custody differs from the qualified Web baseline")
    require(loaded["kind"] == "warpdrive-core-image-load" and loaded["state"] == "verified"
            and loaded["deploymentAuthorized"] is False and loaded["revision"] == original["revision"]
            and loaded["manifestSha256"] == baseline["manifestSha256"]
            and loaded["testedConfigDigests"] == baseline["imageIds"]
            and loaded["imageIds"]["web"] == runtime["imageId"], "Original native Web image differs from the accepted plan")
    return {"repository": REPOSITORY, "revision": original["revision"], "manifestSha256": baseline["manifestSha256"],
            "archiveSha256": baseline["archiveSha256"], "testedConfigDigest": baseline["imageIds"]["web"],
            "authoritySha256": authority_sha}


def _web_provenance(evidence, publication, plan, alias, authority_sha):
    loaded, imported, bound = (evidence[key] for key in ("webLoad", "webImport", "boundRelease"))
    runtime, route = (plan["after"][key] for key in ("runtime", "route"))
    revision, origin, baseline = (publication[key] for key in ("revision", "origin", "baseline"))
    image, provenance = publication["image"], publication["provenance"]
    manifest, archive = (provenance[key] for key in ("bundleManifestSha256", "archiveSha256"))
    config = image["imageId"]
    require(revision == image["sourceRevision"] == runtime["sourceRevision"] and image["generation"] == route["generation"]
            and runtime["name"] == alias and _matches(IMAGE, config), "Web publication differs from the accepted generation")
    require(imported["kind"] == "warpdrive-web-artifact-import" and imported["deploymentAuthorized"] is False
            and imported["revision"] == revision and imported["origin"] == origin
            and imported["artifactId"] == publication["artifact"]["id"] and imported["publicationReceiptSha256"] == authority_sha
            and imported["baselineRevision"] == baseline["revision"]
            and imported["baselineManifestSha256"] == baseline["manifestSha256"]
            and imported["bundleManifestSha256"] == manifest and imported["testedConfigDigest"] == config
            and imported["files"][MANIFEST]["sha256"] == manifest
            and imported["files"][ARCHIVE] == {"sha256": archive, "sizeBytes": provenance["archiveSizeBytes"]},
            "Installed artifact import differs from the authenticated Web publication")
    require(loaded["kind"] == "warpdrive-installed-web-image-load" and loaded["state"] == "verified"
            and loaded["deploymentAuthorized"] is False and loaded["sourceRevision"] == revision and loaded["origin"] == origin
            and loaded["baselineRevision"] == baseline["revision"] and loaded["baselineManifestSha256"] == baseline["manifestSha256"]
            and loaded["bundleManifestSha256"] == manifest and loaded["archiveSha256"] == archive
            and loaded["archiveSizeBytes"] == provenance["archiveSizeBytes"] and loaded["testedConfigDigest"] == config
            and loaded["manifestDigest"] == loaded["imageId"] == runtime["imageId"],
            "Installed Web image load differs from the authenticated artifact or accepted runtime")
    inputs = bound["inputs"]
    require(content_hash(bound) == plan["qualificationSha256"] and bound["publicationReceiptSha256"] == authority_sha
            and bound["artifactOrigin"] == origin and bound["daemon"] == loaded["daemon"]
            and bound["backend"]["backendFingerprint"] == plan["backendFingerprint"]
            and bound["backend"]["schemaSha256"] == runtime["schemaSha256"]
            and inputs["operationId"] == plan["operationId"].removesuffix("-reapply") and inputs["candidateAlias"] == alias
            and inputs["baselineRevision"] == baseline["revision"] and inputs["candidateRevision"] == revision
            and inputs["bundleManifestSha256"] == manifest and inputs["archiveSha256"] == archive
            and inputs["testedConfigDigest"] == config, "Installed Web bind evidence differs from the accepted plan")
    incumbent = bound["incumbent"]["app"]
    require(incumbent["id"] == plan["before"]["runtime"]["runtimeId"]
            and incumbent["imageId"] == plan["before"]["runtime"]["imageId"],
            "Retained original Web differs from the installed bind evidence")
    return {"repository": REPOSITORY, "revision": revision, "manifestSha256": manifest, "archiveSha256": archive,
            "testedConfigDigest": config, "authoritySha256": authority_sha}


def _generation(plan, side, alias, provenance):
    require(all(_matches(HASH, provenance[key]) for key in ("manifestSha256", "archiveSha256", "authoritySha256"))
            and _matches(IMAGE, provenance["testedConfigDigest"]), "Exact Web artifact provenance digests required")
    return {"schemaVersion": 1, "kind": "warpdrive-installed-web-generation", "targetKey": plan["targetKey"],
            "backendFingerprint": plan["backendFingerprint"], "runtime": plan[side]["runtime"], "alias": alias,
            "provenance": provenance}


def _assert_existing(path, raw):
    if not os.path.lexists(path):
        return False
    require(_private_bytes(path, modes=(0o400,)) == raw, "Existing installed Web lineage evidence differs")
    return True


def _seal(path, raw):
    if _assert_existing(path, raw):
        return
    fd, temporary = tempfile.mkstemp(prefix=".lineage-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fchmod(output.fileno(), 0o400)
            os.fsync(output.fileno())
        os.link(temporary, path, follow_symlinks=False)
    finally:
        Path(temporary).unlink()
        _fsync(path.parent)
    require(_assert_existing(path, raw), "Sealed installed Web lineage evidence is missing")


def seal_first_installed_web_lineage(state_dir, *, output_dir, expected_operation_id, expected_plan_sha256,
                                    expected_a_authority_sha256, expected_a_custody_sha256, expected_a_load_sha256,
                                    expected_b_authority_sha256,
                                    evidence, observe_installed):
    """Seal exact A and B receipts without changing accepted state or traffic.

    The caller supplies authenticated receipts and an independently observed snapshot.
    The observer takes no arguments and returns the exact runtime, alias, public
    health, ingress and live/durable configuration facts defined below. The caller
    owns production mutation exclusion beyond the controller's state-directory lock.
    A lineage index is written last, only after a second matching observation.
    """
    state_dir, output_dir = map(Path, (state_dir, output_dir))
    _directory(state_dir)
    _directory(output_dir)
    require(not output_dir.is_relative_to(state_dir) and not state_dir.is_relative_to(output_dir),
            "Distinct private Web state and lineage directories required")
    selected = OPERATION.fullmatch(expected_operation_id) if isinstance(expected_operation_id, str) else None
    require(selected and _matches(HASH, expected_plan_sha256) and type(evidence) is dict and set(evidence) == EVIDENCE_KEYS,
            "Exact first installed Web lineage inputs required")
    evidence = deepcopy(evidence)
    alias = "warpdrive-web-" + selected[1]
    operations = state_dir / "web-rollouts"
    pointer = state_dir / "accepted-web-generation.json"
    journal_path = operations / (expected_operation_id + ".json")
    with _lock(state_dir):
        _directory(operations)
        journal = _state(journal_path)
        plan = journal["plan"]
        _validate(plan)
        require(journal["state"] == "accepted" and plan["operationId"] == expected_operation_id
                and content_hash(plan) == expected_plan_sha256, "Exact first installed Web plan was never accepted")
        _admit_journals(operations, plan)
        require(_state(pointer) == _record(plan, plan["after"]), "Current accepted Web pointer differs from the first lineage")
        publication = web_publication(evidence["webPublication"], expected_b_authority_sha256)
        before = _original_provenance(evidence, publication, plan, expected_a_authority_sha256,
                                      expected_a_custody_sha256, expected_a_load_sha256)
        after = _web_provenance(evidence, publication, plan, alias, expected_b_authority_sha256)
        require(all(before[key] != after[key] for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
                "Distinct original and successor Web artifacts required")
        old, new = plan["before"], plan["after"]
        route = new["route"]
        expected = {"beforeRuntime": old["runtime"], "afterRuntime": new["runtime"],
                    "backendFingerprint": plan["backendFingerprint"], "route": route,
                    "aliases": {old["route"]["generation"]: "app", route["generation"]: alias},
                    "liveConfigSha256": route["fingerprint"], "autosaveConfigSha256": route["fingerprint"],
                    "publicSourceRevision": after["revision"], "publicHealthy": True, "ingressReady": True}
        require(canonical(observe_installed()) == canonical(expected), "Installed Web pair, backend or public ingress differs")
        records = {"active": _generation(plan, "after", alias, after), "previous": _generation(plan, "before", "app", before)}
        sealed = {name: canonical(record) + b"\n" for name, record in records.items()}
        index = {"schemaVersion": 1, "kind": "warpdrive-first-installed-web-lineage", "targetKey": plan["targetKey"],
                 "acceptedOperationId": expected_operation_id, "acceptedPlanSha256": expected_plan_sha256,
                 "backendFingerprint": plan["backendFingerprint"], "liveConfigSha256": route["fingerprint"],
                 "activeSha256": sha256(sealed["active"]).hexdigest(), "previousSha256": sha256(sealed["previous"]).hexdigest()}
        index_path = output_dir / "lineage.json"
        index_raw = canonical(index) + b"\n"
        complete = _assert_existing(index_path, index_raw)
        for name, raw in sealed.items():
            present = _assert_existing(output_dir / f"{name}.json", raw)
            require(not complete or present, "Sealed lineage index refers to missing generation evidence")
        for name, raw in sealed.items():
            _seal(output_dir / f"{name}.json", raw)
        require(_state(journal_path) == journal and _state(pointer) == _record(plan, new)
                and canonical(observe_installed()) == canonical(expected), "Installed Web authority changed during lineage sealing")
        _seal(index_path, index_raw)
    return index
