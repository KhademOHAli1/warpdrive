"""Check public Warpdrive health from a host independent of the installation."""

import argparse
from contextlib import contextmanager
from datetime import UTC, datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

from installed_web_chain import _directory, _state, _witness
from web_rollout import STAGED_FILE, _write_state
from web_switch import _read, content_hash


_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_HOST = re.compile(rf"(?:{_LABEL}\.)+[a-z](?:[a-z0-9-]{{0,61}}[a-z0-9])?\Z")
_MAX_BODY = 4_096
_STALE_SECONDS = 180
_MAX_PENDING = 64
_STATES = {"healthy", "failed", "unknown"}
_TRANSITIONS = {"opened", "recovered", "unknown"}
_STATE_FIELDS = {"hostname", "threshold", "sampleState", "streak", "status", "incidentOpen", "observedAt", "lastTransition"}
_EVENT_ID = re.compile(r"[a-f0-9]{64}\Z")


class AvailabilityQueueFull(ValueError):
    """A transition cannot be accepted without discarding an unacknowledged event."""


def _hostname(host):
    if not isinstance(host, str) or len(host) > 253 or not _HOST.fullmatch(host):
        raise ValueError("A canonical HTTPS hostname is required")


def check(host, *, curl, run=subprocess.run):
    _hostname(host)
    start = time.monotonic()
    state, reason = "unknown", "observer_error"
    command = [
        curl, "--disable", "--silent", "--show-error", "--noproxy", "*",
        "--proto", "=https", "--tlsv1.2", "--connect-timeout", "3", "--max-time", "7",
        "--max-filesize", str(_MAX_BODY), "--request", "GET",
        "--header", "Accept: application/json", "--header", "Accept-Encoding: identity",
        "--header", "Cache-Control: no-cache", "--write-out", "\n%{http_code}",
        f"https://{host}/api/health",
    ]
    try:
        result = run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                     env={"PATH": os.defpath, "LC_ALL": "C"}, timeout=8, check=False)
        if result.returncode == 28:
            state, reason = "failed", "timeout"
        elif result.returncode in (6, 7, 35, 51, 52, 56, 58, 60):
            state, reason = "failed", "transport"
        elif result.returncode == 63:
            state, reason = "failed", "invalid_response"
        elif result.returncode == 0:
            state, reason = _response(result.stdout)
    except subprocess.TimeoutExpired:
        state, reason = "unknown", "observer_timeout"
    except OSError:
        pass
    return {
        "schemaVersion": 1,
        "kind": "warpdrive-public-availability-observation",
        "observedAt": datetime.now(UTC).isoformat(timespec="milliseconds"),
        "durationMs": round((time.monotonic() - start) * 1000),
        "state": state,
        "reason": reason,
    }


def _response(payload):
    body, _, status = payload.rpartition(b"\n")
    if not re.fullmatch(rb"[1-5][0-9]{2}", status) or len(body) > _MAX_BODY:
        return "failed", "invalid_response"
    if status == b"429":
        return "unknown", "rate_limited"
    if status != b"200":
        return "failed", "http_status"
    try:
        pairs = json.loads(body, object_pairs_hook=lambda values: values)
    except (UnicodeError, ValueError, RecursionError):
        return "failed", "invalid_response"
    if isinstance(pairs, list) and len(pairs) == 1 and isinstance(pairs[0], tuple):
        key, value = pairs[0]
        if key == "ok" and value is True:
            return "healthy", "ok"
    return "failed", "invalid_response"


@contextmanager
def _locked_state(directory, hostname, *, repair=False):
    _hostname(hostname)
    _directory(directory)
    path = directory / "availability.json"
    lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not os.path.samestat(os.fstat(lock), directory.lstat()):
            raise ValueError("Availability state directory changed")
        yield path, _read_observer_state(path, lock, hostname, repair=repair)
    finally:
        os.close(lock)


def _read_observer_state(path, directory_fd, hostname, *, repair):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if (stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 2):
        # The shared writer creates the first state with link then unlink. A
        # killed writer can leave the installed state and its staging name.
        with os.scandir(directory_fd) as entries:
            for index, entry in enumerate(entries):
                if index >= 256:
                    raise ValueError("Availability staging inventory is oversized")
                if STAGED_FILE.fullmatch(entry.name) and os.path.samestat(info, entry.stat(follow_symlinks=False)):
                    value = _read(path)
                    _outbox(value, hostname)
                    if _witness(info) != _witness(path.lstat()):
                        raise ValueError("Availability state changed during read")
                    if repair:
                        os.unlink(entry.name, dir_fd=directory_fd)
                        os.fsync(directory_fd)
                        break
                    return value
    return _state(path)


