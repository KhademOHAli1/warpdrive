"""Compile and reconcile an initial Core route without publishing a Web release.

The caller owns authenticated installation and release inputs. This primitive
uses the shared installation locks and a journal that blocks ordinary Web
operations while the route transition awaits separate lineage acceptance.
"""

from copy import deepcopy
from hashlib import sha256
import os
import time

from caddy_web_config import _RELAY_ALIAS, _canonical, _read_installed, _require
from caddy_web_repeat import compile_retained_web_config
from installed_web_chain import _admit_journals, _directory, _state
from installed_web_readback_lock import installed_web_readback_locks
from installed_web_stage import write_record
from traefik_web_relay import _label, _peer_network
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate, _write_state
from web_switch import HASH, DefiniteRejected, SwitchHeld, SwitchUnknown, _envelope, _fsync, _matches, _sustained, canonical, content_hash, require


def compile_initial_core_route(installed, *, expected_sha256, host, traefik_ip, relay_alias, active, retained, core_alias):
    """Reconstruct both documents. Only the terminal tRPC policy is added."""
    _require(isinstance(host, str) and "." in host and len(host) <= 253
             and all(_label(part) for part in host.split(".")), "Exact installed Web host required")
    _require(isinstance(relay_alias, str) and _RELAY_ALIAS.fullmatch(relay_alias)
             and _label(core_alias) and not _RELAY_ALIAS.fullmatch(core_alias)
             and all(type(generation) is WebGeneration for generation in (active, retained))
             and len({relay_alias, core_alias, active.target, retained.target}) == 4,
             "Distinct installed Core and Web route identities required")
    options = {"host": host, "peer": _peer_network(traefik_ip), "relay_alias": relay_alias,
               "active": active, "retained": retained}
    before = compile_retained_web_config(**options)
    _require(_read_installed(installed, expected_sha256) == _canonical(before),
             "Exact accepted Web-only route required before initial Core activation")
    return before, compile_retained_web_config(**options, core_alias=core_alias)


def _initial_core_transition(
    predecessor, chain, *, expected_chain_sha256, installed_bytes,
    core_backend_fingerprint, core_authority_sha256, host, traefik_ip, relay_alias, core_alias,
):
    _validate(predecessor)
    keys = {"targetKey", "backendFingerprint", "acceptedOperationId", "acceptedPlanSha256", "active", "previous"}
    require(type(chain) is dict and set(chain) == keys and _matches(HASH, expected_chain_sha256)
            and content_hash(chain) == expected_chain_sha256
            and chain["targetKey"] == predecessor["targetKey"]
            and chain["backendFingerprint"] == predecessor["backendFingerprint"]
            and chain["acceptedOperationId"] == predecessor["operationId"]
            and chain["acceptedPlanSha256"] == content_hash(predecessor)
            and chain["active"]["slot"] == predecessor["after"]
            and chain["previous"]["slot"] == predecessor["before"], "Exact installed predecessor Web chain required")
    require(_matches(HASH, core_backend_fingerprint) and _matches(HASH, core_authority_sha256)
            and core_backend_fingerprint != predecessor["backendFingerprint"], "Exact independently admitted Core authority required")
    require(type(installed_bytes) is bytes and sha256(installed_bytes).hexdigest() == predecessor["after"]["route"]["fingerprint"],
            "Core activation must preserve the exact accepted Web preimage")
    active, retained = (WebGeneration(chain[side]["slot"]["route"]["generation"], chain[side]["alias"])
                        for side in ("active", "previous"))
    before, after = compile_initial_core_route(installed_bytes,
        expected_sha256=predecessor["after"]["route"]["fingerprint"], host=host, traefik_ip=traefik_ip,
        relay_alias=relay_alias, active=active, retained=retained, core_alias=core_alias)
    binding = {"schemaVersion": 1, "kind": "warpdrive-installed-core-activation", "targetKey": chain["targetKey"],
               "acceptedChainSha256": expected_chain_sha256, "coreAuthoritySha256": core_authority_sha256,
               "oldBackendFingerprint": predecessor["backendFingerprint"], "newBackendFingerprint": core_backend_fingerprint,
               "oldRouteSha256": content_hash(before), "newRouteSha256": content_hash(after)}
    return before, after, binding, "core-activation-" + content_hash(binding)[:40]


