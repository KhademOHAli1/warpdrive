"""Restore retained Web after a previously accepted installed candidate fails."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import os
from pathlib import Path
import stat
import time

from web_rollout import (
    _health, _operation_files, _read_target, _receipt, _record, _validate, _write_state,
)
from web_switch import SwitchHeld, SwitchUnknown, _lock, _read, canonical, content_hash, require


def _private(path, *, directory=False):
    info = path.lstat()
    valid = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    require(valid and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600),
            "Private installed Web recovery state required")


def _await_public_a(target, plan, *, timeout, clock, sleep):
    """Wait for Traefik health checks to re-admit the exact restored relay."""
    deadline = clock() + timeout
    stable = 0
    slot = plan["before"]
    while clock() < deadline:
        if _read_target(target, plan)[0] != slot["route"]:
            raise SwitchHeld("Restored Caddy route is not the exact retained Web configuration")
        if clock() >= deadline:
            break
        try:
            proof = target.observe_health(deepcopy(slot), proxied=True)
        except (OSError, SwitchHeld):
            proof = None
        if clock() >= deadline:
            break
        require(proof is None or (
            type(proof) is dict and set(proof) == {"generation", "runtimeId", "healthy"}
            and proof["generation"] == slot["route"]["generation"] and proof["runtimeId"] == slot["runtime"]["runtimeId"]
            and type(proof["healthy"]) is bool
        ), "Public Web recovery health does not identify the exact retained runtime")
        if _read_target(target, plan)[0] != slot["route"]:
            raise SwitchHeld("Restored Caddy route changed during public health observation")
        stable = stable + 1 if proof is not None and proof["healthy"] is True else 0
        now = clock()
        if stable >= 3 and now < deadline:
            return
        if now < deadline:
            sleep(min(1.0, deadline - now))
    raise SwitchHeld("Retained Web is awaiting verified public re-admission")


def restore_failed_installed_web(
    plan: dict, *, state_dir: Path, target, observe_candidate_failure: Callable[..., bool | None],
    accepted_plan: dict | None = None, public_timeout: int = 45, clock=time.monotonic, sleep=time.sleep,
) -> dict:
    """Restore A exactly once after the accepted B has definitively failed.

    The target is the admitted forward installed A-only/B+A target. Its inspect
    must independently read the same protected backend and exact live and durable
    Caddy configurations. The failure callback observes B directly and returns
    True only for a definite application failure. Its own timeout is bounded by
    the caller. Only observations may resume an unresolved route mutation.

    An accepted reapply may have retained B in its A-active configuration.
    Its journal admits the same B active slot while recovery restores A-only.
    """
    plan = deepcopy(plan)
    _validate(plan)
    accepted_plan = plan if accepted_plan is None else deepcopy(accepted_plan)
    _validate(accepted_plan)
    before, after = plan["before"], plan["after"]
    source_before = {**before, "route": {**before["route"], "fingerprint": accepted_plan["before"]["route"]["fingerprint"]}}
    expected_source = {**plan, "operationId": accepted_plan["operationId"], "before": source_before}
    require(canonical(accepted_plan) == canonical(expected_source), "Accepted Web recovery source differs from the admitted runtime pair")
    require(callable(observe_candidate_failure) and type(public_timeout) is int and 5 <= public_timeout <= 90,
            "Bounded installed Web recovery observations required")
    state_dir = Path(state_dir)
    require(state_dir.is_absolute() and state_dir.resolve(strict=True) == state_dir,
            "Canonical installed Web rollout state required")
    _private(state_dir, directory=True)
    recovery_hash = content_hash(plan if accepted_plan == plan else {"recoveryPlan": plan, "acceptedPlan": accepted_plan})
    reverse = {**plan, "operationId": "emergency-" + recovery_hash[:48], "before": after, "after": before}
    _validate(reverse)

    with _lock(state_dir):
        operations = state_dir / "web-rollouts"
        _private(operations, directory=True)
        forward_path = operations / f"{accepted_plan['operationId']}.json"
        _private(forward_path)
        require(canonical(_read(forward_path)) == canonical({"plan": accepted_plan, "state": "accepted"}),
                "The exact forward Web rollout was never accepted")
        require(target.verify_qualification(deepcopy(plan), initialize=False) is True,
                "Installed Web recovery authority is unavailable")

        accepted_a, accepted_b = _record(plan, before), _record(plan, after)
        pointer = state_dir / "accepted-web-generation.json"
        _private(pointer)
        accepted = _read(pointer)
        route, stable = _read_target(target, plan)
        journal_path = operations / f"{reverse['operationId']}.json"
        recovery_state = None
        if os.path.lexists(journal_path):
            _private(journal_path)
            recorded = _read(journal_path)
            require(type(recorded) is dict and recorded.get("state") in ("prepared", "switch-intent", "accepted")
                    and canonical(recorded) == canonical({"plan": reverse, "state": recorded["state"]}),
                    "Existing Web recovery journal is not an admitted restore")
            recovery_state = recorded["state"]
        can_send = recovery_state in (None, "prepared")
        if can_send:
            require(canonical(accepted) == canonical(accepted_b) and route == after["route"],
                    "Exact accepted B pointer and live B route are required")
            if stable and observe_candidate_failure(deepcopy(after)) is not True:
                raise SwitchHeld("An exact accepted B failure is unverified")
            if not _health(target, plan, before, proxied=False, expected_route=after["route"], clock=clock, sleep=sleep):
                raise SwitchHeld("Retained A is not directly healthy")
            route, stable = _read_target(target, plan)
            require(route == after["route"], "Accepted B route changed before recovery")
            if stable and observe_candidate_failure(deepcopy(after)) is not True:
                raise SwitchHeld("The accepted B failure is no longer confirmed")
            require(_read_target(target, plan)[0] == after["route"], "Accepted B route changed after failure proof")

        accepted_path, journal_path, journal = _operation_files(state_dir, reverse, accepted_b, route, False)
        allowed = (accepted_b,) if can_send else (accepted_b, accepted_a)
        require(any(canonical(_read(accepted_path)) == canonical(item) for item in allowed),
                "Installed Web recovery pointer differs")
        if can_send:
            require(journal["state"] == "prepared", "Unexpected first Web recovery journal")
            intent = {"plan": reverse, "state": "switch-intent"}
            _write_state(journal_path, intent, previous=journal)
            journal = intent
            try:
                target.compare_and_swap_route(deepcopy(after["route"]), deepcopy(before["route"]))
            except Exception:
                raise SwitchUnknown("Installed Web recovery route outcome is unresolved") from None
        elif journal["state"] == "accepted":
            require(canonical(_read(accepted_path)) == canonical(accepted_a), "Restored Web pointer differs")

        _await_public_a(target, plan, timeout=public_timeout, clock=clock, sleep=sleep)
        if journal["state"] == "switch-intent":
            current = _read(accepted_path)
            if canonical(current) != canonical(accepted_a):
                require(canonical(current) == canonical(accepted_b), "Web pointer changed during recovery")
                _write_state(accepted_path, accepted_a, previous=accepted_b)
            _write_state(journal_path, {"plan": reverse, "state": "accepted"}, previous=journal)
        return _receipt(reverse, "accepted")
