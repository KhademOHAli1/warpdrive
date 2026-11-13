"""Restore retained Web when an unaccepted switch demonstrably failed."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
import time

from installed_web_emergency import _await_public_a, _private
from web_rollout import _health, _operation_files, _read_target, _receipt, _record, _validate, _write_state
from web_switch import SwitchHeld, SwitchUnknown, _lock, _read, canonical, require


_FORWARD_STATES = ("switch-intent", "switch-acknowledged")


def recover_failed_installed_web_intent(
    plan: dict, *, state_dir: Path, target, observe_candidate_failure: Callable[..., bool | None],
    public_timeout: int = 45, clock=time.monotonic, sleep=time.sleep,
) -> dict:
    """Reconcile the original installed switch without replaying an uncertain write.

    The admitted target checks the exact live and persisted Caddy documents and
    both runtime and protected backend witnesses. The bounded direct candidate
    callback returns True only for a definite B application failure. A stopped
    or restarted B is actionable only through the target's exact runtime witness.
    """
    plan = deepcopy(plan)
    _validate(plan)
    require(callable(observe_candidate_failure) and type(public_timeout) is int and 5 <= public_timeout <= 90,
            "Bounded installed Web recovery observations required")
    state_dir = Path(state_dir)
    require(state_dir.is_absolute() and state_dir.resolve(strict=True) == state_dir,
            "Canonical installed Web rollout state required")
    _private(state_dir, directory=True)
    before, after = plan["before"], plan["after"]
    accepted = _record(plan, before)

    with _lock(state_dir):
        operations = state_dir / "web-rollouts"
        _private(operations, directory=True)
        journal_path = operations / f"{plan['operationId']}.json"
        accepted_path = state_dir / "accepted-web-generation.json"
        _private(journal_path)
        _private(accepted_path)
        recorded = _read(journal_path)
        require(type(recorded) is dict and recorded.get("state") in (*_FORWARD_STATES, "rollback-intent", "rolled-back")
                and canonical(recorded) == canonical({"plan": plan, "state": recorded["state"]}),
                "Exact unsettled installed Web switch or its rollback journal required")
        require(canonical(_read(accepted_path)) == canonical(accepted), "Retained accepted Web pointer differs")
        require(target.verify_qualification(deepcopy(plan), initialize=False) is True,
                "Installed Web intent recovery authority is unavailable")
        route, stable = _read_target(target, plan)
        _, _, journal = _operation_files(state_dir, plan, accepted, route, False)
        require(canonical(journal) == canonical(recorded), "Installed Web switch journal changed during recovery")

        def prove_failed_b(route, stable):
            if route != after["route"]:
                raise SwitchHeld("The unsettled candidate is not confirmed live and persisted")
            if stable and observe_candidate_failure(deepcopy(after)) is not True:
                raise SwitchHeld("The exact candidate Web failure is unverified")

        if journal["state"] in _FORWARD_STATES:
            prove_failed_b(route, stable)
            if not _health(target, plan, before, proxied=False, expected_route=after["route"], clock=clock, sleep=sleep):
                raise SwitchHeld("Retained Web is not directly healthy")
            prove_failed_b(*_read_target(target, plan))
            require(_read_target(target, plan)[0] == after["route"], "Candidate Web route changed after failure proof")
            require(canonical(_read(accepted_path)) == canonical(accepted), "Retained accepted Web pointer changed")
            intent = {"plan": plan, "state": "rollback-intent"}
            _write_state(journal_path, intent, previous=journal)
            journal = intent
            try:
                target.compare_and_swap_route(deepcopy(after["route"]), deepcopy(before["route"]))
            except Exception:
                raise SwitchUnknown("Installed Web intent restoration outcome is unresolved") from None

        _await_public_a(target, plan, timeout=public_timeout, clock=clock, sleep=sleep)
        require(canonical(_read(accepted_path)) == canonical(accepted), "Retained accepted Web pointer changed during rollback")
        if journal["state"] == "rollback-intent":
            _write_state(journal_path, {"plan": plan, "state": "rolled-back"}, previous=journal)
        return _receipt(plan, "rolled-back")
