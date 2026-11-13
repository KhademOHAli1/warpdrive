"""Repeat one installed Web switch on the accepted Caddy relay and state directory."""

from copy import deepcopy
import os
from pathlib import Path
import re
import time

from caddy_web_repeat import compile_repeat_web_configs
from installed_web_chain import _admit_journals, _directory, _state
from installed_web_emergency import restore_failed_installed_web
from installed_web_intent_recovery import recover_failed_installed_web_intent
from installed_web_target import InstalledWebTarget, _config_bytes
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate, _write_state, rollout_web
from web_switch import (
    HASH, NAME, DefiniteRejected, SwitchHeld, SwitchUnknown, _fsync, _lock, _matches, _sustained, content_hash, require,
)


_ALIAS = re.compile(r"warpdrive-web-([a-f0-9]{12})\Z")


class InstalledWebRepeat:
    """Compose exact repeat plans with trusted release and live observation callbacks.

    The caller owns the installation's mutation exclusion, authenticated chain
    pin and independent endpoint bindings. The runtime callback returns exactly
    `backendFingerprint` and `runtimes`, keyed by the three deployment IDs. It
    also verifies the installed Traefik, relay and backend process identities.
    It must return the actual C process state while preserving its identity;
    a missing or different container is unresolved. Keep A available for the
    exact B+A recovery. The caller authenticates the staged artifact and its
    profile through `verify_release` on every action. All route changes use
    the existing controller's target lock and Caddy CAS.
    """

    def __init__(self, state_dir, *, admitted_chain, expected_chain_sha256, installed_bytes, expected_installed_sha256,
                 host, traefik_ip, relay_alias, candidate_runtime, candidate_alias, qualification_sha256, admin,
                 verify_release, observe_installed, probe_health, read_durable_config, observe_candidate_failure):
        state_dir = Path(state_dir)
        require(state_dir.is_absolute() and state_dir.resolve(strict=True) == state_dir,
                "Canonical shared installed Web state required")
        chain = deepcopy(admitted_chain)
        require(type(chain) is dict and set(chain) == {"targetKey", "backendFingerprint", "acceptedOperationId",
                                                      "acceptedPlanSha256", "active", "previous"}
                and _matches(NAME, chain["acceptedOperationId"]) and _matches(HASH, chain["acceptedPlanSha256"])
                and _matches(HASH, expected_chain_sha256) and content_hash(chain) == expected_chain_sha256,
                "Exact independently admitted Web lineage required")
        require(all(type(chain[side]) is dict and set(chain[side]) == {"slot", "alias", "provenance", "receiptSha256"}
                    and _matches(HASH, chain[side]["receiptSha256"]) for side in ("active", "previous"))
                and chain["active"]["receiptSha256"] != chain["previous"]["receiptSha256"],
                "Exact and distinct installed Web lineage slots required")
        alias = _ALIAS.fullmatch(candidate_alias) if isinstance(candidate_alias, str) else None
        require(alias and _matches(HASH, qualification_sha256) and type(candidate_runtime) is dict
                and candidate_runtime.get("name") == candidate_alias,
                "Exact staged candidate alias, runtime and qualification required")
        require(all(callable(callback) for callback in (verify_release, observe_installed, probe_health,
                                                         read_durable_config, observe_candidate_failure)),
                "Independent installed Web callbacks required")
        current, previous = (WebGeneration(chain[side]["slot"]["route"]["generation"], chain[side]["alias"])
                             for side in ("active", "previous"))
        candidate = WebGeneration("wd-" + candidate_runtime["sourceRevision"], candidate_alias)
        prior, active = (chain[side]["slot"] for side in ("previous", "active"))
        require(all(prior["runtime"][key] != candidate_runtime.get(key) for key in ("runtimeId", "name", "imageId", "sourceRevision"))
                and prior["runtime"]["schemaSha256"] == candidate_runtime.get("schemaSha256"),
                "Candidate must differ from both retained Web runtimes on the same schema")
        documents = compile_repeat_web_configs(installed_bytes, expected_sha256=expected_installed_sha256,
            host=host, traefik_ip=traefik_ip, relay_alias=relay_alias, current=current, previous=previous, candidate=candidate)
        operation = "web-" + alias[1]
        require(chain["acceptedOperationId"] not in {operation, operation + "-rollback", operation + "-reapply"}
                and active["route"]["fingerprint"] == content_hash(documents["before"]),
                "Installed preimage or successor operation differs from admitted lineage")
        next_slot = {"runtime": deepcopy(candidate_runtime), "route": {"runtimeId": candidate_runtime["runtimeId"],
                     "generation": candidate.deployment_id, "fingerprint": content_hash(documents["after"])}}
        reversed_active = {**active, "route": {**active["route"], "fingerprint": content_hash(documents["manualRollback"])}}
        common = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "targetKey": chain["targetKey"],
                  "backendFingerprint": chain["backendFingerprint"], "qualificationSha256": content_hash({
                      "installedChainSha256": expected_chain_sha256, "releaseQualificationSha256": qualification_sha256})}
        self._plans = {
            "promote": {**common, "operationId": operation, "before": active, "after": next_slot},
            "rollback": {**common, "operationId": operation + "-rollback", "before": next_slot, "after": reversed_active},
            "reapply": {**common, "operationId": operation + "-reapply", "before": reversed_active, "after": next_slot},
        }
        for plan in self._plans.values():
            _validate(plan)
        self._state_dir, self._chain = state_dir, chain
        self._documents = documents
        self._generations = {"before": (current, previous), "after": (candidate, current), "manualRollback": (current, candidate)}
        self._runtime_pins = {previous.deployment_id: prior["runtime"], current.deployment_id: active["runtime"],
                              candidate.deployment_id: next_slot["runtime"]}
        self._candidate = candidate.deployment_id
        self._admin, self._verify_release = admin, verify_release
        self._observe_installed, self._probe_health = observe_installed, probe_health
        self._read_durable_config, self._observe_candidate_failure = read_durable_config, observe_candidate_failure

    def plan(self, action):
        return deepcopy(self._plans[action])

    def _journal(self, operation):
        return self._state_dir / "web-rollouts" / (operation + ".json")

    def _qualify(self, action, selected, initialize):
        chain = self._chain
        journal = _state(self._journal(chain["acceptedOperationId"]))
        predecessor = journal["plan"]
        _validate(predecessor)
        if (initialize or journal["state"] != "accepted" or predecessor["operationId"] != chain["acceptedOperationId"]
                or content_hash(predecessor) != chain["acceptedPlanSha256"] or predecessor["targetKey"] != chain["targetKey"]
                or predecessor["backendFingerprint"] != chain["backendFingerprint"]
                or predecessor["before"] != chain["previous"]["slot"] or predecessor["after"] != chain["active"]["slot"]):
            return False
        prerequisite = {"rollback": "promote", "reapply": "rollback"}.get(action)
        if prerequisite is not None:
            required = self._plans[prerequisite]
            if _state(self._journal(required["operationId"])) != {"plan": required, "state": "accepted"}:
                return False
        return self._verify_release(selected, initialize=False) is True

    def _runtimes(self, plan):
        observed = self._observe_installed()
        require(type(observed) is dict and set(observed) == {"backendFingerprint", "runtimes"}
                and observed["backendFingerprint"] == plan["backendFingerprint"]
                and type(observed["runtimes"]) is dict and set(observed["runtimes"]) == set(self._runtime_pins),
                "Independent three-slot and protected backend readback required")
        runtimes = observed["runtimes"]
        for generation, expected in self._runtime_pins.items():
            if generation != self._candidate:
                require(runtimes[generation] == expected, "A retained Web runtime changed")
        return {"backendFingerprint": observed["backendFingerprint"],
                **{side + "Runtime": runtimes[plan[side]["route"]["generation"]] for side in ("before", "after")}}

    def _target(self, action):
        plan = self._plans[action]
        before, after = {"promote": ("before", "after"), "rollback": ("after", "manualRollback"),
                         "reapply": ("manualRollback", "after")}[action]
        return InstalledWebTarget(plan, admin=self._admin,
            documents={"successorA": self._documents[before], "successorB": self._documents[after]},
            generations=(self._generations[before], self._generations[after]),
            verify_release=lambda selected, *, initialize: self._qualify(action, selected, initialize),
            observe_runtimes=lambda: self._runtimes(plan), probe_health=self._probe_health,
            read_durable_config=self._read_durable_config)

    def _stamp_route(self, plan):
        live, etag = self._admin.config()
        raw = _config_bytes(live)
        side = next((name for name in ("manualRollback", "before") if raw == _config_bytes(self._documents[name])), None)
        if side is None or raw != _config_bytes(self._read_durable_config()):
            raise SwitchHeld("Live and durable route-only Web state is unresolved")
        confirmed, confirmed_etag = self._admin.config()
        if raw != _config_bytes(confirmed) or etag != confirmed_etag:
            raise SwitchHeld("Route-only Web state changed during readback")
        candidate = self._runtimes(plan)["afterRuntime"]
        pinned = plan["after"]["runtime"]
        require(type(candidate) is dict and set(candidate) == set(pinned)
                and all(candidate[key] == pinned[key] for key in set(pinned) - {"running", "restartCount"})
                and type(candidate["running"]) is bool and type(candidate["restartCount"]) is int
                and pinned["restartCount"] <= candidate["restartCount"] <= 1_000_000,
                "Route-only reconciliation cannot identify the failed candidate runtime")
        return side, candidate

    def _stamp_health(self, plan, *, side, prove_failure, clock, sleep):
        retained = self._chain["previous"]["slot"]
        active = plan["before"] if side == "manualRollback" else self._plans["promote"]["before"]

        def sample():
            route, candidate = self._stamp_route(plan)
            require(route == side, "Route-only Web configuration changed during health proof")
            for slot, proxied in ((retained, False), (active, False), (active, True)):
                witness = self._probe_health(deepcopy(slot), proxied=proxied)
                require(type(witness) is dict and witness.keys() == {"generation", "runtimeId", "healthy"}
                        and witness["generation"] == slot["route"]["generation"]
                        and witness["runtimeId"] == slot["runtime"]["runtimeId"] and witness["healthy"] is True,
                        "Both retained Web runtimes and public active Web must be healthy")
            if prove_failure and candidate == plan["after"]["runtime"]:
                if self._observe_candidate_failure(deepcopy(plan["after"])) is not True:
                    raise SwitchHeld("Exact failed candidate Web stamps cannot be reconciled without definite failure")
            require(self._stamp_route(plan) == (side, candidate), "Route or candidate changed during reconciliation proof")
            return True

        _sustained(sample, clock, sleep)

    def _reconcile_failed_stamps(self, *, clock, sleep):
        plan = self._plans["reapply"]
        state = self._state_dir
        pointer = state / "accepted-web-generation.json"
        operations = state / "web-rollouts"
        operation_id = plan["operationId"] + "-route"
        pending, archive = operations / (operation_id + ".json"), state / (operation_id + ".json")
        old = _record(plan, plan["before"])
        new = _record(plan, self._plans["promote"]["before"])
        binding = {"schemaVersion": 1, "kind": "warpdrive-installed-web-route-reconciliation", "operationId": operation_id,
                   "sourcePlanSha256": content_hash(plan), "before": old, "after": new}
        intent, accepted = ({**binding, "state": phase} for phase in ("switch-intent", "accepted"))
        with _lock(state):
            _directory(state)
            _directory(operations)
            require(self._qualify("reapply", deepcopy(plan), False)
                    and _state(self._journal(plan["operationId"])) == {"plan": plan, "state": "rolled-back"},
                    "Exact rolled-back repeat Web reapply is required")
            current = _state(pointer)
            saved = _state(pending) if os.path.lexists(pending) else None
            archived = os.path.lexists(archive)
            require(saved in (None, intent, accepted) and (not archived or (_state(archive) == accepted and saved in (None, accepted))),
                    "Existing route-only reconciliation differs")
            if saved is None and not archived:
                predecessor = _state(self._journal(self._chain["acceptedOperationId"]))["plan"]
                _admit_journals(operations, predecessor)
                require(current == old, "The exact retained B+C pointer is required")
                self._stamp_health(plan, side="manualRollback", prove_failure=True, clock=clock, sleep=sleep)
                require(_state(pointer) == old, "Accepted Web changed before route-only reconciliation")
                # Presence in web-rollouts holds all ordinary writers during an ambiguous CAS.
                _write_state(pending, intent)
                saved = intent
                try:
                    self._admin.compare_and_swap(deepcopy(self._documents["manualRollback"]), deepcopy(self._documents["before"]))
                except DefiniteRejected:
                    require(self._stamp_route(plan)[0] == "manualRollback" and _state(pointer) == old,
                            "Rejected route-only CAS left an unresolved route")
                    pending.unlink()
                    _fsync(operations)
                    raise SwitchHeld("Caddy rejected the route-only CAS without changing the accepted route") from None
                except Exception:
                    raise SwitchUnknown("Route-only Caddy CAS outcome is unresolved; observe without replay") from None
            require(current in (old, new) and (saved == intent or current == new), "Accepted Web pointer differs from route-only journal")
            self._stamp_health(plan, side="before", prove_failure=False, clock=clock, sleep=sleep)
            require(_state(pointer) == current, "Accepted Web changed during route-only reconciliation")
            if saved == intent:
                if current == old:
                    _write_state(pointer, new, previous=old)
                require(_state(pointer) == new, "Restored retained Web pointer differs")
                _write_state(pending, accepted, previous=intent)
                saved = accepted
            if not archived:
                _write_state(archive, accepted)
            if saved == accepted:
                require(_state(pending) == _state(archive) == accepted, "Route-only reconciliation archive changed")
                pending.unlink()
                _fsync(operations)
        return {"state": "accepted", "operationId": operation_id, "acceptedGeneration": new["slot"]["route"]["generation"],
                "routeFingerprint": new["slot"]["route"]["fingerprint"], "failedCandidateStampsRetained": False}

    def run(self, action, *, clock=time.monotonic, sleep=time.sleep):
        """Run one explicit action.

        An unaccepted reapply can restore its exact B+C predecessor. The
        resulting receipt exposes the retained failed C stamps. Use the
        route-only reconciliation before subsequent shipping or retirement.
        """
        require(action in ("promote", "rollback", "reapply", "recover", "recover-reapply", "reconcile-failed-stamps"),
                "Unknown repeat Web action")
        if action == "reconcile-failed-stamps":
            return self._reconcile_failed_stamps(clock=clock, sleep=sleep)
        if action in self._plans:
            result = rollout_web(self._plans[action], state_dir=self._state_dir, target=self._target(action), clock=clock, sleep=sleep)
            if action == "reapply" and result["state"] == "rolled-back":
                return {**result, "failedCandidateStampsRetained": True}
            return result
        selected = "reapply" if action == "recover-reapply" else "promote"
        source = self._plans[selected]
        path = self._journal(source["operationId"])
        require(os.path.lexists(path), "Exact repeat Web recovery journal required")
        journal = _state(path)
        require(journal["plan"] == source, "Repeat Web recovery journal differs")
        options = {"state_dir": self._state_dir, "observe_candidate_failure": self._observe_candidate_failure,
                   "clock": clock, "sleep": sleep}
        if journal["state"] == "accepted":
            return restore_failed_installed_web(self._plans["promote"], target=self._target("promote"),
                                                accepted_plan=source, **options)
        result = recover_failed_installed_web_intent(source, target=self._target(selected), **options)
        if selected == "reapply":
            return {**result, "failedCandidateStampsRetained": True}
        return result
