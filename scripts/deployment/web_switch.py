"""An isolated same-image/config/schema Web switch rehearsal, never deployment authority.

The adapter owns one fixed isolated target and bounds every call. It must independently
read actual runtime, route and proxied-health state; a successful command is not evidence.
Only DefiniteRejected promises that a mutation had no side effect. All other mutation
failures are unknown and never authorize another mutation. Local checksums bind recovery
records in trusted storage; they are not signatures or an append-only storage service.
There is deliberately no CLI, cleanup, rollback, worker, migration or storage control.
"""
from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from typing import Protocol

SCOPE = "isolated-same-image-config-schema"
NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
SAMPLES = 3
INTERVAL_SECONDS = 1.0
MAX_BYTES = 128 * 1024
RUNTIME_KEYS = {"runtimeId", "name", "imageId", "sourceRevision", "configSha256",
                "schemaSha256", "restartCount", "running"}
PLAN_KEYS = {"schemaVersion", "kind", "scope", "operationId", "targetKey", "acceptedSha256",
             "imageId", "sourceRevision", "configSha256", "schemaSha256", "candidateName",
             "desiredGeneration", "desiredRouteFingerprint", "unrelatedFingerprint"}
TRANSITIONS = {
    None: {"PREPARED"}, "PREPARED": {"CREATE_INTENT", "REJECTED"},
    "CREATE_INTENT": {"CANDIDATE_CREATED", "UNKNOWN", "REJECTED"},
    "CANDIDATE_CREATED": {"SWITCH_INTENT", "REJECTED"},
    "SWITCH_INTENT": {"UNKNOWN", "HOLD", "COMPLETED", "REJECTED"},
    "UNKNOWN": {"HOLD", "COMPLETED"}, "HOLD": {"COMPLETED"},
    "COMPLETED": set(), "REJECTED": set(),
}


class SwitchError(RuntimeError):
    pass


class SwitchConflict(SwitchError):
    pass


class DefiniteRejected(SwitchError):
    """Adapter guarantee: the requested mutation had no side effect and cannot apply late."""


class SwitchUnknown(SwitchError):
    """No further mutations are permitted; only independent desired-state readback can finish."""


class SwitchHeld(SwitchUnknown):
    """Post-switch verification failed; automatic rollback is deliberately unqualified."""


class WebSwitchAdapter(Protocol):
    def inspect(self, accepted_runtime: dict, candidate_name: str | None) -> dict: ...
    def create_candidate(self, plan: dict) -> None: ...
    def candidate_ready(self, plan: dict) -> bool: ...
    def apply_route(self, plan: dict, expected_route_fingerprint: str) -> None: ...
    def observe_route(self, plan: dict) -> dict: ...