def reconcile_initial_core_route(
    original, state, *, predecessor, chain, expected_chain_sha256, installed_bytes,
    core_backend_fingerprint, core_authority_sha256, host, traefik_ip, relay_alias, core_alias,
    admin, read_durable_config, verify_authority, observe_core, observe_public, clock=time.monotonic, sleep=time.sleep,
):
    """Make one exact CAS, or observe its result, while retaining the old Web pointer.

    `verify_authority` independently authenticates both Web artifacts, protected
    installation and Core qualification. `observe_core` returns the protected
    fingerprint after verifying the exact ready Core and original components.
    `observe_public` proves the selected public policy and both retained Web slots.
    This primitive intentionally holds normal rollout while lineage is pending.
    """
    predecessor = deepcopy(predecessor)
    before, after, binding, name = _initial_core_transition(predecessor, deepcopy(chain),
        expected_chain_sha256=expected_chain_sha256, installed_bytes=installed_bytes,
        core_backend_fingerprint=core_backend_fingerprint, core_authority_sha256=core_authority_sha256,
        host=host, traefik_ip=traefik_ip, relay_alias=relay_alias, core_alias=core_alias)

    with installed_web_readback_locks(original, state):
        operations = state / "web-rollouts"
        _directory(operations)
        journal = operations / (name + ".json")
        pointer = _record(predecessor, predecessor["after"])
        require(not os.path.lexists(state / (name + "-rolled-back.json")),
                "This Core activation was reversed and cannot be replayed")
        require(not os.path.lexists(state / (name + "-lineage-accepted.json")),
                "This Core activation has published lineage acceptance")

        def observe(expected):
            require(_state(state / "accepted-web-generation.json") == pointer
                    and _state(operations / (predecessor["operationId"] + ".json")) == {"plan": predecessor, "state": "accepted"}
                    and verify_authority(deepcopy(binding)) is True
                    and observe_core() == core_backend_fingerprint, "Protected Web or Core activation authority differs")
            live, etag = admin.config()
            expected_raw = canonical(expected)
            if canonical(live) != expected_raw or canonical(read_durable_config()) != expected_raw:
                raise SwitchHeld("Exact live and durable Core activation route is unresolved")
            confirmed, confirmed_etag = admin.config()
            if canonical(confirmed) != expected_raw or confirmed_etag != etag:
                raise SwitchHeld("Exact live and durable Core activation route is unresolved")

        intent = {**binding, "state": "switch-intent"}
        ready = {**binding, "state": "route-verified-lineage-pending"}
        if os.path.lexists(journal):
            saved = _state(journal)
            require(saved in (intent, ready), "Existing Core activation receipt differs")
        else:
            _admit_journals(operations, predecessor)
            observe(before)
            require(observe_public(deepcopy(before), False) is True, "Exact accepted public Web route is unhealthy")
            observe(before)
            write_record(journal, _envelope(intent))
            saved = intent
            try:
                admin.compare_and_swap(deepcopy(before), deepcopy(after))
            except DefiniteRejected:
                observe(before)
                require(_state(journal) == intent, "Core activation journal changed during definite rejection")
                journal.unlink()
                _fsync(operations)
                raise
            except Exception:
                raise SwitchUnknown("Core activation outcome is unknown. Observe the same operation without replay") from None
        def sample():
            observe(after)
            if observe_public(deepcopy(after), True) is not True:
                raise SwitchHeld("Exact public Core route and retained Web health require reconciliation")
            observe(after)
            return True

        _sustained(sample, clock, sleep)
        observe(after)
        if saved == intent:
            _write_state(journal, ready, previous=intent)
        return {"operationId": name, "planSha256": content_hash(binding), "state": ready["state"],
                "routeSha256": binding["newRouteSha256"], "backendFingerprint": core_backend_fingerprint}


