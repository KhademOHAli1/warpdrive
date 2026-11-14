"""Bind full-SDK Web custody to separately qualified retained-backend evidence.

This module does not qualify a runtime, authorize publication, or widen a narrow
retained-input verifier. Its caller authenticates the original publication and
projection with the existing publication gate and independently pins the actual
installed chain, backend, Engine and completed native qualification records.
"""
from copy import deepcopy
from hashlib import sha256
import re

import component_inputs as inputs
from installed_web_backend import process_witness
from installed_web_sdk_runtime import validate_runtime_binding
from web_sdk_full_receipt import validate_web_sdk_full_receipt

RETAINED = ("worker", "realtime", "migrator")
HASH = re.compile(r"[a-f0-9]{64}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
RELEASE_KIND = "warpdrive-installed-sdk-web-release"
QUALIFICATION_KIND = "warpdrive-sdk-web-retained-backend-qualification"
CHECKS = frozenset({
    "immutable-web-native-custody", "sdk-runtime-packaging",
    "authenticated-http-api", "authenticated-ui-navigation",
    "authenticated-realtime", "retained-worker-queue",
    "old-new-generation-assets", "newsletter-integration-state-preserved", "schema-unchanged",
})
DISABLED_NEWSLETTER_KIND = "warpdrive-disabled-newsletter-integration-witness"
DISABLED_NEWSLETTER_CONFIGURATION = {
    "integrationConfigured": False, "deliveryEnabled": False, "publicSignupEnabled": False,
}
NEWSLETTER_CONFIGURATION_KEYS = (
    "NEWSLETTER_BASE_URL", "NEWSLETTER_API_USER", "NEWSLETTER_API_TOKEN",
    "NEWSLETTER_DELIVERY_ENABLED", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def _pin(value):
    return type(value) is str and HASH.fullmatch(value) is not None


def _record(value, expected, message):
    require(type(value) is dict and _pin(expected) and inputs.content_hash(value) == expected, message)
    return deepcopy(value)


def compare_backend_inputs(sdk_receipt, original_receipt, *, expected_sdk_sha256,
                           expected_original_sha256, original_revision):
    """Compare complete source records; a difference is reported, never accepted."""
    current = _record(sdk_receipt, expected_sdk_sha256, "SDK input receipt changed")
    original = _record(original_receipt, expected_original_sha256, "Original input receipt changed")
    require(type(current.get("sourceRevision")) is str and REVISION.fullmatch(current["sourceRevision"]),
            "Exact SDK source revision required")
    validate_web_sdk_full_receipt(current, expected_revision=current["sourceRevision"])
    inputs.validate_receipt(original)
    require(type(original_revision) is str and REVISION.fullmatch(original_revision),
            "Exact original backend revision required")
    backend = current["backendInputs"]
    require(inputs.canonical(backend["context"]) == inputs.canonical(original["context"])
            and inputs.canonical(backend["policy"]) == inputs.canonical(original["policy"])
            and backend["inputPolicySha256"] == original["inputPolicySha256"],
            "Backend platform, immutable toolchain context or input policy changed")
    components = {}
    for name in RETAINED:
        before, after = original["components"][name], backend["components"][name]
        components[name] = {
            "originalInputSha256": before["componentInputSha256"],
            "currentInputSha256": after["componentInputSha256"],
            "originalRecordSha256": inputs.content_hash(before),
            "currentRecordSha256": inputs.content_hash(after),
            "completeRecordsEqual": inputs.canonical(before) == inputs.canonical(after),
        }
    return {"schemaVersion": 1, "kind": "warpdrive-sdk-installed-backend-comparison",
            "sourceRevision": current["sourceRevision"], "originalBackendRevision": original_revision,
            "sdkInputReceiptSha256": expected_sdk_sha256,
            "originalInputReceiptSha256": expected_original_sha256,
            "contextSha256": inputs.content_hash(backend["context"]),
            "inputPolicySha256": backend["inputPolicySha256"], "components": components,
            "allInputsEqual": all(row["completeRecordsEqual"] for row in components.values()),
            "runtimeCompatibilityQualified": False, "deploymentAuthorized": False}


def _process_record(expected):
    require(type(expected) is dict
            and set(expected) == {"id", "name", "imageId", "pid", "startedAt", "finishedAt",
                              "restartCount", "configSha256", "project", "service"}
            and _pin(expected["id"]) and type(expected["imageId"]) is str
            and DIGEST.fullmatch(expected["imageId"]) and _pin(expected["configSha256"])
            and type(expected["pid"]) is int and 0 < expected["pid"] <= 2**31 - 1
            and type(expected["name"]) is str and re.fullmatch(r"/[A-Za-z0-9_.-]{1,200}", expected["name"])
            and all(type(expected[key]) is str and 0 < len(expected[key]) <= 64
                    and not any(character in expected[key] for character in ("\0", "\r", "\n"))
                    for key in ("startedAt", "finishedAt"))
            and type(expected["restartCount"]) is int and 0 <= expected["restartCount"] <= 2**31 - 1
            and all(expected[key] is None or type(expected[key]) is str
                    and re.fullmatch(r"[A-Za-z0-9_.-]{1,200}", expected[key])
                    for key in ("project", "service")),
            "Exact retained process identity required")


def _disabled_newsletter_witness(expected):
    require(set(expected) == {"schemaVersion", "kind", "web", "configuration"}
            and type(expected["schemaVersion"]) is int and expected["schemaVersion"] == 1
            and expected["kind"] == DISABLED_NEWSLETTER_KIND
            and type(expected["configuration"]) is dict
            and set(expected["configuration"]) == set(DISABLED_NEWSLETTER_CONFIGURATION)
            and all(value is False for value in expected["configuration"].values()),
            "Exact explicit disabled newsletter integration witness required")
    _process_record(expected["web"])


def validate_newsletter_binding(expected, chain):
    """A disabled-state witness belongs to the accepted incumbent Web only."""
    require(type(expected) is dict, "Exact newsletter state witness required")
    if expected.get("kind") == DISABLED_NEWSLETTER_KIND:
        _disabled_newsletter_witness(expected)
        runtime = chain["active"]["slot"]["runtime"]
        require(expected["web"]["id"] == runtime["runtimeId"]
                and expected["web"]["imageId"] == runtime["imageId"]
                and expected["web"]["name"] == "/" + runtime["name"],
                "Disabled newsletter witness differs from the accepted incumbent Web")
    return True


def _newsletter_disabled(row):
    raw = row.get("Config", {}).get("Env")
    require(type(raw) is list and all(type(item) is str and "=" in item for item in raw),
            "Actual Web environment is unavailable")
    environment = {}
    for item in raw:
        key, value = item.split("=", 1)
        require(key not in environment, "Actual Web environment has duplicate keys")
        environment[key] = value
    require(all(not environment.get(key + "_FILE", "").strip() for key in NEWSLETTER_CONFIGURATION_KEYS),
            "Newsletter file-based configuration cannot establish a disabled integration")
    require(all(not environment.get(key, "").strip() for key in NEWSLETTER_CONFIGURATION_KEYS[:3])
            and all(environment.get(key, "false") == "false" for key in NEWSLETTER_CONFIGURATION_KEYS[3:]),
            "Newsletter integration, delivery or public signup is enabled or unknown")
    return DISABLED_NEWSLETTER_CONFIGURATION.copy()


def verify_engine_unchanged(docker, expected, *, expected_sha256):
    """Preserve a running Engine or an explicitly disabled Web integration.

    The disabled path makes no claim that an Engine exists or is qualified. The
    caller binds its Web witness to the accepted chain, and candidate runtime
    admission preserves that Web environment. Raw configuration stays in memory.
    """
    expected = _record(expected, expected_sha256, "Independent newsletter state witness changed")
    if expected.get("kind") == DISABLED_NEWSLETTER_KIND:
        _disabled_newsletter_witness(expected)
        row = docker.inspect(expected["web"]["id"])
        require(process_witness(row, running=True) == expected["web"],
                "Accepted Web process or configuration changed")
        require(_newsletter_disabled(row) == expected["configuration"],
                "Actual disabled newsletter configuration changed")
        return expected
    _process_record(expected)
    actual = process_witness(docker.inspect(expected["id"]), running=True)
    require(actual == expected, "Retained Engine process, image or configuration changed")
    return actual


def build_sdk_release(*, expected_revision, publication_bytes, expected_publication_sha256,
                      projection, expected_projection_sha256, runtime_binding,
                      expected_runtime_binding_sha256, backend_comparison,
                      expected_backend_comparison_sha256, qualification,
                      expected_qualification_sha256, installed_chain,
                      expected_chain_sha256, expected_backend_fingerprint,
                      expected_engine_witness_sha256, expected_contract_review_sha256):
    """Compose already admitted custody with independently pinned native proof.

    The qualification is a separate completed mixed-runtime record. Source
    equality, an unassessed schema3 candidate or projection-only receipt cannot
    substitute for it, including when all three source records happen to match.
    Original candidate pending gates and transport-only booleans are unchanged.
    """
    require(type(publication_bytes) is bytes and 0 < len(publication_bytes) <= 4 * 1024**2
            and _pin(expected_publication_sha256)
            and sha256(publication_bytes).hexdigest() == expected_publication_sha256,
            "Original sealed publication bytes changed")
    publication = inputs.decode(publication_bytes)
    require(publication.get("kind") == "warpdrive-candidate-publication-admission"
            and type(publication.get("schemaVersion")) is int and publication["schemaVersion"] == 1
            and publication.get("repository") == "KhademOHAli1/warpdrive"
            and publication.get("deploymentAuthorized") is False,
            "Ordinary full-source publication admission required")
    projection = _record(projection, expected_projection_sha256, "SDK projection receipt changed")
    comparison = _record(backend_comparison, expected_backend_comparison_sha256, "Backend comparison changed")
    chain = _record(installed_chain, expected_chain_sha256, "Accepted installed chain changed")
    qualified = _record(qualification, expected_qualification_sha256, "Mixed-runtime qualification changed")
    revision = publication["revision"]
    require(type(expected_revision) is str and REVISION.fullmatch(expected_revision)
            and revision == expected_revision
            and projection.get("kind") == "warpdrive-sdk-web-archive-projection"
            and type(projection.get("schemaVersion")) is int and projection["schemaVersion"] == 1
            and projection.get("sourceRevision") == revision
            and projection.get("projectionOnly") is True and projection.get("backendReuseQualified") is False
            and projection.get("installationAuthorized") is False and projection.get("deploymentAuthorized") is False,
            "Exact transport-only full-SDK projection required")
    original, selected, image, provenance = (projection[key] for key in ("original", "selectedWeb", "image", "provenance"))
    require(original["kind"] == "warpdrive-tested-image-bundle"
            and type(original["schemaVersion"]) is int and original["schemaVersion"] == 3
            and original["publicationAdmissionSha256"] == inputs.content_hash(publication)
            and "independently-qualified-component-reuse" in original["candidatePendingGates"]
            and image["imageId"] == selected["configDigest"] and image["sourceRevision"] == revision
            and image["generation"] == "wd-" + revision
            and selected["manifestDigest"] != selected["configDigest"],
            "Original native, config and platform identities are detached")
    require(comparison.get("kind") == "warpdrive-sdk-installed-backend-comparison"
            and type(comparison.get("schemaVersion")) is int and comparison["schemaVersion"] == 1
            and comparison["sourceRevision"] == revision
            and comparison["runtimeCompatibilityQualified"] is False
            and comparison["deploymentAuthorized"] is False and set(comparison["components"]) == set(RETAINED),
            "Complete unqualified backend source comparison required")
    require(chain["backendFingerprint"] == expected_backend_fingerprint
            and _pin(expected_backend_fingerprint) and _pin(expected_engine_witness_sha256)
            and _pin(expected_contract_review_sha256), "Exact installed backend, Engine and contract authority required")
    validate_runtime_binding(runtime_binding, expected_sha256=expected_runtime_binding_sha256,
        authority_sha256=expected_publication_sha256, source_revision=revision,
        image_id=selected["manifestDigest"], tested_config_digest=selected["configDigest"])
    qualification_keys = {"schemaVersion", "kind", "state", "sourceRevision", "publicationReceiptSha256",
                          "projectionReceiptSha256", "backendComparisonSha256", "installedChainSha256",
                          "backendFingerprint", "schemaSha256", "engineWitnessSha256", "contractReviewSha256",
                          "selectedWeb", "retainedComponentRecords", "checks", "limitations"}
    require(set(qualified) == qualification_keys and type(qualified["schemaVersion"]) is int
            and qualified["schemaVersion"] == 1
            and qualified["kind"] == QUALIFICATION_KIND and qualified["state"] == "passed"
            and qualified["sourceRevision"] == revision
            and qualified["publicationReceiptSha256"] == expected_publication_sha256
            and qualified["projectionReceiptSha256"] == expected_projection_sha256
            and qualified["backendComparisonSha256"] == expected_backend_comparison_sha256
            and qualified["installedChainSha256"] == expected_chain_sha256
            and qualified["backendFingerprint"] == expected_backend_fingerprint
            and _pin(qualified["schemaSha256"])
            and all(chain[name]["slot"]["runtime"]["schemaSha256"] == qualified["schemaSha256"]
                    for name in ("active", "previous"))
            and qualified["engineWitnessSha256"] == expected_engine_witness_sha256
            and qualified["contractReviewSha256"] == expected_contract_review_sha256
            and qualified["selectedWeb"] == {"testedNativeImageId": original["testedNativeImageId"],
                "configDigest": selected["configDigest"], "manifestDigest": selected["manifestDigest"]}
            and qualified["retainedComponentRecords"] == {
                name: row["originalRecordSha256"] for name, row in comparison["components"].items()},
            "Native qualification differs from the selected Web and actual retained backend")
    checks = qualified["checks"]
    require(type(checks) is list and len(checks) == len(CHECKS)
            and all(type(check) is dict and set(check) == {"name", "reportSha256"}
                    and check["name"] in CHECKS and _pin(check["reportSha256"]) for check in checks)
            and {check["name"] for check in checks} == CHECKS
            and type(qualified["limitations"]) is list
            and all(type(item) is str and 0 < len(item) <= 2048 for item in qualified["limitations"]),
            "Complete separately pinned native mixed-runtime checks required")
    return {"schemaVersion": 1, "kind": RELEASE_KIND, "sourceRevision": revision,
            "publicationReceiptSha256": expected_publication_sha256, "image": deepcopy(image),
            "provenance": deepcopy(provenance), "projectionReceiptSha256": expected_projection_sha256,
            "runtimeBindingSha256": expected_runtime_binding_sha256,
            "backendReuseQualificationSha256": expected_qualification_sha256}