def _date(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Availability timestamp is invalid")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Availability timestamp requires a timezone")
    return parsed


def _event(hostname, transition):
    if type(transition) is not dict or set(transition) != {"kind", "observedAt"} or transition["kind"] not in _TRANSITIONS:
        raise ValueError("Availability transition is invalid")
    _date(transition["observedAt"])
    return {"id": content_hash({"hostname": hostname, **transition}), **transition}


def _valid_id(value):
    return isinstance(value, str) and _EVENT_ID.fullmatch(value) is not None


def _outbox(prior, hostname):
    if prior is None:
        return {"pending": [], "lastAcknowledgedId": None}
    if (type(prior) is not dict or set(prior) not in (_STATE_FIELDS, _STATE_FIELDS | {"outbox"})
            or type(prior["threshold"]) is not int or not 1 <= prior["threshold"] <= 10
            or type(prior["incidentOpen"]) is not bool or type(prior["streak"]) is not int
            or not 1 <= prior["streak"] <= prior["threshold"] or prior["sampleState"] not in _STATES
            or prior["status"] not in _STATES | {"unchecked"}):
        raise ValueError("Observer state format is invalid")
    if prior["hostname"] != hostname:
        raise ValueError("Observer state belongs to another authority")
    last_sample = _date(prior["observedAt"])
    latest = None if prior["lastTransition"] is None else _event(hostname, prior["lastTransition"])
    if latest is not None and _date(latest["observedAt"]) > last_sample:
        raise ValueError("Availability transition is newer than the sample")
    if "outbox" not in prior:
        return {"pending": [] if latest is None else [latest], "lastAcknowledgedId": None}
    outbox = prior["outbox"]
    if type(outbox) is not dict or set(outbox) != {"pending", "lastAcknowledgedId"}:
        raise ValueError("Availability outbox format is invalid")
    pending, acknowledged = outbox["pending"], outbox["lastAcknowledgedId"]
    if (type(pending) is not list or len(pending) > _MAX_PENDING
            or (acknowledged is not None and not _valid_id(acknowledged))):
        raise ValueError("Availability outbox format is invalid")
    previous = None
    for entry in pending:
        if type(entry) is not dict or set(entry) != {"id", "kind", "observedAt"}:
            raise ValueError("Availability outbox event is invalid")
        if entry != _event(hostname, {"kind": entry["kind"], "observedAt": entry["observedAt"]}) or entry["id"] == acknowledged:
            raise ValueError("Availability outbox event identity differs")
        current = _date(entry["observedAt"])
        if previous is not None and current <= previous:
            raise ValueError("Availability outbox events are out of order")
        previous = current
    if (pending and pending[-1] != latest) or (not pending and acknowledged != (latest["id"] if latest else None)):
        raise ValueError("Availability outbox and latest transition differ")
    return outbox


