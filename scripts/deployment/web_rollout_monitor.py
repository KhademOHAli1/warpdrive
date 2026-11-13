"""Read and publish a native Web rollout result under separate local accounts."""

import argparse
import base64
import binascii
from contextlib import contextmanager
import fcntl
import hashlib
import hmac
from http.client import HTTPException, HTTPResponse
import io
import os
from pathlib import Path
import re
import select
import socket
import stat
import sys
import tempfile
import time
import uuid

from component_inputs import decode
from installed_web_chain import _directory, _private_bytes, _state
from installed_web_readback_lock import installed_web_readback_locks
from web_rollout import STATES, _receipt, _record, _validate, _write_state
from web_rollout_observation import web_rollout_observation
from web_switch import HASH, NAME, REVISION, SwitchConflict, _envelope, _fsync, canonical, content_hash, require


_COLLECTOR_PATH = "/api/internal/operations/observations"
_MAX_SEQUENCE = 2**53 - 1
_MAX_HANDOFF_BYTES = 1024
_TERMINAL = ("accepted", "rolled-back", "rejected")


def read_observation(original, state, operation, plan_sha256):
    """Read exactly the selected installed journal and pointer under existing release locks."""
    require(NAME.fullmatch(operation) and HASH.fullmatch(plan_sha256), "Exact rollout identity required")
    with installed_web_readback_locks(original, state):
        directory = state / "web-rollouts"
        _directory(directory)
        path = directory / (operation + ".json")
        journal = _state(path)
        require(type(journal) is dict and set(journal) == {"plan", "state"}
                and journal["state"] in STATES, "Invalid native Web rollout journal")
        plan = journal["plan"]
        _validate(plan)
        require(plan["operationId"] == operation and content_hash(plan) == plan_sha256,
                "Native rollout differs from the selected plan")
        require(journal["state"] != "prepared", "Prepared rollout has no submission outcome")
        current = _state(state / "accepted-web-generation.json")
        before, after = (_record(plan, plan[side]) for side in ("before", "after"))
        phase = journal["state"]
        if phase in _TERMINAL:
            require(current == (after if phase == "accepted" else before),
                    "Rollout result differs from the current accepted pointer")
            receipt = _receipt(plan, phase)
        else:
            allowed = (before,) if phase == "rollback-intent" else (before, after)
            require(current in allowed, "Unresolved rollout differs from the accepted pointer")
            receipt = None
        observed = path.stat().st_mtime_ns
        for index, other in enumerate(directory.iterdir()):
            require(index < 1000, "Native Web journal exceeds its bound")
            if other == path:
                continue
            require(other.suffix == ".json" and NAME.fullmatch(other.stem),
                    "Unexpected native Web journal entry")
            value = _state(other)
            require(type(value) is dict and set(value) == {"plan", "state"}
                    and value["state"] in _TERMINAL, "Another unresolved rollout holds monitoring")
            _validate(value["plan"])
            require(value["plan"]["targetKey"] == plan["targetKey"]
                    and value["plan"]["operationId"] == other.stem, "Native Web journal scope differs")
            require(other.stat().st_mtime_ns < observed, "A later rollout supersedes the selected outcome")
        # The locked controller replaces its journal at each state transition.
        # Using this timestamp keeps replay from making historical evidence newer.
        observed //= 1_000_000
        require(0 <= observed <= time.time_ns() // 1_000_000 + 30_000, "Invalid rollout journal clock")
        reverse = operation.endswith("-rollback") or re.fullmatch(r"emergency-[a-f0-9]{48}", operation) is not None
        observation = web_rollout_observation(plan, receipt, explicit_rollback=reverse)
        return {"planSha256": plan_sha256, "observedAtMs": observed, "observation": observation}


def _uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except ValueError:
        return False


def _validate_event(event, plan_sha256):
    require(type(event) is dict and set(event) == {"planSha256", "observedAtMs", "observation"}
            and event["planSha256"] == plan_sha256
            and type(event["observedAtMs"]) is int and 0 <= event["observedAtMs"] <= 8_640_000_000_000_000,
            "Exact monitoring observation required")
    observation = event["observation"]
    require(type(observation) is dict and set(observation) == {
        "kind", "component", "state", "reason", "outcome", "sourceRevision", "proofSha256",
    } and observation["kind"] == "deployment" and observation["component"] == "web",
        "Exact Web deployment observation required")
    outcome = observation["outcome"]
    state, reason = observation["state"], observation["reason"]
    revision, proof = observation["sourceRevision"], observation["proofSha256"]
    if outcome == "unknown":
        require((state, reason, revision, proof) == ("unknown", "submission_unknown", None, None),
                "Unknown Web outcome cannot declare a revision or proof")
    else:
        expected = ("healthy", "ok") if outcome == "accepted" else ("failed", "operation_failed")
        require(outcome in ("accepted", "rejected", "rolled_back") and (state, reason) == expected
                and isinstance(revision, str) and REVISION.fullmatch(revision)
                and isinstance(proof, str) and HASH.fullmatch(proof), "Web outcome proof is incomplete")
    return event


def read_handoff(stream, operation, plan_sha256):
    raw = stream.read(_MAX_HANDOFF_BYTES + 1)
    require(0 < len(raw) <= _MAX_HANDOFF_BYTES, "Bounded native Web handoff required")
    value = decode(raw)
    require(type(value) is dict and set(value) == {"operationId", "event"}
            and value["operationId"] == operation and raw == canonical(value) + b"\n",
            "Native Web handoff differs from the selected operation")
    return _validate_event(value["event"], plan_sha256)


def _stdin_handoff(descriptor, *, seconds=5):
    deadline = time.monotonic() + seconds
    raw = bytearray()
    while len(raw) <= _MAX_HANDOFF_BYTES:
        remaining = deadline - time.monotonic()
        require(remaining > 0 and select.select([descriptor], [], [], remaining)[0],
                "Native Web handoff timed out")
        chunk = os.read(descriptor, _MAX_HANDOFF_BYTES + 1 - len(raw))
        if not chunk:
            return io.BytesIO(raw)
        raw.extend(chunk)
    raise SwitchConflict("Native Web handoff exceeded its bound")


def _configuration(path):
    value = decode(_private_bytes(path, modes=(0o400, 0o600)))
    require(type(value) is dict and set(value) == {"socketPath", "binding", "signingKey"},
            "Exact local monitoring reporter configuration required")
    binding = value["binding"]
    require(type(binding) is dict and set(binding) == {"installationId", "sourceId", "generationId"}
            and all(_uuid(part) for part in binding.values()), "Canonical monitoring binding required")
    path = Path(value["socketPath"])
    require(path.is_absolute() and path.name == "collector.sock", "Private collector socket required")
    encoded = value["signingKey"]
    require(isinstance(encoded, str) and re.fullmatch(r"[A-Za-z0-9_-]{43}", encoded),
            "Canonical monitoring signing key required")
    key = base64.b64decode(encoded + "=", altchars=b"-_", validate=True)
    require(len(key) == 32 and base64.urlsafe_b64encode(key).decode().rstrip("=") == encoded,
            "Canonical monitoring signing key required")
    return path, binding, key


class _BoundedReader(io.RawIOBase):
    def __init__(self, connection, deadline):
        self.connection = connection
        self.deadline = deadline
        self.remaining = 8192

    def readable(self):
        return True

    def makefile(self, _mode):
        return io.BufferedReader(self)

    def readinto(self, buffer):
        _set_timeout(self.connection, self.deadline)
        count = self.connection.recv_into(memoryview(buffer)[:self.remaining + 1])
        self.remaining -= count
        if self.remaining < 0:
            raise ValueError("Collector response exceeds wire bound")
        return count


def _set_timeout(connection, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError
    connection.settimeout(remaining)


def _send(path, binding, key, batch):
    body = canonical(batch)
    timestamp = str(time.time_ns() // 1_000_000)
    prefix = "\n".join(("warpdrive.operations.collector.v1", "POST", _COLLECTOR_PATH,
                        binding["installationId"], binding["sourceId"], binding["generationId"], timestamp, ""))
    signature = hmac.new(key, prefix.encode() + body, hashlib.sha256).hexdigest()
    headers = (f"POST {_COLLECTOR_PATH} HTTP/1.1", "Host: warpdrive-operations.local", "Connection: close",
               "Content-Type: application/json", f"Content-Length: {len(body)}",
               f"X-Warpdrive-Collector-Source: {binding['sourceId']}",
               f"X-Warpdrive-Collector-Timestamp: {timestamp}", f"X-Warpdrive-Collector-Signature: v1={signature}")
    deadline = time.monotonic() + 18
    try:
        _directory(path.parent)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                original = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
                require(stat.S_ISSOCK(original.st_mode) and original.st_uid == os.geteuid()
                        and stat.S_IMODE(original.st_mode) == 0o600, "Private collector socket differs")
                locator = f"/proc/self/fd/{parent}/{path.name}" if sys.platform == "linux" else str(path)
                _set_timeout(connection, deadline)
                connection.connect(locator)
                require(os.path.samestat(original, path.lstat())
                        and os.path.samestat(os.fstat(parent), path.parent.lstat()),
                        "Collector socket authority changed")
                _set_timeout(connection, deadline)
                connection.sendall(("\r\n".join(headers) + "\r\n\r\n").encode() + body)
                with HTTPResponse(_BoundedReader(connection, deadline), method="POST") as response:
                    response.begin()
                    if (response.status == 204
                            and response.headers.get_all("Content-Length", []) in ([], ["0"])
                            and not response.headers.get_all("Transfer-Encoding", [])
                            and response.read(1) == b""):
                        return "accepted"
                    if response.status in (400, 404, 405, 408, 409, 413, 417):
                        return "rejected"
        finally:
            os.close(parent)
    except (OSError, ValueError, SwitchConflict, HTTPException):
        pass
    return "unknown"


@contextmanager
def _locked_outbox(directory):
    _directory(directory)
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(fd)
        require(os.path.samestat(info, directory.lstat()) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o700, "Outbox directory changed")
        yield
    finally:
        os.close(fd)


def _retain_pending(filename, state, prior):
    if prior is not None:
        _write_state(filename, state, previous=prior)
        return
    # A single rename under the outbox lock leaves one readable link even if
    # the process stops between publication and the directory sync.
    descriptor, temporary = tempfile.mkstemp(prefix=".operations-monitor-", suffix=".tmp", dir=filename.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(canonical(_envelope(state)) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        require(not os.path.lexists(filename), "Monitoring outbox appeared before initial commit")
        os.replace(temporary, filename)
        _fsync(filename.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def report_observation(outbox, config, load_observation, *, plan_sha256, send=_send):
    """Retain one sequence before sending, including across a lost response or restart."""
    require(isinstance(plan_sha256, str) and HASH.fullmatch(plan_sha256), "Exact rollout plan digest required")
    path, binding, key = _configuration(config)
    with _locked_outbox(outbox):
        filename = outbox / "web-monitor.json"
        prior = _state(filename) if os.path.lexists(filename) else None
        state = {"binding": binding, "sequence": 0, "published": None, "pending": None} if prior is None else prior
        require(type(state) is dict and set(state) == {"binding", "sequence", "published", "pending"}
                and state["binding"] == binding and type(state["sequence"]) is int
                and 0 <= state["sequence"] <= _MAX_SEQUENCE, "Exact outbox generation required")
        if state["pending"] is None:
            event = _validate_event(load_observation(), plan_sha256)
            if state["published"] == event:
                return "unchanged"
            require(state["published"] is None or event["observedAtMs"] >= state["published"]["observedAtMs"],
                    "An older rollout cannot replace the published observation")
            require(state["sequence"] < _MAX_SEQUENCE, "Monitoring source sequence exhausted")
            state = {**state, "sequence": state["sequence"] + 1, "pending": event}
            _retain_pending(filename, state, prior)
        else:
            _fsync(outbox)
        event = state["pending"]
        require(state["sequence"] > 0 and event["planSha256"] == plan_sha256,
                "A pending observation belongs to a different plan")
        _validate_event(event, plan_sha256)
        batch = {"schemaVersion": 2, "generationId": binding["generationId"], "sequence": state["sequence"],
                 "observedAtMs": event["observedAtMs"], "observations": [event["observation"]]}
        result = send(path, binding, key, batch)
        if result == "accepted":
            _write_state(filename, {**state, "published": event, "pending": None}, previous=state)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    extract = commands.add_parser("extract", help="Read the locked journal as the release owner")
    submit = commands.add_parser("submit", help="Read the operator handoff on stdin as the collector owner")
    for command, names in ((extract, ("original", "state")), (submit, ("outbox", "reporter-config"))):
        for name in names:
            command.add_argument("--" + name, required=True, type=Path)
        command.add_argument("--operation-id", required=True)
        command.add_argument("--plan-sha256", required=True)
    submit.add_argument("--retry-pending", action="store_true", help="Use only a previously retained batch")
    args = parser.parse_args()
    try:
        require(NAME.fullmatch(args.operation_id) and HASH.fullmatch(args.plan_sha256),
                "Exact rollout identity required")
        if args.action == "extract":
            event = read_observation(args.original, args.state, args.operation_id, args.plan_sha256)
            sys.stdout.buffer.write(canonical({"operationId": args.operation_id, "event": event}) + b"\n")
            return 0

        def load_observation():
            require(not args.retry_pending, "No retained batch to retry")
            return read_handoff(_stdin_handoff(sys.stdin.fileno()), args.operation_id, args.plan_sha256)

        result = report_observation(args.outbox, args.reporter_config, load_observation,
                                    plan_sha256=args.plan_sha256)
    except (OSError, ValueError, TypeError, KeyError, SwitchConflict, binascii.Error):
        result = "held"
        if args.action == "extract":
            print(result, file=sys.stderr)
            return 1
    print(result)
    return 0 if result in ("accepted", "unchanged") else 1


if __name__ == "__main__":
    raise SystemExit(main())
