"""Project initial Core activation over an independently accepted Web lineage."""

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Literal, TypedDict

from installed_web_chain import REPOSITORY, _directory, _state
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, IMAGE, NAME, SwitchConflict, _matches, _route, _runtime, canonical, content_hash, require


_CORE_ACTIVATION_OPERATION = re.compile(r"core-activation-[0-9a-f]{40}\Z")


class WebRoute(TypedDict):
    generation: str
    fingerprint: str
    runtimeId: str


class WebSlot(TypedDict):
    runtime: dict[str, str | int | bool]
    route: WebRoute


class WebRolloutPlan(TypedDict):
    schemaVersion: Literal[1]
    kind: Literal["warpdrive-web-rollout"]
    operationId: str
    targetKey: str
    before: WebSlot
    after: WebSlot
    backendFingerprint: str
    qualificationSha256: str


class WebArtifactProvenance(TypedDict):
    repository: str
    revision: str
    manifestSha256: str
    archiveSha256: str
    testedConfigDigest: str
    authoritySha256: str


class WebGenerationEvidence(TypedDict):
    slot: WebSlot
    alias: str
    provenance: WebArtifactProvenance
    receiptSha256: str


class InstalledWebChain(TypedDict):
    targetKey: str
    backendFingerprint: str
    acceptedOperationId: str
    acceptedPlanSha256: str
    active: WebGenerationEvidence
    previous: WebGenerationEvidence


class CoreActivationBinding(TypedDict):
    schemaVersion: Literal[1]
    kind: Literal["warpdrive-installed-core-activation"]
    targetKey: str
    acceptedChainSha256: str
    coreAuthoritySha256: str
    oldBackendFingerprint: str
    newBackendFingerprint: str
    oldRouteSha256: str
    newRouteSha256: str


class CoreActivationRecord(CoreActivationBinding):
    state: Literal["route-verified-lineage-pending"]


class AcceptedWebPointer(TypedDict):
    schemaVersion: Literal[1]
    kind: Literal["warpdrive-accepted-web-generation"]
    targetKey: str
    backendFingerprint: str
    slot: WebSlot


@dataclass(frozen=True)
class InitialCoreLineageProjection:
    accepted_pointer: AcceptedWebPointer
    chain: InstalledWebChain
    original_chain_sha256: str
    core_authority_sha256: str


def _validate_generation(evidence: WebGenerationEvidence, slot: WebSlot) -> None:
    require(type(evidence) is dict and set(evidence) == set(WebGenerationEvidence.__annotations__)
            and _matches(HASH, evidence["receiptSha256"]), "Exact historical Web generation receipt pin required")
    historical_slot = evidence["slot"]
    require(type(historical_slot) is dict and set(historical_slot) == set(WebSlot.__annotations__),
            "Complete historical Web generation slot required")
    _runtime(historical_slot["runtime"])
    _route(historical_slot["route"])
    require(historical_slot == slot, "Historical Web generation slot differs from the accepted plan")
    try:
        WebGeneration(slot["route"]["generation"], evidence["alias"])
    except ValueError:
        raise SwitchConflict("Historical Web generation has an invalid alias") from None
    provenance = evidence["provenance"]
    require(type(provenance) is dict and set(provenance) == set(WebArtifactProvenance.__annotations__)
            and provenance["repository"] == REPOSITORY and provenance["revision"] == slot["runtime"]["sourceRevision"]
            and _matches(IMAGE, provenance["testedConfigDigest"])
            and all(_matches(HASH, provenance[key]) for key in ("manifestSha256", "archiveSha256", "authoritySha256")),
            "Historical Web artifact provenance differs from its source or digest pins")