def record_observation(directory, hostname, sample, *, threshold=2, now=None):
    """Persist a finite streak and enqueue transitions atomically on the observer host."""
    if type(threshold) is not int or not 1 <= threshold <= 10:
        raise ValueError("Availability threshold must be between 1 and 10")
    state = sample["state"]
    if state not in _STATES:
        raise ValueError("Unknown availability observation")
    now = datetime.now(UTC) if now is None else now
    observed = _date(sample["observedAt"])
    if not -30 <= (now - observed).total_seconds() <= 60:
        raise ValueError("A current observation is required")
    with _locked_state(directory, hostname, repair=True) as (path, prior):
        outbox = _outbox(prior, hostname)
        if prior is not None and prior["threshold"] != threshold:
            raise ValueError("Observer state belongs to another authority")
        previous_at = _date(prior["observedAt"]) if prior else None
        if previous_at is not None and observed <= previous_at:
            raise ValueError("Repeated or out-of-order availability observation")
        consecutive = previous_at is not None and (observed - previous_at).total_seconds() <= _STALE_SECONDS
        same = consecutive and prior["sampleState"] == state
        streak = min(threshold, prior["streak"] + 1) if same else 1
        old_status = prior["status"] if prior is not None else "unchecked"
        incident_open = prior["incidentOpen"] if prior is not None else False
        status = old_status
        if streak >= threshold:
            status = state
        elif previous_at is not None and not consecutive:
            status = "unknown"
        event = None
        if status == "failed" and not incident_open:
            incident_open, event = True, "opened"
        if status == "healthy" and incident_open:
            incident_open, event = False, "recovered"
        if status == "unknown" and status != old_status:
            event = "unknown"
        transition = {"kind": event, "observedAt": sample["observedAt"]} if event else None
        latest = transition if transition else prior["lastTransition"] if prior else None
        if transition is not None:
            if len(outbox["pending"]) >= _MAX_PENDING:
                raise AvailabilityQueueFull("Availability outbox is full")
            outbox = {**outbox, "pending": [*outbox["pending"], _event(hostname, transition)]}
        result = {**sample, "status": status, "incidentOpen": incident_open, "transition": transition,
                  "lastTransition": latest, "consecutive": streak}
        saved = {"hostname": hostname, "threshold": threshold, "sampleState": state, "streak": streak,
                 "status": status, "incidentOpen": incident_open, "observedAt": sample["observedAt"],
                 "lastTransition": latest, "outbox": outbox}
        _write_state(path, saved, previous=prior)
        return result


def read_observer(directory, hostname, *, now=None):
    """Read queued events and compute freshness independently of probe execution."""
    now = datetime.now(UTC) if now is None else now
    with _locked_state(directory, hostname) as (_, prior):
        outbox = _outbox(prior, hostname)
        timestamp = prior["observedAt"] if prior else None
        stale = timestamp is None or not -30 <= (now - _date(timestamp)).total_seconds() <= _STALE_SECONDS
        status = "unknown" if stale or prior["status"] == "unchecked" else prior["status"]
        return {"schemaVersion": 1, "kind": "warpdrive-public-availability-outbox", "hostname": hostname,
                "observedAt": timestamp, "status": status, "stale": stale,
                "incidentOpen": prior["incidentOpen"] if prior else False, **outbox}


def acknowledge_event(directory, hostname, event_id):
    """Acknowledge only the oldest pending event. Repeating the latest ack is safe."""
    if not _valid_id(event_id):
        raise ValueError("An exact availability event ID is required")
    with _locked_state(directory, hostname, repair=True) as (path, prior):
        outbox = _outbox(prior, hostname)
        already_acknowledged = event_id == outbox["lastAcknowledgedId"]
        if not already_acknowledged:
            pending = outbox["pending"]
            if not pending or pending[0]["id"] != event_id:
                raise ValueError("Only the oldest pending availability event can be acknowledged")
            _write_state(path, {**prior, "outbox": {"pending": pending[1:], "lastAcknowledgedId": event_id}}, previous=prior)
        return {"schemaVersion": 1, "kind": "warpdrive-public-availability-ack", "eventId": event_id,
                "alreadyAcknowledged": already_acknowledged}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hostname")
    parser.add_argument("--state-dir", type=Path)
    argv = list(sys.argv[1:] if argv is None else argv)
    action = argv.pop(0) if argv and argv[0] in ("read", "ack") else "observe"
    if action == "ack":
        parser.add_argument("--event-id", required=True)
    if action == "observe":
        parser.add_argument("--failure-threshold", type=int, default=2)
    args = parser.parse_args(argv)
    try:
        if action != "observe" and args.state_dir is None:
            parser.error("read and ack require --state-dir")
        if action == "read":
            result = read_observer(args.state_dir, args.hostname)
        elif action == "ack":
            result = acknowledge_event(args.state_dir, args.hostname, args.event_id)
        else:
            result = check(args.hostname, curl=shutil.which("curl") or "/usr/bin/curl")
            if args.state_dir is not None:
                result = record_observation(args.state_dir, args.hostname, result, threshold=args.failure_threshold)
    except AvailabilityQueueFull:
        parser.exit(2, "Availability outbox is full.\n")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        parser.exit(2, "Availability observation held.\n")
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return {"healthy": 0, "failed": 1, "unknown": 2}[result["state"]] if action == "observe" else 0


if __name__ == "__main__":
    raise SystemExit(main())
