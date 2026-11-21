"""Submit an allowlisted Core process diagnostic to the private Operations collector."""

import argparse
import binascii
import os
from pathlib import Path
import re
import sys
import time

from component_inputs import decode
from web_rollout_monitor import _report_sequenced_observation, _send, _stdin_handoff
from web_switch import SwitchConflict, content_hash, require


CORE_CODES = {
    "CORE_STARTING": ("startup", "info"),
    "CORE_CONFIGURATION_INVALID": ("startup", "error"),
    "CORE_STARTUP_FAILED": ("startup", "error"),
    "CORE_STARTUP_TIMEOUT": ("startup", "error"),
    "CORE_DB_ROLE_REJECTED": ("startup", "error"),
    "CORE_LISTENER_FAILED": ("startup", "error"),
    "CORE_READY": ("readiness", "info"),
    "CORE_READINESS_FAILED": ("readiness", "error"),
    "CORE_READINESS_TIMEOUT": ("readiness", "error"),
    "CORE_PRODUCER_FAILED": ("runtime", "error"),
    "CORE_DATABASE_FAILED": ("runtime", "error"),
    "CORE_TRANSPORT_FAILED": ("runtime", "error"),
    "CORE_WEB_IDENTITY_UNAVAILABLE": ("runtime", "warn"),
    "CORE_DRAINING": ("drain", "info"),
    "CORE_DRAINED": ("drain", "info"),
    "CORE_DRAIN_FAILED": ("drain", "error"),
    "CORE_DRAIN_TIMEOUT": ("drain", "error"),
}
CORE_FAILURE_REASONS = {code.lower() for code, (_, level) in CORE_CODES.items() if level == "error"}
STATES = ("new", "starting", "ready", "draining", "closed", "failed")
FAILURES = ("startup", "producer", "database", "listener", "health", "transport")
STEPS = ("http", "producer", "database", "runtime")
UUID_V4 = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
MAX_SAFE_INTEGER = 2**53 - 1
REQUIRED = {"event", "schemaVersion", "component", "observedAtMs", "code", "phase", "level", "processGeneration"}
OPTIONAL = {"state", "failure", "step", "activeRequests", "admittedBodyBytes"}


def _bounded_int(value):
    return type(value) is int and 0 <= value <= MAX_SAFE_INTEGER


def _generation(value):
    return isinstance(value, str) and UUID_V4.fullmatch(value) is not None


def _observed_at(value):
    return _bounded_int(value) and value <= time.time_ns() // 1_000_000 + 30_000


def _project(raw):
    require(type(raw) is dict and REQUIRED <= raw.keys() <= REQUIRED | OPTIONAL
            and raw["event"] == "warpdrive.runtime.diagnostic" and type(raw["schemaVersion"]) is int
            and raw["schemaVersion"] == 1 and raw["component"] == "core-api"
            and _observed_at(raw["observedAtMs"]) and _generation(raw["processGeneration"]),
            "Invalid Core runtime diagnostic")
    code = raw["code"]
    require(isinstance(code, str) and CORE_CODES.get(code) == (raw["phase"], raw["level"])
            and ("state" not in raw or raw["state"] in STATES)
            and ("failure" not in raw or raw["failure"] in FAILURES)
            and ("step" not in raw or raw["step"] in STEPS)
            and all(key not in raw or _bounded_int(raw[key]) for key in ("activeRequests", "admittedBodyBytes")),
            "Unknown Core runtime diagnostic facts")
    ready = code == "CORE_READY"
    if not ready and raw["level"] != "error":
        return None
    require(not ready or raw.get("state") == "ready", "Core ready event requires the ready state")
    event = {"observedAtMs": raw["observedAtMs"], "observation": {
        "kind": "component", "component": "core_api", "state": "healthy" if ready else "failed",
        "reason": "ok" if ready else code.lower(), "processGeneration": raw["processGeneration"],
        "latencyMs": None, "installed": {"evidence": "unchecked"},
    }}
    return {**event, "eventSha256": content_hash(event)}


def _validate(event, digest):
    require(type(event) is dict and set(event) == {"eventSha256", "observedAtMs", "observation"}
            and event["eventSha256"] == digest and _observed_at(event["observedAtMs"]),
            "Invalid retained Core event")
    observation = event["observation"]
    require(type(observation) is dict and set(observation) == {
        "kind", "component", "state", "reason", "processGeneration", "latencyMs", "installed",
    } and observation["kind"] == "component" and observation["component"] == "core_api"
        and observation["latencyMs"] is None and observation["installed"] == {"evidence": "unchecked"}
        and _generation(observation["processGeneration"]) and isinstance(observation["reason"], str)
        and ((observation["state"], observation["reason"]) == ("healthy", "ok") or (
            observation["state"] == "failed" and observation["reason"] in CORE_FAILURE_REASONS))
        and content_hash({"observedAtMs": event["observedAtMs"], "observation": observation}) == digest,
        "Invalid retained Core observation")
    return event


def report_core_diagnostic(outbox, config, *, raw=None, retry_pending=False, send=_send):
    """Record one lifecycle event or replay one retained sequence after an uncertain reply."""
    require(retry_pending == (raw is None), "Supply one Core event or retry the retained batch")
    event = None if retry_pending else _project(raw)
    if event is None and not retry_pending:
        return "ignored"
    return _report_sequenced_observation(outbox, config, lambda: event,
                                         digest=event["eventSha256"] if event else None,
                                         filename="core-runtime-monitor.json", digest_field="eventSha256",
                                         validate=_validate, send=send)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outbox", required=True, type=Path)
    parser.add_argument("--reporter-config", required=True, type=Path)
    parser.add_argument("--retry-pending", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        require(os.geteuid() != 0, "Run the Core reporter under the separate Operations account")
        raw = None if args.retry_pending else decode(_stdin_handoff(sys.stdin.fileno()).read())
        result = report_core_diagnostic(args.outbox, args.reporter_config, raw=raw, retry_pending=args.retry_pending)
    except (OSError, ValueError, TypeError, KeyError, SwitchConflict, binascii.Error):
        result = "held"
    print(result)
    return 0 if result in ("accepted", "unchanged", "ignored") else 1


if __name__ == "__main__":
    raise SystemExit(main())