def require(condition, message):
    if not condition:
        raise SwitchConflict(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def content_hash(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _matches(pattern, value):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def _runtime(value, candidate=False):
    require(isinstance(value, dict) and set(value) == RUNTIME_KEYS | ({"ownerOperation"} if candidate else set()),
            "runtime identity is incomplete")
    require(_matches(HASH, value["runtimeId"]) and _matches(NAME, value["name"])
            and _matches(IMAGE, value["imageId"]) and _matches(REVISION, value["sourceRevision"])
            and all(_matches(HASH, value[key]) for key in ("configSha256", "schemaSha256"))
            and type(value["restartCount"]) is int and 0 <= value["restartCount"] <= 1_000_000
            and value["running"] is True, "invalid runtime identity")
    if candidate:
        require(_matches(NAME, value["ownerOperation"]) and value["restartCount"] == 0,
                "candidate ownership or restart identity is invalid")


def _route(value):
    require(isinstance(value, dict) and set(value) == {"generation", "fingerprint", "runtimeId"}
            and _matches(NAME, value["generation"]) and _matches(HASH, value["fingerprint"])
            and _matches(HASH, value["runtimeId"]), "invalid route identity")


def _accepted(value):
    require(isinstance(value, dict) and set(value) == {"schemaVersion", "kind", "scope", "targetKey",
                                                     "runtime", "route", "unrelatedFingerprint"}
            and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == "warpdrive-accepted-web" and value["scope"] == SCOPE
            and _matches(NAME, value["targetKey"]) and _matches(HASH, value["unrelatedFingerprint"]),
            "isolated accepted Web record required")
    _runtime(value["runtime"])
    _route(value["route"])
    require(value["route"]["runtimeId"] == value["runtime"]["runtimeId"], "accepted route target mismatch")


def _plan(value, before):
    require(isinstance(value, dict) and set(value) == PLAN_KEYS and type(value["schemaVersion"]) is int
            and value["schemaVersion"] == 1 and value["kind"] == "warpdrive-isolated-web-switch"
            and value["scope"] == SCOPE, "isolated same-version switch plan required")
    require(all(_matches(NAME, value[key]) for key in ("operationId", "targetKey", "candidateName", "desiredGeneration"))
            and value["targetKey"] == before["targetKey"] and value["acceptedSha256"] == content_hash(before)
            and value["unrelatedFingerprint"] == before["unrelatedFingerprint"], "switch plan baseline mismatch")
    require(all(value[key] == before["runtime"][key]
                for key in ("imageId", "sourceRevision", "configSha256", "schemaSha256")),
            "rehearsal requires the same image, source, configuration and schema")
    require(value["candidateName"] != before["runtime"]["name"]
            and value["desiredGeneration"] != before["route"]["generation"]
            and _matches(HASH, value["desiredRouteFingerprint"])
            and value["desiredRouteFingerprint"] != before["route"]["fingerprint"],
            "a separate owned candidate and distinct fixed route generation are required")


def _fsync(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _directory(path):
    require(not path.is_symlink(), "state directory must not be a symlink")
    if not path.exists():
        path.mkdir(mode=0o700)
        _fsync(path.parent)
    require(path.is_dir(), "state directory required")


def _envelope(value):
    return {"payload": value, "sha256": content_hash(value)}


def _read(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= MAX_BYTES, "unsafe state file")
        raw = source.read(MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES, "state file exceeds bound")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate state property")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=unique)
        require(isinstance(value, dict) and set(value) == {"payload", "sha256"}
                and value["sha256"] == content_hash(value["payload"]), "state checksum mismatch")
        return value["payload"]
    except (ValueError, TypeError) as error:
        raise SwitchConflict("invalid state document") from error


def _new(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(canonical(_envelope(value)) + b"\n")
        output.flush()
        os.fsync(output.fileno())
    _fsync(path.parent)


def _replace_accepted(path, before, after):
    require(_read(path) == before, "accepted pointer changed before commit")
    descriptor, temporary = tempfile.mkstemp(prefix=".accepted-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical(_envelope(after)) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        _fsync(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextmanager
def _lock(state_dir):
    _directory(state_dir)
    descriptor = os.open(state_dir / "target.lock", os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(descriptor).st_mode), "regular target lock required")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SwitchConflict("another operation owns this target") from error
        yield
    finally:
        os.close(descriptor)


def _inspect(adapter, before, plan=None, candidate=None, route=None):
    snapshot = adapter.inspect(copy.deepcopy(before["runtime"]), plan["candidateName"] if plan else None)
    require(isinstance(snapshot, dict) and set(snapshot) == {"acceptedRuntime", "candidateRuntime", "route", "unrelatedFingerprint"},
            "complete independent target snapshot required")
    require(snapshot["acceptedRuntime"] == before["runtime"]
            and snapshot["unrelatedFingerprint"] == before["unrelatedFingerprint"],
            "accepted runtime or unrelated services changed")
    _route(snapshot["route"])
    if route is not None:
        require(snapshot["route"] == route, "actual route differs from pinned generation and target")
    found = snapshot["candidateRuntime"]
    if found is not None:
        require(plan is not None, "unexpected candidate during bootstrap")
        _runtime(found, candidate=True)
        require(found["name"] == plan["candidateName"] and found["ownerOperation"] == plan["operationId"]
                and found["runtimeId"] != before["runtime"]["runtimeId"]
                and all(found[key] == plan[key] for key in ("imageId", "sourceRevision", "configSha256", "schemaSha256")),
                "candidate differs from owned same-version plan")
    if candidate is not None:
        require(found == candidate, "owned candidate identity changed")
    return found


def initialize_rehearsal(state_dir: Path, accepted: dict, adapter: WebSwitchAdapter) -> dict:
    """Seed local rehearsal state only after reading the exact existing runtime and route."""
    accepted = copy.deepcopy(accepted)
    _accepted(accepted)
    state_dir = Path(state_dir)
    with _lock(state_dir):
        _inspect(adapter, accepted, route=accepted["route"])
        path = state_dir / "accepted.json"
        if path.exists() or path.is_symlink():
            require(_read(path) == accepted, "existing accepted record must not be replaced")
        else:
            _new(path, accepted)
    return copy.deepcopy(accepted)


class _Operation:
    def __init__(self, directory, plan, before):
        self.directory, self.plan, self.before = directory, plan, before
        self.events = []

    def read(self):
        files = sorted(self.directory.iterdir())
        require(len(files) <= 18 and {path.name for path in files}.issuperset({"plan.json", "before-accepted.json"}),
                "incomplete or oversized operation journal")
        require(_read(self.directory / "plan.json") == self.plan
                and _read(self.directory / "before-accepted.json") == self.before, "immutable operation binding changed")
        events = [path for path in files if path.name not in {"plan.json", "before-accepted.json"}]
        for index, path in enumerate(events, 1):
            require(path.name == f"{index:04d}.json", "noncontiguous operation journal")
            value = _read(path)
            require(isinstance(value, dict) and set(value) == {"sequence", "planSha256", "previousSha256", "state", "phase",
                                                             "candidateRuntime", "acceptedSha256", "sustainedSeconds"}
                    and type(value["sequence"]) is int and value["sequence"] == index
                    and value["planSha256"] == content_hash(self.plan)
                    and value["previousSha256"] == (content_hash(self.events[-1]) if self.events else None)
                    and value["state"] in TRANSITIONS[self.state], "invalid journal transition or binding")
            if value["candidateRuntime"] is not None:
                _runtime(value["candidateRuntime"], candidate=True)
                candidate = value["candidateRuntime"]
                require(candidate["name"] == self.plan["candidateName"]
                        and candidate["ownerOperation"] == self.plan["operationId"]
                        and candidate["runtimeId"] != self.before["runtime"]["runtimeId"]
                        and all(candidate[key] == self.plan[key]
                                for key in ("imageId", "sourceRevision", "configSha256", "schemaSha256")),
                        "journal candidate differs from immutable plan")
                if self.events and self.last["candidateRuntime"] is not None:
                    require(candidate == self.last["candidateRuntime"], "journal candidate identity changed")
            required_candidate = value["state"] in {"CANDIDATE_CREATED", "SWITCH_INTENT", "HOLD", "COMPLETED"}
            required_candidate |= value["state"] in {"UNKNOWN", "REJECTED"} and value["phase"] != "create"
            require((value["candidateRuntime"] is not None) == required_candidate,
                    "journal phase has inconsistent candidate identity")
            phases = {"PREPARED": {None}, "CREATE_INTENT": {"create"}, "CANDIDATE_CREATED": {"create"},
                      "SWITCH_INTENT": {"switch"}, "UNKNOWN": {"create", "switch"},
                      "HOLD": {"verification"}, "REJECTED": {"create", "readiness", "switch"},
                      "COMPLETED": {"verification"}}
            require(value["phase"] in phases[value["state"]], "journal phase is invalid")
            if value["state"] == "COMPLETED":
                require(value["acceptedSha256"] == content_hash(_after(self.before, self.plan, value["candidateRuntime"]))
                        and type(value["sustainedSeconds"]) in (int, float)
                        and math.isfinite(value["sustainedSeconds"])
                        and value["sustainedSeconds"] >= (SAMPLES - 1) * INTERVAL_SECONDS,
                        "completed journal lacks sustained acceptance evidence")
            else:
                require(value["acceptedSha256"] is None and value["sustainedSeconds"] is None,
                        "unfinished journal claims acceptance evidence")
            self.events.append(value)
        require(bool(self.events), "operation has no durable phase")

    @property
    def state(self):
        return self.events[-1]["state"] if self.events else None

    @property
    def last(self):
        return self.events[-1]

    def append(self, state, phase=None, candidate=None, accepted_sha=None, seconds=None):
        require(state in TRANSITIONS[self.state], "invalid operation transition")
        value = {"sequence": len(self.events) + 1, "planSha256": content_hash(self.plan),
                 "previousSha256": content_hash(self.last) if self.events else None,
                 "state": state, "phase": phase, "candidateRuntime": copy.deepcopy(candidate),
                 "acceptedSha256": accepted_sha, "sustainedSeconds": seconds}
        _new(self.directory / f"{value['sequence']:04d}.json", value)
        self.events.append(value)


def _sustained(check, clock, sleep):
    start = clock()
    require(isinstance(start, (int, float)) and math.isfinite(start), "monotonic clock required")
    for index in range(SAMPLES):
        require(check() is True, "bounded health observation failed")
        if index + 1 < SAMPLES:
            sleep(INTERVAL_SECONDS)
    elapsed = clock() - start
    require(math.isfinite(elapsed) and elapsed >= (SAMPLES - 1) * INTERVAL_SECONDS,
            "sustained health window did not elapse")
    return elapsed


def _after(before, plan, candidate):
    return {**copy.deepcopy(before), "runtime": {key: value for key, value in candidate.items() if key != "ownerOperation"},
            "route": {"generation": plan["desiredGeneration"], "fingerprint": plan["desiredRouteFingerprint"],
                      "runtimeId": candidate["runtimeId"]}}


def _verify(adapter, before, plan, candidate, after, clock, sleep):
    def check():
        _inspect(adapter, before, plan, candidate, after["route"])
        observed = adapter.observe_route(copy.deepcopy(plan))
        require(isinstance(observed, dict) and set(observed) == {"generation", "fingerprint", "runtimeId", "healthy"},
                "actual proxied route and health observation required")
        require(type(observed["healthy"]) is bool, "boolean proxied health observation required")
        return observed == {**after["route"], "healthy": True}
    return _sustained(check, clock, sleep)


def rehearse_web_switch(plan: dict, *, state_dir: Path, adapter: WebSwitchAdapter,
                        clock=time.monotonic, sleep=time.sleep) -> dict:
    """Rehearse one fixed Web-only switch; unresolved mutation intents never replay."""
    plan = copy.deepcopy(plan)
    require(isinstance(plan, dict) and _matches(NAME, plan.get("operationId")), "operation identity required")
    state_dir = Path(state_dir)
    with _lock(state_dir):
        accepted_path = state_dir / "accepted.json"
        current = _read(accepted_path)
        _accepted(current)
        operations = state_dir / "operations"
        _directory(operations)
        directories = list(operations.iterdir())
        require(len(directories) <= 100, "bounded target operation history required")
        own = None
        for directory in directories:
            require(directory.is_dir() and not directory.is_symlink() and _matches(NAME, directory.name), "unsafe operation directory")
            retained_plan = _read(directory / "plan.json")
            retained_before = _read(directory / "before-accepted.json")
            _accepted(retained_before)
            _plan(retained_plan, retained_before)
            require(directory.name == retained_plan["operationId"], "operation directory identity mismatch")
            operation = _Operation(directory, retained_plan, retained_before)
            operation.read()
            if directory.name == plan["operationId"]:
                require(retained_plan == plan, "conflicting plan for existing operation")
                own = operation
            else:
                require(operation.state in {"COMPLETED", "REJECTED"}, "another unresolved transaction holds this target")
        if own is None:
            _plan(plan, current)
            candidate = _inspect(adapter, current, plan, route=current["route"])
            require(candidate is None, "candidate already exists without this operation's intent")
            directory = operations / plan["operationId"]
            directory.mkdir(mode=0o700)
            _fsync(operations)
            _new(directory / "plan.json", plan)
            _new(directory / "before-accepted.json", current)
            own = _Operation(directory, plan, current)
            own.append("PREPARED")
        before = own.before
        candidate = own.last["candidateRuntime"]
        after = _after(before, plan, candidate) if candidate is not None else None
        require(current == before or (after is not None and current == after
                                      and own.state in {"SWITCH_INTENT", "UNKNOWN", "HOLD", "COMPLETED"}),
                "accepted pointer is outside this transaction")
        if own.state == "REJECTED":
            _inspect(adapter, before, plan, candidate, before["route"])
            raise DefiniteRejected("retained operation was definitely rejected; no mutation replayed")
        if own.state in {"CREATE_INTENT", "UNKNOWN"} and own.last["phase"] == "create":
            raise SwitchUnknown("candidate creation outcome is unresolved; all mutations remain held")
        if own.state == "PREPARED":
            require(_inspect(adapter, before, plan, route=before["route"]) is None,
                    "candidate exists without a durable creation intent")
            own.append("CREATE_INTENT", phase="create")
            try:
                adapter.create_candidate(copy.deepcopy(plan))
            except DefiniteRejected:
                own.append("REJECTED", phase="create")
                raise
            except Exception as error:
                own.append("UNKNOWN", phase="create")
                raise SwitchUnknown("candidate creation outcome is unknown") from error
            try:
                candidate = _inspect(adapter, before, plan, route=before["route"])
                require(candidate is not None, "created candidate is not independently visible")
            except Exception as error:
                own.append("UNKNOWN", phase="create")
                raise SwitchUnknown("candidate creation could not be independently reconciled") from error
            own.append("CANDIDATE_CREATED", phase="create", candidate=candidate)
        if own.state == "CANDIDATE_CREATED":
            candidate = own.last["candidateRuntime"]
            try:
                def ready():
                    _inspect(adapter, before, plan, candidate, before["route"])
                    return adapter.candidate_ready(copy.deepcopy(plan))
                _sustained(ready, clock, sleep)
            except Exception as error:
                own.append("REJECTED", phase="readiness", candidate=candidate)
                raise DefiniteRejected("candidate readiness rejected before any route switch") from error
            own.append("SWITCH_INTENT", phase="switch", candidate=candidate)
            try:
                adapter.apply_route(copy.deepcopy(plan), before["route"]["fingerprint"])
            except DefiniteRejected:
                own.append("REJECTED", phase="switch", candidate=candidate)
                raise
            except Exception as error:
                own.append("UNKNOWN", phase="switch", candidate=candidate)
                raise SwitchUnknown("route apply outcome is unknown; no retry or rollback is permitted") from error
        candidate = own.last["candidateRuntime"]
        require(candidate is not None, "switch recovery requires a pinned owned candidate")
        after = _after(before, plan, candidate)
        try:
            seconds = _verify(adapter, before, plan, candidate, after, clock, sleep)
        except Exception as error:
            if own.state == "SWITCH_INTENT":
                own.append("HOLD", phase="verification", candidate=candidate)
            raise SwitchHeld("desired route has not passed sustained independent verification; mutations held") from error
        current = _read(accepted_path)
        if current == before:
            require(own.state != "COMPLETED", "completed operation lost its accepted pointer")
            _replace_accepted(accepted_path, before, after)
        else:
            require(current == after, "accepted pointer changed during verification")
        if own.state != "COMPLETED":
            own.append("COMPLETED", phase="verification", candidate=candidate,
                       accepted_sha=content_hash(after), seconds=seconds)
        return {"schemaVersion": 1, "kind": "warpdrive-isolated-web-switch-receipt", "scope": SCOPE,
                "operationId": plan["operationId"], "state": "COMPLETED", "planSha256": content_hash(plan),
                "acceptedSha256": content_hash(after), "journalSha256": content_hash(own.last),
                "sustainedSeconds": seconds, "samples": SAMPLES, "deploymentAuthorized": False,
                "limitations": ["Same image, configuration and schema isolated Web rehearsal only.",
                                "No old/new compatibility, automatic rollback, production or data recovery qualification."]}