def reverse_initial_core_route(
    original, state, *, predecessor, chain, expected_chain_sha256, installed_bytes,
    core_backend_fingerprint, core_authority_sha256, host, traefik_ip, relay_alias, core_alias,
    admin, read_durable_config, verify_authority, observe_original_web, observe_public, clock=time.monotonic, sleep=time.sleep,
):
    """Explicitly restore the admitted Web-only route before Core lineage acceptance.

    `observe_original_web` independently verifies the original backend, ingress,
    and both directly healthy Web slots, and returns the old backend fingerprint.
    `observe_public` confirms the restored public Web route and anonymous RPC.
    After an ambiguous reverse, further invocations only observe its outcome.
    """
    predecessor = deepcopy(predecessor)
    before, after, binding, name = _initial_core_transition(predecessor, deepcopy(chain),
        expected_chain_sha256=expected_chain_sha256, installed_bytes=installed_bytes,
        core_backend_fingerprint=core_backend_fingerprint, core_authority_sha256=core_authority_sha256,
        host=host, traefik_ip=traefik_ip, relay_alias=relay_alias, core_alias=core_alias)
    forward_states = {"switch-intent", "route-verified-lineage-pending"}
    pending_states = forward_states | {"rollback-intent", "rolled-back"}
    rollback_intent = {**binding, "state": "rollback-intent"}
    rolled_back = {**binding, "state": "rolled-back"}
    old_pointer = _record(predecessor, predecessor["after"])

    with installed_web_readback_locks(original, state):
        operations = state / "web-rollouts"
        _directory(operations)
        journal = operations / (name + ".json")
        archive = state / (name + "-rolled-back.json")
        acceptance = state / (name + "-lineage-accepted.json")
        pointer = state / "accepted-web-generation.json"
        predecessor_path = operations / (predecessor["operationId"] + ".json")
        held = os.path.lexists(journal)
        saved = _state(journal) if held else None
        archived = os.path.lexists(archive)
        if held:
            require(type(saved) is dict and isinstance(saved.get("state"), str) and saved["state"] in pending_states
                    and canonical(saved) == canonical({**binding, "state": saved["state"]}),
                    "Exact pending Core activation journal required for reversal")
        require((saved is not None or archived) and (not archived or (saved in (None, rolled_back)
                and canonical(_state(archive)) == canonical(rolled_back))), "Exact Core activation reversal evidence required")
        _admit_journals(operations, predecessor, verified_pending=journal if saved is not None else None)

        def check_authority():
            require(not os.path.lexists(acceptance) and canonical(_state(pointer)) == canonical(old_pointer)
                    and canonical(_state(predecessor_path)) == canonical({"plan": predecessor, "state": "accepted"})
                    and (not os.path.lexists(journal) if saved is None else canonical(_state(journal)) == canonical(saved))
                    and verify_authority(deepcopy(binding)) is True,
                    "Core reversal requires the original accepted Web pointer and unaccepted Core lineage")

        def observe(expected, *, public):
            check_authority()
            expected_raw = canonical(expected)
            live, etag = admin.config()
            if canonical(live) != expected_raw or canonical(read_durable_config()) != expected_raw:
                raise SwitchHeld("Exact live and durable Core reversal route is unresolved")
            if observe_original_web() != binding["oldBackendFingerprint"]:
                raise SwitchHeld("Exact original Web backend and retained health required for Core reversal")
            if public and observe_public(deepcopy(expected), False) is not True:
                raise SwitchHeld("Restored public Web route is unresolved")
            check_authority()
            durable = read_durable_config()
            confirmed, confirmed_etag = admin.config()
            if canonical(durable) != expected_raw or canonical(confirmed) != expected_raw or confirmed_etag != etag:
                raise SwitchHeld("Exact live and durable Core reversal route changed during observation")
            return True

        if saved is not None and saved["state"] in forward_states:
            observe(after, public=False)
            forward = saved
            _write_state(journal, rollback_intent, previous=saved)
            saved = rollback_intent
            try:
                admin.compare_and_swap(deepcopy(after), deepcopy(before))
            except DefiniteRejected:
                observe(after, public=False)
                _write_state(journal, forward, previous=rollback_intent)
                raise
            except Exception:
                raise SwitchUnknown("Core reversal outcome is unknown. Observe the same operation without replay") from None

        _sustained(lambda: observe(before, public=True), clock, sleep)
        if saved == rollback_intent:
            _write_state(journal, rolled_back, previous=rollback_intent)
            saved = rolled_back
        if not archived:
            write_record(archive, _envelope(rolled_back))
        require(canonical(_state(archive)) == canonical(rolled_back), "Archived Core reversal receipt differs")
        _fsync(state)
        observe(before, public=True)
        _admit_journals(operations, predecessor, verified_pending=journal if saved is not None else None)
        if saved is not None:
            journal.unlink()
        _fsync(operations)
        return {"operationId": name, "planSha256": content_hash(binding), "state": rolled_back["state"],
                "routeSha256": binding["oldRouteSha256"], "backendFingerprint": binding["oldBackendFingerprint"]}
