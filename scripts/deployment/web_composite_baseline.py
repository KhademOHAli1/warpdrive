"""Verify an admitted Web artifact with the independently retained backend bundle."""

from hashlib import sha256
from pathlib import Path

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, load_bundle, regular_file
from candidate import IMAGE_ID, REVISION, require
import component_inputs as inputs
from web_candidate import MIXED, _directory, _main_origin, _metadata, load_web_bundle
from web_publication_gate import CATEGORIES, JOB, MAX_ZIP_BYTES, REPO, WORKFLOW


RETAINED = ("worker", "realtime", "migrator")
_RECEIPT_KEYS = {"schemaVersion", "kind", "repository", "revision", "workflow", "origin", "jobId", "artifact",
                 "ci", "security", "baseline", "image", "provenance", "deploymentAuthorized"}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _receipt(raw, expected):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_METADATA_BYTES and _matches(inputs.HASH, expected)
            and sha256(raw).hexdigest() == expected, "Authenticated Web publication receipt SHA-256 differs")
    value = inputs.decode(raw)
    require(type(value) is dict and set(value) == _RECEIPT_KEYS and type(value["schemaVersion"]) is int
            and value["schemaVersion"] == 1 and value["kind"] == "warpdrive-web-publication-admission"
            and value["repository"] == REPO and value["workflow"] == WORKFLOW
            and _matches(REVISION, value["revision"]) and value["deploymentAuthorized"] is False,
            "Exact hosted Web publication receipt required")
    origin = _main_origin(value["origin"])
    require(origin["repository"] == REPO and origin["event"] == "workflow_dispatch", "Web publication origin differs")
    artifact, security = value["artifact"], value["security"]
    name = f"web-image-bundle-{value['revision']}-{origin['runId']}-{origin['runAttempt']}"
    require(type(artifact) is dict and set(artifact) == {"id", "name", "digest", "sizeBytes"}
            and type(artifact["id"]) is int and artifact["id"] > 0 and artifact["name"] == name
            and _matches(IMAGE_ID, artifact["digest"]) and type(artifact["sizeBytes"]) is int
            and 0 < artifact["sizeBytes"] <= MAX_ZIP_BYTES and type(value["jobId"]) is int and value["jobId"] > 0,
            "Admitted Web artifact identity differs")
    require(type(security) is dict and security.get("revision") == value["revision"] and security.get("ref") == origin["ref"]
            and security.get("tool") == "CodeQL" and security.get("categories") == sorted(CATEGORIES)
            and security.get("main_bound_before_and_after") is True and type(security.get("blocking_alerts")) is int
            and security["blocking_alerts"] == 0 and type(value["ci"]) is list and bool(value["ci"]),
            "Admitted Web source security or CI evidence differs")
    selected = [row for row in value["ci"] if type(row) is dict and row.get("workflow") == WORKFLOW]
    require(len(selected) == 1 and type(selected[0].get("run_id")) is int and selected[0]["run_id"] == origin["runId"]
            and type(selected[0].get("attempt")) is int and selected[0]["attempt"] == origin["runAttempt"]
            and selected[0].get("jobs") == [JOB], "Admitted Web CI attempt differs from its artifact origin")
    return value


def _binding(directory, *, name, digest):
    with _directory(directory) as parent:
        raw = _metadata(parent, name)
    require(sha256(raw).hexdigest() == digest, "Verified Web bundle metadata changed")
    return inputs.decode(raw)