def project_initial_core_lineage(
    *,
    accepted_plan: WebRolloutPlan,
    expected_plan_sha256: str,
    accepted_chain: InstalledWebChain,
    expected_chain_sha256: str,
    activation_binding: CoreActivationBinding,
    activation_record: CoreActivationRecord,
    expected_activation_operation_id: str,
    expected_activation_plan_sha256: str,
    expected_core_authority_sha256: str,
    expected_core_backend_fingerprint: str,
) -> InitialCoreLineageProjection:
    """Derive a same-generation pointer and chain from authenticated inputs.

    The caller admits the original accepted journal and both raw generation
    receipts before supplying the historical plan and chain. It reads the
    activation payload from the protected journal named by the independently
    pinned operation ID and supplies independent transition and Core authority
    digests. This function performs no writes. The historical accepted plan
    and raw generation receipts still describe their original Web acceptance.
    """
    _validate(accepted_plan)
    require(_matches(HASH, expected_plan_sha256) and content_hash(accepted_plan) == expected_plan_sha256,
            "Independent historical Web plan digest differs")
    require(type(accepted_chain) is dict and set(accepted_chain) == set(InstalledWebChain.__annotations__)
            and accepted_chain["targetKey"] == accepted_plan["targetKey"]
            and accepted_chain["backendFingerprint"] == accepted_plan["backendFingerprint"]
            and accepted_chain["acceptedOperationId"] == accepted_plan["operationId"]
            and accepted_chain["acceptedPlanSha256"] == expected_plan_sha256,
            "Historical Web chain differs from the accepted plan")
    active, previous = accepted_chain["active"], accepted_chain["previous"]
    _validate_generation(active, accepted_plan["after"])
    _validate_generation(previous, accepted_plan["before"])
    require(active["alias"] != previous["alias"] and active["receiptSha256"] != previous["receiptSha256"]
            and all(active["provenance"][key] != previous["provenance"][key]
                    for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
            "Distinct historical Web aliases and artifact receipts required")
    require(_matches(HASH, expected_chain_sha256) and content_hash(accepted_chain) == expected_chain_sha256,
            "Independent historical Web chain digest differs")

    require(_matches(HASH, expected_core_authority_sha256) and _matches(HASH, expected_core_backend_fingerprint)
            and expected_core_backend_fingerprint != accepted_plan["backendFingerprint"],
            "Independent Core authority and changed backend fingerprint required")
    old_route = active["slot"]["route"]["fingerprint"]
    require(type(activation_binding) is dict and set(activation_binding) == set(CoreActivationBinding.__annotations__)
            and type(activation_binding["schemaVersion"]) is int and activation_binding["schemaVersion"] == 1
            and activation_binding["kind"] == "warpdrive-installed-core-activation"
            and activation_binding["targetKey"] == accepted_chain["targetKey"]
            and activation_binding["acceptedChainSha256"] == expected_chain_sha256
            and activation_binding["coreAuthoritySha256"] == expected_core_authority_sha256
            and activation_binding["oldBackendFingerprint"] == accepted_chain["backendFingerprint"]
            and activation_binding["newBackendFingerprint"] == expected_core_backend_fingerprint
            and activation_binding["oldRouteSha256"] == old_route and _matches(HASH, activation_binding["newRouteSha256"])
            and activation_binding["newRouteSha256"] not in {old_route, previous["slot"]["route"]["fingerprint"]},
            "Core activation binding differs from the historical chain or independent Core authority")
    activation_digest = content_hash(activation_binding)
    require(expected_activation_plan_sha256 == activation_digest
            and expected_activation_operation_id == "core-activation-" + activation_digest[:40],
            "Core activation digest or operation ID differs")
    require(type(activation_record) is dict and type(activation_record.get("schemaVersion")) is int
            and activation_record == {**activation_binding, "state": "route-verified-lineage-pending"},
            "Exact Core activation route-verified-lineage-pending journal required")

    chain = deepcopy(accepted_chain)
    chain["backendFingerprint"] = expected_core_backend_fingerprint
    chain["active"]["slot"]["route"]["fingerprint"] = activation_binding["newRouteSha256"]
    pointer = _record(chain, deepcopy(chain["active"]["slot"]))
    return InitialCoreLineageProjection(accepted_pointer=pointer, chain=chain, original_chain_sha256=expected_chain_sha256,
                                        core_authority_sha256=expected_core_authority_sha256)


def verify_projected_core_predecessor(
    state: Path, *, chain: InstalledWebChain, activation_operation_id: str, expected_activation_lineage_sha256: str,
) -> InitialCoreLineageProjection:
    """Verify the accepted initial Core lineage under the caller's state lock.

    The caller independently pins the operation and canonical acceptance
    payload. Callers separately check the current pointer and journal inventory
    where their operation requires it. Finalization can use this readback while
    the exact verified activation journal still holds routine operations.
    """
    require(_matches(_CORE_ACTIVATION_OPERATION, activation_operation_id)
            and _matches(HASH, expected_activation_lineage_sha256), "Independent Core lineage acceptance pins required")
    state = Path(state)
    accepted = _state(state / (activation_operation_id + "-lineage-accepted.json"))
    seal = _state(state / (activation_operation_id + "-lineage-projection.json"))
    require(type(chain) is dict and _matches(NAME, chain.get("acceptedOperationId")), "Exact projected predecessor required")
    operations = state / "web-rollouts"
    _directory(operations)
    journal = _state(operations / (chain["acceptedOperationId"] + ".json"))
    require(type(journal) is dict and set(journal) == {"plan", "state"} and journal["state"] == "accepted",
            "Original Web rollout was never accepted")
    projection = verify_core_acceptance_records(chain=chain, accepted_plan=journal["plan"], accepted=accepted, seal=seal,
        activation_operation_id=activation_operation_id, expected_activation_lineage_sha256=expected_activation_lineage_sha256)
    pending = operations / (activation_operation_id + ".json")
    try:
        pending.lstat()
    except FileNotFoundError:
        return projection
    require(_state(pending) == {**accepted["activationBinding"], "state": "route-verified-lineage-pending"},
            "Exact Core activation route-verified-lineage-pending journal required")
    return projection


def verify_core_acceptance_records(*, chain, accepted_plan, accepted, seal, activation_operation_id,
                                   expected_activation_lineage_sha256):
    """Verify copied acceptance and projection records against an independent native pin."""
    require(type(accepted) is dict and set(accepted) == {"schemaVersion", "kind", "activationBinding", "projectionSealSha256",
                                                       "projectedChainSha256", "activationOperationId"}
            and type(accepted["schemaVersion"]) is int and accepted["schemaVersion"] == 1
            and accepted["kind"] == "warpdrive-installed-core-lineage-accepted"
            and accepted["activationOperationId"] == activation_operation_id
            and _matches(HASH, accepted["projectionSealSha256"]) and _matches(HASH, accepted["projectedChainSha256"])
            and content_hash(accepted) == expected_activation_lineage_sha256, "Pinned Core lineage acceptance differs")

    binding = accepted["activationBinding"]
    require(type(binding) is dict and set(binding) == set(CoreActivationBinding.__annotations__),
            "Exact accepted Core activation binding required")
    activation_digest = content_hash(binding)
    require(activation_operation_id == "core-activation-" + activation_digest[:40], "Core activation operation differs from its binding")
    require(type(chain) is dict and set(chain) == set(InstalledWebChain.__annotations__)
            and _matches(NAME, chain["acceptedOperationId"]) and type(chain["active"]) is dict
            and type(chain["active"].get("slot")) is dict and type(chain["active"]["slot"].get("route")) is dict
            and content_hash(chain) == accepted["projectedChainSha256"], "Projected Core predecessor chain differs from acceptance")
    require(type(seal) is dict and content_hash(seal) == accepted["projectionSealSha256"], "Pinned Core lineage projection seal differs")

    historical = deepcopy(chain)
    historical["backendFingerprint"] = binding["oldBackendFingerprint"]
    historical["active"]["slot"]["route"]["fingerprint"] = binding["oldRouteSha256"]

    projection = project_initial_core_lineage(
        accepted_plan=accepted_plan, expected_plan_sha256=chain["acceptedPlanSha256"], accepted_chain=historical,
        expected_chain_sha256=binding["acceptedChainSha256"], activation_binding=binding,
        activation_record={**binding, "state": "route-verified-lineage-pending"},
        expected_activation_operation_id=activation_operation_id, expected_activation_plan_sha256=activation_digest,
        expected_core_authority_sha256=binding["coreAuthoritySha256"], expected_core_backend_fingerprint=binding["newBackendFingerprint"],
    )
    expected_seal = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-projection",
                     "activationOperationId": activation_operation_id, "activationPlanSha256": activation_digest,
                     "coreAuthoritySha256": binding["coreAuthoritySha256"], "originalChainSha256": projection.original_chain_sha256,
                     "projectedChainSha256": content_hash(projection.chain), "projectedChain": projection.chain,
                     "projectedPointer": projection.accepted_pointer}
    require(expected_seal["projectedChainSha256"] == accepted["projectedChainSha256"] and canonical(seal) == canonical(expected_seal),
            "Accepted Core lineage projection differs from the historical rollout and activation binding")
    return projection
