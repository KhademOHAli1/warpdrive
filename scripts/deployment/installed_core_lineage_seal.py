"""Seal a verified initial Core route projection for later lineage acceptance."""

from copy import deepcopy
import os

from installed_core_lineage import project_initial_core_lineage, verify_core_acceptance_records, verify_projected_core_predecessor
from installed_web_chain import _admit_journals, _directory, _state
from installed_web_readback_lock import installed_web_readback_locks
from installed_web_stage import write_record
from web_rollout import _record, _write_state
from web_switch import HASH, NAME, _envelope, _fsync, _matches, content_hash, require


def seal_initial_core_lineage(
    original, state, *, accepted_plan, expected_plan_sha256, accepted_chain, expected_chain_sha256,
    activation_binding, expected_activation_operation_id, expected_activation_plan_sha256,
    expected_core_authority_sha256, expected_core_backend_fingerprint,
    admin, read_durable_config, verify_authority, observe_core, observe_public,
):
    """Persist a reviewable projection and retain the existing Web rollout hold."""
    accepted_plan, accepted_chain, activation_binding = map(deepcopy, (accepted_plan, accepted_chain, activation_binding))
    require(_matches(HASH, expected_activation_plan_sha256)
            and expected_activation_operation_id == "core-activation-" + expected_activation_plan_sha256[:40],
            "Exact pending Core activation operation required")
    with installed_web_readback_locks(original, state):
        require(not os.path.lexists(state / (expected_activation_operation_id + "-rolled-back.json")),
                "Rolled-back Core activation cannot be sealed")
        operations = state / "web-rollouts"
        _directory(operations)
        pending = operations / (expected_activation_operation_id + ".json")
        activation_record = _state(pending)
        projection = project_initial_core_lineage(
            accepted_plan=accepted_plan, expected_plan_sha256=expected_plan_sha256,
            accepted_chain=accepted_chain, expected_chain_sha256=expected_chain_sha256,
            activation_binding=activation_binding, activation_record=activation_record,
            expected_activation_operation_id=expected_activation_operation_id,
            expected_activation_plan_sha256=expected_activation_plan_sha256,
            expected_core_authority_sha256=expected_core_authority_sha256,
            expected_core_backend_fingerprint=expected_core_backend_fingerprint,
        )
        pointer = state / "accepted-web-generation.json"
        old_pointer = _record(accepted_plan, accepted_plan["after"])
        predecessor = operations / (accepted_plan["operationId"] + ".json")

        def check():
            require(_state(pointer) == old_pointer and _state(pending) == activation_record
                    and _state(predecessor) == {"plan": accepted_plan, "state": "accepted"}
                    and verify_authority(deepcopy(activation_binding)) is True
                    and observe_core() == expected_core_backend_fingerprint, "Installed Core lineage authority changed")
            live, etag = admin.config()
            require(content_hash(live) == activation_binding["newRouteSha256"] and live == read_durable_config()
                    and admin.config() == (live, etag), "Exact live and durable Core route required for sealing")
            return live

        def observe():
            live = check()
            require(observe_public(deepcopy(live), True) is True and check() == live,
                    "Public Core route or retained Web health differs during sealing")

        observe()
        seal = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-projection",
                "activationOperationId": expected_activation_operation_id,
                "activationPlanSha256": expected_activation_plan_sha256,
                "coreAuthoritySha256": expected_core_authority_sha256,
                "originalChainSha256": expected_chain_sha256,
                "projectedChainSha256": content_hash(projection.chain),
                "projectedChain": projection.chain, "projectedPointer": projection.accepted_pointer}
        output = state / (expected_activation_operation_id + "-lineage-projection.json")
        if not os.path.lexists(output):
            write_record(output, _envelope(seal))
        require(_state(output) == seal, "Sealed Core lineage projection differs")
        observe()
        _fsync(state)
        return deepcopy(seal)


def initial_core_lineage_acceptance(seal, binding):
    """Derive the record whose independent SHA-256 authorizes finalization."""
    return {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-accepted",
            "activationBinding": deepcopy(binding), "projectionSealSha256": content_hash(seal),
            "projectedChainSha256": seal["projectedChainSha256"], "activationOperationId": seal["activationOperationId"]}


