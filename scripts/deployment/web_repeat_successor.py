"""Reconstruct the next active Web artifact from a pinned repeat publication."""

from copy import deepcopy
from hashlib import sha256

from bundle import INPUT_RECEIPT
from candidate import IMAGE_ID, REVISION, require
from component_inputs import HASH, canonical, content_hash, decode, validate_receipt
from web_candidate import _directory, _metadata
from web_composite_baseline import REPO, RETAINED
from web_publication_gate import CATEGORIES
from web_repeat_candidate import MAX_METADATA_BYTES, load_repeat_web_bundle
from web_repeat_publication import JOB, MAX_ZIP_BYTES, WORKFLOW


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _publication(raw, pin, revision):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_METADATA_BYTES and _matches(HASH, pin)
            and sha256(raw).hexdigest() == pin and _matches(REVISION, revision),
            "Separately pinned repeat Web publication bytes required")
    receipt = decode(raw)
    require(type(receipt) is dict and set(receipt) == {
        "schemaVersion", "kind", "repository", "revision", "workflow", "origin", "jobId", "artifact", "ci",
        "security", "baseline", "image", "provenance", "qualification", "presentationProfileSha256",
        "harnessRevision", "toolingRevision", "deploymentAuthorized",
    } and type(receipt["schemaVersion"]) is int and receipt["schemaVersion"] == 2
            and receipt["kind"] == "warpdrive-web-repeat-publication-admission" and receipt["repository"] == REPO
            and receipt["revision"] == revision and receipt["workflow"] == WORKFLOW
            and receipt["deploymentAuthorized"] is False and type(receipt["jobId"]) is int and receipt["jobId"] > 0,
            "Exact hosted repeat publication admission required")
    origin, artifact, security = (receipt[key] for key in ("origin", "artifact", "security"))
    name = f"web-repeat-image-bundle-{revision}-{origin['runId']}-{origin['runAttempt']}"
    require(type(artifact) is dict and set(artifact) == {"id", "name", "digest", "sizeBytes"}
            and type(artifact["id"]) is int and artifact["id"] > 0 and artifact["name"] == name
            and _matches(IMAGE_ID, artifact["digest"]) and type(artifact["sizeBytes"]) is int
            and 0 < artifact["sizeBytes"] <= MAX_ZIP_BYTES, "Repeat publication archive authority differs")
    require(type(security) is dict and security.get("revision") == revision and security.get("ref") == "refs/heads/main"
            and security.get("tool") == "CodeQL" and security.get("categories") == sorted(CATEGORIES)
            and security.get("main_bound_before_and_after") is True and type(security.get("blocking_alerts")) is int
            and security["blocking_alerts"] == 0 and type(receipt["ci"]) is list,
            "Repeat publication lacks exact CodeQL and CI evidence")
    selected = [row for row in receipt["ci"] if row.get("workflow") == WORKFLOW]
    require(len(selected) == 1 and selected[0].get("run_id") == origin["runId"]
            and selected[0].get("attempt") == origin["runAttempt"] and selected[0].get("jobs") == [JOB],
            "Repeat publication CI attempt differs from its artifact origin")
    return receipt


def verify_repeat_successor(
    *, predecessor, repeat_bundle_dir, publication_bytes, expected_publication_sha256, expected_revision,
    predecessor_lineage_sha256,
):
    """Admit the same tested repeat image for the next fixture with the original backend."""
    publication = _publication(publication_bytes, expected_publication_sha256, expected_revision)
    require(publication["baseline"].get("installedLineageSha256") == predecessor_lineage_sha256,
            "Repeat publication was tested against another installed lineage")
    loaded = load_repeat_web_bundle(
        repeat_bundle_dir, expected_revision=expected_revision,
        expected_manifest_sha256=publication["provenance"]["bundleManifestSha256"], composite=predecessor,
        expected_installed_lineage_sha256=predecessor_lineage_sha256,
        expected_profile_sha256=publication["presentationProfileSha256"], expected_harness_revision=publication["harnessRevision"],
        expected_origin=publication["origin"], expected_tooling_revision=publication["toolingRevision"],
    )
    candidate, provenance = loaded["candidate"], loaded["provenance"]
    require(all(canonical(publication[key]) == canonical(candidate[key]) for key in ("baseline", "image", "qualification"))
            and canonical(publication["provenance"]) == canonical(provenance),
            "Repeat publication does not bind this tested image or qualification")
    with _directory(repeat_bundle_dir) as directory:
        raw = _metadata(directory, INPUT_RECEIPT)
    current = validate_receipt(decode(raw))
    old = predecessor["web"]["inputReceipt"]
    admission, qualification = (candidate[key] for key in ("inputProvenance", "qualification"))
    require(sha256(raw).hexdigest() == provenance["inputReceiptFileSha256"]
            and content_hash(current) == admission["candidateInputReceiptSha256"]
            and all(canonical(current["components"][key]) == canonical(old["components"][key]) for key in RETAINED),
            "Successor input bytes or retained backend inputs differ")
    result = deepcopy(predecessor)
    result["web"] = {
        "sourceRevision": expected_revision, "origin": loaded["origin"], "image": candidate["image"],
        "publicationReceiptSha256": expected_publication_sha256, "artifact": publication["artifact"],
        "provenance": provenance, "inputReceipt": current, "inputReceiptSha256": content_hash(current),
    }
    result["qualification"] = {key: qualification[key] for key in (
        "reportSha256", "fixtureQualificationSha256", "fixtureBackendFingerprint", "fixtureSchemaSha256",
    )} | {"retainedComponentInputsEqual": True}
    return result
