"""Bind an admitted installed Web pair to two independent Web artifacts."""

from copy import deepcopy

from candidate import CandidateError, IMAGE_ID, REVISION, require
from component_inputs import HASH, canonical, content_hash
from installed_web_chain import REPOSITORY, _PROVENANCE_KEYS
from installed_web_runtime import ALIAS
from web_composite_baseline import RETAINED
from web_generation_routes import WebGeneration
from web_rollout import _validate
from web_switch import SwitchConflict


_CHAIN_KEYS = {"targetKey", "backendFingerprint", "acceptedOperationId", "acceptedPlanSha256", "active", "previous"}
_SLOT_KEYS = {"slot", "alias", "provenance", "receiptSha256"}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _artifact(web, item, slot):
    require(type(web) is dict and {"sourceRevision", "image", "publicationReceiptSha256", "provenance"} <= web.keys()
            and type(web["image"]) is dict and type(web["provenance"]) is dict, "Authenticated Web artifact projection required")
    require(type(item) is dict and set(item) == _SLOT_KEYS and type(item["provenance"]) is dict
            and set(item["provenance"]) == _PROVENANCE_KEYS and _matches(HASH, item["receiptSha256"])
            and canonical(item["slot"]) == canonical(slot), "Installed generation receipt differs from the exact accepted slot")
    revision = web["sourceRevision"]
    runtime, route = (slot[key] for key in ("runtime", "route"))
    image, artifact = web["image"], web["provenance"]
    alias = item["alias"]
    require(_matches(REVISION, revision) and runtime["sourceRevision"] == image.get("sourceRevision") == revision
            and route["generation"] == image.get("generation") == "wd-" + revision
            and _matches(ALIAS, alias) and runtime["name"] == alias,
            "Installed Web source, generation or private runtime alias differs")
    WebGeneration(route["generation"], alias)
    expected = {"repository": REPOSITORY, "revision": revision, "manifestSha256": artifact.get("bundleManifestSha256"),
                "archiveSha256": artifact.get("archiveSha256"), "testedConfigDigest": image.get("imageId"),
                "authoritySha256": web["publicationReceiptSha256"]}
    require(_matches(IMAGE_ID, expected["testedConfigDigest"])
            and all(_matches(HASH, expected[key]) for key in ("manifestSha256", "archiveSha256", "authoritySha256"))
            and canonical(item["provenance"]) == canonical(expected), "Installed generation differs from its authenticated Web artifact")
    return expected


def _original_backend(backend, web_artifacts):
    require(type(backend) is dict and {"sourceRevision", "components", "provenance", "inputReceiptSha256"} <= backend.keys()
            and _matches(REVISION, backend["sourceRevision"]) and type(backend["components"]) is dict
            and set(backend["components"]) == set(RETAINED) and type(backend["provenance"]) is dict
            and _matches(HASH, backend["inputReceiptSha256"]), "Authenticated original retained backend projection required")
    revision, provenance = backend["sourceRevision"], backend["provenance"]
    require(all(_matches(HASH, provenance.get(key)) for key in ("bundleManifestSha256", "archiveSha256"))
            and all(revision != web["revision"] and provenance["bundleManifestSha256"] != web["manifestSha256"]
                    and provenance["archiveSha256"] != web["archiveSha256"] for web in web_artifacts),
            "Original backend provenance must be distinct from both Web generations")
    images = []
    for component in backend["components"].values():
        require(type(component) is dict and component.get("sourceRevision") == revision
                and _matches(IMAGE_ID, component.get("imageId"))
                and all(_matches(HASH, component.get(key)) for key in ("inputSha256", "inputPolicySha256")),
                "Protected backend component source or input evidence differs")
        images.append(component["imageId"])
    require(len({*images, *(web["testedConfigDigest"] for web in web_artifacts)}) == len(RETAINED) + len(web_artifacts),
            "Both Web artifact configs and retained backend configs must be distinct")


def verify_web_successor_lineage(lineage, *, expected_lineage_sha256, accepted_plan, active_web, previous_web, original_backend):
    """Verify the next installed chain from independently authenticated inputs.

    `accepted_plan` is the exact already accepted controller journal plan. The
    Web and backend projections come from validated artifact custody. The
    expected chain digest comes from native installed admission. This helper
    validates their agreement without querying a host or granting deployment.
    """
    chain, plan = map(deepcopy, (lineage, accepted_plan))
    require(type(chain) is dict and set(chain) == _CHAIN_KEYS and _matches(HASH, expected_lineage_sha256)
            and content_hash(chain) == expected_lineage_sha256, "Exact independently admitted installed Web chain digest required")
    try:
        _validate(plan)
    except (SwitchConflict, KeyError, TypeError) as error:
        raise CandidateError("Exact accepted installed Web plan required") from error
    require(chain["acceptedPlanSha256"] == content_hash(plan) and chain["acceptedOperationId"] == plan["operationId"]
            and chain["targetKey"] == plan["targetKey"] and chain["backendFingerprint"] == plan["backendFingerprint"],
            "Installed Web chain does not identify the exact accepted plan")
    active = _artifact(active_web, chain["active"], plan["after"])
    previous = _artifact(previous_web, chain["previous"], plan["before"])
    require(chain["active"]["receiptSha256"] != chain["previous"]["receiptSha256"]
            and all(active[key] != previous[key] for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
            "Active and previous Web generations require separate immutable receipts and artifacts")
    _original_backend(original_backend, (active, previous))
    return chain
