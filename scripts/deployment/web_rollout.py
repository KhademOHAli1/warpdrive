"""Switch between two independently qualified, already-running Web artifacts.

The composition root must authenticate the release and own the target adapter.
The journal reconciles a lost write acknowledgement by observation only. It
never retries an unresolved route update or treats an exception as a rejection.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from typing import Protocol

from web_switch import (
    HASH, NAME, DefiniteRejected, SwitchHeld, SwitchUnknown,
    _directory, _envelope, _fsync, _lock, _matches, _read, _route, _runtime, _sustained,
    canonical, content_hash, require,
)

PLAN_KEYS = {"schemaVersion", "kind", "operationId", "targetKey", "before", "after",
             "backendFingerprint", "qualificationSha256"}
SLOT_KEYS = {"runtime", "route"}
STATES = {"prepared", "switch-intent", "switch-acknowledged", "rollback-intent",
          "accepted", "rolled-back", "rejected"}
STAGED_FILE = re.compile(r"\.web-rollout-[a-z0-9_]{8}\.tmp\Z")


class WebRolloutTarget(Protocol):
    def verify_qualification(self, plan: dict, *, initialize: bool) -> bool:
        """Authenticate artifacts/assembly and independently admit a first-use installed baseline."""

    def inspect(self, plan: dict) -> dict:
        """Independent exact runtimes, ingress route and retained backend fingerprint."""

    def observe_health(self, slot: dict, *, proxied: bool) -> dict:
        """Read a generation-bound health response. Unknown transport or identity raises."""

    def compare_and_swap_route(self, expected: dict, desired: dict) -> None:
        """DefiniteRejected requires proof the update did not and cannot take effect."""


def _validate(plan):
    require(isinstance(plan, dict) and set(plan) == PLAN_KEYS
            and type(plan["schemaVersion"]) is int and plan["schemaVersion"] == 1
            and plan["kind"] == "warpdrive-web-rollout", "versioned Web rollout plan required")
    require(all(_matches(NAME, plan[key]) for key in ("operationId", "targetKey"))
            and all(_matches(HASH, plan[key]) for key in ("backendFingerprint", "qualificationSha256")),
            "Web rollout identity or qualification binding is invalid")
    for slot in (plan["before"], plan["after"]):
        require(isinstance(slot, dict) and set(slot) == SLOT_KEYS, "complete Web slot required")
        _runtime(slot["runtime"])
        _route(slot["route"])
        require(slot["route"]["runtimeId"] == slot["runtime"]["runtimeId"]
                and slot["route"]["generation"] == "wd-" + slot["runtime"]["sourceRevision"],
                "Web route targets another artifact generation")
    old, new = plan["before"], plan["after"]
    require(all(old["runtime"][key] != new["runtime"][key]
                for key in ("runtimeId", "imageId", "sourceRevision", "name"))
            and all(old["route"][key] != new["route"][key] for key in ("generation", "fingerprint"))
            and old["runtime"]["schemaSha256"] == new["runtime"]["schemaSha256"],
            "distinct Web generations with the same observed schema are required")


def _read_target(target, plan):
    actual = target.inspect(copy.deepcopy(plan))
    require(isinstance(actual, dict) and set(actual) == {"beforeRuntime", "afterRuntime", "backendFingerprint", "route"}
            and actual["beforeRuntime"] == plan["before"]["runtime"]
            and actual["backendFingerprint"] == plan["backendFingerprint"],
            "retained Web or backend runtime identity changed")
    candidate, pinned = actual["afterRuntime"], plan["after"]["runtime"]
    require(isinstance(candidate, dict) and set(candidate) == set(pinned)
            and all(candidate[key] == pinned[key] for key in set(pinned) - {"running", "restartCount"})
            and type(candidate["running"]) is bool and type(candidate["restartCount"]) is int
            and pinned["restartCount"] <= candidate["restartCount"] <= 1_000_000,
            "candidate Web artifact identity is unavailable or changed")
    _route(actual["route"])
    require(actual["route"] in (plan["before"]["route"], plan["after"]["route"]),
            "ingress route differs from both qualified generations")
    return actual["route"], candidate == pinned


def _health(target, plan, slot, *, proxied, expected_route, clock, sleep):
    class Unhealthy(Exception):
        pass

    def sample():
        route, stable = _read_target(target, plan)
        require(route == expected_route, "ingress changed during Web health observation")
        if slot == plan["after"] and not stable:
            raise Unhealthy
        value = target.observe_health(copy.deepcopy(slot), proxied=proxied)
        require(isinstance(value, dict) and set(value) == {"generation", "runtimeId", "healthy"}
                and value["generation"] == slot["route"]["generation"]
                and value["runtimeId"] == slot["runtime"]["runtimeId"]
                and type(value["healthy"]) is bool, "Web health response is not bound to the admitted generation")
        observed_route, stable = _read_target(target, plan)
        require(observed_route == route, "route changed during the health probe")
        if not value["healthy"] or (slot == plan["after"] and not stable):
            raise Unhealthy
        return True

    try:
        _sustained(sample, clock, sleep)
    except Unhealthy:
        return False
    return True


def _record(plan, slot):
    return {"schemaVersion": 1, "kind": "warpdrive-accepted-web-generation",
            "targetKey": plan["targetKey"], "backendFingerprint": plan["backendFingerprint"],
            "slot": slot}


def _receipt(plan, state):
    return {"schemaVersion": 1, "kind": "warpdrive-web-rollout-receipt",
            "operationId": plan["operationId"], "planSha256": content_hash(plan),
            "state": state, "backendFingerprint": plan["backendFingerprint"],
            "acceptedGeneration": plan["after" if state == "accepted" else "before"]["route"]["generation"]}


def _write_state(path, value, *, previous=None):
    if previous is not None:
        require(_read(path) == previous, "rollout state changed before commit")
    descriptor, temporary = tempfile.mkstemp(prefix=".web-rollout-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical(_envelope(value)) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        if previous is None:
            os.link(temporary, path, follow_symlinks=False)
        else:
            os.replace(temporary, path)
        _fsync(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _remove_abandoned_write(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_uid == os.geteuid() and info.st_nlink in {1, 2}, "foreign rollout staging file")
    path.unlink()


def _operation_files(state_dir, plan, before, actual_route, initialize):
    accepted_path = state_dir / "accepted-web-generation.json"
    operations = state_dir / "web-rollouts"
    _directory(operations)
    for directory in (state_dir, operations):
        for index, path in enumerate(directory.iterdir()):
            require(index < 1000, "oversized rollout state directory")
            if STAGED_FILE.fullmatch(path.name):
                _remove_abandoned_write(path)
    journal_path = operations / f"{plan['operationId']}.json"
    for index, path in enumerate(operations.iterdir()):
        require(index < 1000 and path.suffix == ".json" and _matches(NAME, path.stem),
                "unexpected or oversized rollout journal inventory")
        if path == journal_path:
            continue
        other = _read(path)
        require(isinstance(other, dict) and set(other) == {"plan", "state"}, "invalid rollout journal")
        _validate(other["plan"])
        require(other["plan"]["targetKey"] == plan["targetKey"] and other["plan"]["operationId"] == path.stem
                and other["state"] in ("accepted", "rejected", "rolled-back"),
                "another or invalid Web rollout holds this target")
    if not journal_path.exists() and not journal_path.is_symlink():
        require(actual_route == before["slot"]["route"], "initial route is not the accepted generation")
        if accepted_path.exists() or accepted_path.is_symlink():
            require(_read(accepted_path) == before, "initial accepted Web generation differs")
        else:
            require(initialize and not any(operations.iterdir()), "accepted Web baseline is missing")
            _write_state(accepted_path, before)
        _write_state(journal_path, {"plan": plan, "state": "prepared"})
    journal = _read(journal_path)
    require(isinstance(journal, dict) and set(journal) == {"plan", "state"}
            and journal["plan"] == plan and isinstance(journal["state"], str)
            and journal["state"] in STATES, "another or invalid Web rollout owns this journal")
    return accepted_path, journal_path, journal


def rollout_web(plan: dict, *, state_dir: Path, target: WebRolloutTarget,
                initialize=False, clock=time.monotonic, sleep=time.sleep) -> dict:
    """Activate a tested Web generation or restore the retained healthy route.

    Use one trusted state directory and one mutation authority per target. Every
    route CAS must be linearizable and single-effect under this same target lock.
    """
    plan = copy.deepcopy(plan)
    _validate(plan)
    require(type(initialize) is bool, "explicit first-use admission required")
    before, after = plan["before"], plan["after"]
    accepted_before, accepted_after = _record(plan, before), _record(plan, after)
    state_dir = Path(state_dir)
    with _lock(state_dir):
        require(target.verify_qualification(copy.deepcopy(plan), initialize=initialize) is True,
                "Web rollout qualification is unavailable")
        route, stable = _read_target(target, plan)
        accepted_path, journal_path, journal = _operation_files(state_dir, plan, accepted_before, route, initialize)

        def advance(state):
            nonlocal journal
            updated = {"plan": plan, "state": state}
            _write_state(journal_path, updated, previous=journal)
            journal = updated

        def health(slot, proxied, expected_route=None):
            if expected_route is None:
                expected_route = slot["route"] if proxied else before["route"]
            return _health(target, plan, slot, proxied=proxied, expected_route=expected_route,
                           clock=clock, sleep=sleep)

        state = journal["state"]
        accepted = _read(accepted_path)
        allowed = (accepted_before, accepted_after) if state in {"switch-intent", "switch-acknowledged"} else (
            accepted_after if state == "accepted" else accepted_before,
        )
        require(accepted in allowed, "accepted pointer is outside the Web rollout")
        if state in {"accepted", "rolled-back", "rejected"}:
            require(route == accepted["slot"]["route"], "recorded result differs from current ingress")
            if state == "accepted" and not stable:
                raise SwitchHeld("accepted Web runtime restarted or stopped")
            return _receipt(plan, state)

        if state == "prepared":
            if not health(before, True) or not health(after, False):
                advance("rejected")
                return _receipt(plan, "rejected")
            advance("switch-intent")
            try:
                target.compare_and_swap_route(copy.deepcopy(before["route"]), copy.deepcopy(after["route"]))
            except DefiniteRejected:
                require(_read_target(target, plan)[0] == before["route"], "rejected switch changed ingress")
                advance("rejected")
                return _receipt(plan, "rejected")
            except Exception as error:
                raise SwitchUnknown("Web route outcome is unresolved") from error
            advance("switch-acknowledged")
            state = journal["state"]
            route, _ = _read_target(target, plan)

        if state == "rollback-intent":
            if route != before["route"] or not health(before, True):
                raise SwitchHeld("retained Web route restoration is unresolved")
            advance("rolled-back")
            return _receipt(plan, "rolled-back")

        if route != after["route"]:
            raise SwitchHeld("candidate Web route is unresolved")
        if health(after, True):
            if accepted == accepted_before:
                _write_state(accepted_path, accepted_after, previous=accepted_before)
            advance("accepted")
            return _receipt(plan, "accepted")

        if state != "switch-acknowledged" or accepted != accepted_before:
            raise SwitchHeld("candidate failed health without a confirmed reversible switch")
        if not health(before, False, expected_route=after["route"]):
            raise SwitchHeld("retained Web is not ready for restoration")
        require(_read_target(target, plan)[0] == after["route"], "ingress changed before restoration")
        advance("rollback-intent")
        try:
            target.compare_and_swap_route(copy.deepcopy(after["route"]), copy.deepcopy(before["route"]))
        except Exception as error:
            raise SwitchUnknown("Web route restoration outcome is unresolved") from error
        if not health(before, True):
            raise SwitchHeld("restored Web did not pass proxied health observation")
        advance("rolled-back")
        return _receipt(plan, "rolled-back")