def accept_initial_core_lineage(
    original, state, *, activation_operation_id, expected_projection_seal_sha256, expected_activation_lineage_sha256,
    binding, admin, read_durable_config, verify_authority, observe_core, observe_public,
):
    """Advance the accepted pointer once and clear the hold after durable readback."""
    binding = deepcopy(binding)
    require(activation_operation_id == "core-activation-" + content_hash(binding)[:40]
            and all(_matches(HASH, digest) for digest in (expected_projection_seal_sha256, expected_activation_lineage_sha256)),
            "Exact separately admitted Core lineage and projection required")
    with installed_web_readback_locks(original, state):
        require(not os.path.lexists(state / (activation_operation_id + "-rolled-back.json")),
                "Rolled-back Core activation cannot be accepted")
        operations = state / "web-rollouts"
        _directory(operations)
        pending = operations / (activation_operation_id + ".json")
        output = state / (activation_operation_id + "-lineage-accepted.json")
        projection_path = state / (activation_operation_id + "-lineage-projection.json")
        seal = _state(projection_path)
        acceptance = initial_core_lineage_acceptance(seal, binding)
        require(content_hash(seal) == expected_projection_seal_sha256
                and acceptance["activationOperationId"] == activation_operation_id
                and content_hash(acceptance) == expected_activation_lineage_sha256,
                "Core lineage finalization does not match independently admitted evidence")
        chain = seal["projectedChain"]
        require(_matches(NAME, chain.get("acceptedOperationId")), "Exact Core lineage predecessor operation required")
        journal = _state(operations / (chain["acceptedOperationId"] + ".json"))
        require(type(journal) is dict and set(journal) == {"plan", "state"} and journal["state"] == "accepted",
                "Original Web rollout was never accepted")
        predecessor = journal["plan"]
        pending_record = {**binding, "state": "route-verified-lineage-pending"}
        projection = verify_core_acceptance_records(chain=chain, accepted_plan=predecessor, accepted=acceptance, seal=seal,
            activation_operation_id=activation_operation_id, expected_activation_lineage_sha256=expected_activation_lineage_sha256)
        pointer = state / "accepted-web-generation.json"
        old = _record(predecessor, predecessor["after"])
        new = projection.accepted_pointer
        has_hold = os.path.lexists(pending)
        require(not has_hold or _state(pending) == pending_record, "Installed Core lineage hold differs")

        def observe(expected_pointer):
            require(_state(pointer) == expected_pointer and _state(projection_path) == seal
                    and (not has_hold or _state(pending) == pending_record)
                    and verify_authority(deepcopy(binding)) is True
                    and observe_core() == binding["newBackendFingerprint"], "Installed Core lineage authority changed")
            live, etag = admin.config()
            require(content_hash(live) == binding["newRouteSha256"] and live == read_durable_config()
                    and observe_public(deepcopy(live), True) is True and admin.config() == (live, etag)
                    and live == read_durable_config(), "Exact healthy live and durable Core route required for acceptance")

        current = _state(pointer)
        published = os.path.lexists(output)
        require((has_hold and current == old) or (published and current == new), "Unexpected Core lineage acceptance state")
        if has_hold:
            _admit_journals(operations, predecessor, verified_pending=pending)
        observe(current)
        if not published:
            write_record(output, _envelope(acceptance))
        require(verify_projected_core_predecessor(state, chain=chain, activation_operation_id=activation_operation_id,
                expected_activation_lineage_sha256=expected_activation_lineage_sha256) == projection,
                "Accepted Core lineage changed during finalization")
        _fsync(state)
        if current == old:
            _write_state(pointer, new, previous=old)
        observe(new)
        if has_hold:
            pending.unlink()
        _fsync(operations)
        return {"state": "accepted", "activationOperationId": activation_operation_id,
                "activationLineageSha256": expected_activation_lineage_sha256, "projectedChainSha256": content_hash(chain)}