def verify_web_composite_baseline(
    *, web_receipt: bytes, expected_web_receipt_sha256: str, web_bundle_dir: Path,
    backend_bundle_dir: Path, expected_backend_manifest_sha256: str,
) -> dict:
    """Revalidate both local bundles under separately authenticated custody pins.

    No live CI, installation or PostgreSQL check is implied. The schema and
    backend fingerprint returned here describe the retained browser fixture.
    """
    publication = _receipt(web_receipt, expected_web_receipt_sha256)
    provenance = publication["provenance"]
    backend_pin = publication["baseline"]
    require(type(provenance) is dict and _matches(inputs.HASH, provenance.get("bundleManifestSha256"))
            and type(backend_pin) is dict and _matches(REVISION, backend_pin.get("revision"))
            and _matches(inputs.HASH, expected_backend_manifest_sha256)
            and backend_pin.get("manifestSha256") == expected_backend_manifest_sha256,
            "Separately authenticated original backend manifest required")
    web_dir, backend_dir = Path(web_bundle_dir), Path(backend_bundle_dir)
    require(web_dir.is_absolute() and backend_dir.is_absolute() and web_dir.resolve(strict=True) == web_dir
            and backend_dir.resolve(strict=True) == backend_dir and not web_dir.is_relative_to(backend_dir)
            and not backend_dir.is_relative_to(web_dir), "Separate canonical Web and backend bundle directories required")
    web_revision, backend_revision = publication["revision"], backend_pin["revision"]
    web = load_web_bundle(web_dir, expected_revision=web_revision, expected_manifest_sha256=provenance["bundleManifestSha256"],
                          baseline_revision=backend_revision, baseline_manifest_sha256=expected_backend_manifest_sha256,
                          expected_origin=publication["origin"])
    candidate = web["candidate"]
    require(inputs.canonical(publication["image"]) == inputs.canonical(candidate["image"])
            and inputs.canonical(backend_pin) == inputs.canonical(candidate["baseline"])
            and inputs.canonical(provenance) == inputs.canonical(web["provenance"]),
            "Web publication does not bind the verified Web archive and backend")

    backend = load_bundle(backend_dir, expected_revision=backend_revision)
    original = backend["candidate"]
    require(original["schemaVersion"] == 2 and backend["origin"] == backend_pin["origin"]
            and _main_origin(backend["origin"])["repository"] == REPO
            and backend["provenance"] == {"bundleManifestSha256": expected_backend_manifest_sha256,
                                           "archiveSha256": backend_pin["archiveSha256"]}
            and {name: item["imageId"] for name, item in original["components"].items()} == backend_pin["imageIds"],
            "Retained backend bundle differs from the admitted exact A artifact")

    backend_inputs = inputs.load_receipt(regular_file(backend_dir, INPUT_RECEIPT, MAX_METADATA_BYTES))
    web_inputs = _binding(web_dir, name=INPUT_RECEIPT, digest=provenance["inputReceiptFileSha256"])
    delta = candidate["inputProvenance"]
    require(inputs.content_hash(backend_inputs) == original["inputProvenance"]["receiptSha256"]
            == delta["baselineCoreInputReceiptSha256"]
            and inputs.content_hash(web_inputs) == delta["currentCoreInputReceiptSha256"]
            and all(inputs.canonical(backend_inputs["components"][name]) == inputs.canonical(web_inputs["components"][name])
                    for name in RETAINED), "Exact retained backend component inputs differ from Web qualification")

    report_hash = candidate["qualification"]["reportSha256"]
    mixed = _binding(web_dir, name=MIXED, digest=report_hash)
    native = mixed["checks"][2]["detail"]
    qualification = native["qualification"]
    return {
        "schemaVersion": 1, "kind": "warpdrive-web-composite-baseline", "repository": REPO,
        "platform": candidate["platform"], "deploymentAuthorized": False,
        "web": {"sourceRevision": web_revision, "origin": web["origin"], "image": candidate["image"],
                "publicationReceiptSha256": expected_web_receipt_sha256, "artifact": publication["artifact"],
                "provenance": web["provenance"], "inputReceipt": web_inputs,
                "inputReceiptSha256": delta["currentCoreInputReceiptSha256"]},
        "backend": {"sourceRevision": backend_revision, "origin": backend["origin"],
                    "components": {name: original["components"][name] for name in RETAINED},
                    "provenance": backend["provenance"], "inputReceiptSha256": delta["baselineCoreInputReceiptSha256"]},
        "qualification": {"reportSha256": report_hash, "fixtureQualificationSha256": native["qualificationSha256"],
                          "fixtureBackendFingerprint": qualification["backendFingerprint"],
                          "fixtureSchemaSha256": qualification["slots"][candidate["image"]["generation"]]["runtime"]["schemaSha256"],
                          "retainedComponentInputsEqual": True},
    }
