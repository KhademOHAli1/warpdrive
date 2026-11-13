"""Report an independently pinned recovery byte-readback to a private Operations socket."""

import argparse
from hashlib import sha256
import os
from pathlib import Path
import time
import uuid

from component_inputs import decode
from installed_web_chain import _private_bytes, _state
from web_rollout import _write_state
from web_rollout_monitor import _configuration, _locked_outbox, _retain_pending, _send, _uuid
from web_switch import HASH, SwitchConflict, _fsync, _matches, canonical, require


HANDOFF_KIND = "warpdrive-recovery-restore-monitor-handoff"
STAGE = "restore_bytes_verified"
_NO_ACCEPTANCE = {
    "applicationRecoveryAccepted", "offHostAccepted", "keyCustodyAccepted", "writerResumptionAuthorized",
}
_RESTORE_FIELDS = _NO_ACCEPTANCE | {
    "schemaVersion", "kind", "snapshotId", "receiptSha256", "manifestSha256", "verifiedBytes",
    "verifiedEntries", "durationMs", "isolatedRestoreBytesVerified",
}
_HANDOFF_FIELDS = {"schemaVersion", "kind", "operationsInstallationId", "repositoryId", "completedAtMs", "restore"}
_MAX_HANDOFF_BYTES = 1024
_MAX_SEQUENCE = 2**53 - 1
_MAX_TIMESTAMP = 8_640_000_000_000_000
_MAX_DURATION = 10 * 365 * 24 * 60 * 60 * 1000
_MAX_BYTES = 2**50
_CLOCK_SKEW_MS = 30_000


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _operations_uuid(value):
    if not _uuid(value):
        return False
    return value in ("00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff") or (
        value[14] in "12345678" and value[19] in "89ab")


def _handoff(value):
    require(type(value) is dict and set(value) == _HANDOFF_FIELDS
            and _integer(value["schemaVersion"], 1, 1) and value["kind"] == HANDOFF_KIND
            and _operations_uuid(value["operationsInstallationId"]) and _matches(HASH, value["repositoryId"])
            and _integer(value["completedAtMs"], 1, _MAX_TIMESTAMP), "Exact recovery monitoring handoff required")
    result = value["restore"]
    require(type(result) is dict and set(result) == _RESTORE_FIELDS
            and _integer(result["schemaVersion"], 1, 1) and result["kind"] == "warpdrive-independent-recovery-restore"
            and all(_matches(HASH, result[key]) for key in ("snapshotId", "receiptSha256", "manifestSha256"))
            and result["isolatedRestoreBytesVerified"] is True
            and all(result[key] is False for key in _NO_ACCEPTANCE)
            and _integer(result["verifiedEntries"], 1, 100_000)
            and _integer(result["verifiedBytes"], 0, _MAX_BYTES)
            and _integer(result["durationMs"], 0, _MAX_DURATION), "Exact successful isolated restore result required")
    return value


def build_restore_handoff(restore, *, installation_id, repository_id, completed_at_ms):
    """Encode the verifier-owned result and completion time for an independent SHA pin."""
    return canonical(_handoff({"schemaVersion": 1, "kind": HANDOFF_KIND,
                               "operationsInstallationId": installation_id, "repositoryId": repository_id,
                               "completedAtMs": completed_at_ms, "restore": restore}))


def _read_observation(path, handoff_sha256, receipt_sha256, installation_id):
    raw = _private_bytes(path, modes=(0o400, 0o600))
    require(len(raw) <= _MAX_HANDOFF_BYTES and sha256(raw).hexdigest() == handoff_sha256,
            "Recovery monitoring handoff differs from its independent SHA-256")
    value = _handoff(decode(raw))
    result = value["restore"]
    completed = value["completedAtMs"]
    require(raw == canonical(value) and value["operationsInstallationId"] == installation_id
            and result["receiptSha256"] == receipt_sha256
            and completed <= time.time_ns() // 1_000_000 + _CLOCK_SKEW_MS,
            "Recovery monitoring handoff scope, receipt or clock differs")
    recovery_set = uuid.uuid5(uuid.UUID(installation_id),
                              f"warpdrive-recovery-set/v1/{value['repositoryId']}/{result['snapshotId']}")
    return {"kind": "recovery", "stage": STAGE, "state": "healthy", "reason": "ok",
            "recoverySetId": str(recovery_set), "completedAtMs": completed, "durationMs": result["durationMs"],
            "bytes": result["verifiedBytes"], "encrypted": True, "contentSha256": result["manifestSha256"]}


def _validate_record(record, generation, sequence):
    require(sequence >= 1 and type(record) is dict and set(record) == {"handoffSha256", "receiptSha256", "batch"}
            and all(_matches(HASH, record[key]) for key in ("handoffSha256", "receiptSha256")),
            "Invalid retained recovery monitoring identity")
    batch = record["batch"]
    require(type(batch) is dict and set(batch) == {"schemaVersion", "generationId", "sequence", "observedAtMs", "observations"}
            and _integer(batch["schemaVersion"], 2, 2) and batch["generationId"] == generation
            and _integer(batch["sequence"], sequence, sequence)
            and _integer(batch["observedAtMs"], 1, _MAX_TIMESTAMP)
            and type(batch["observations"]) is list and len(batch["observations"]) == 1,
            "Invalid retained recovery monitoring batch")
    observation = batch["observations"][0]
    require(type(observation) is dict and set(observation) == {
        "kind", "stage", "state", "reason", "recoverySetId", "completedAtMs", "durationMs", "bytes", "encrypted",
        "contentSha256",
    } and (observation["kind"], observation["stage"], observation["state"], observation["reason"])
            == ("recovery", STAGE, "healthy", "ok")
            and _uuid(observation["recoverySetId"]) and observation["encrypted"] is True
            and _integer(observation["completedAtMs"], batch["observedAtMs"], batch["observedAtMs"])
            and _integer(observation["durationMs"], 0, _MAX_DURATION) and _integer(observation["bytes"], 0, _MAX_BYTES)
            and _matches(HASH, observation["contentSha256"]), "Invalid retained recovery monitoring observation")


def _selected(record, handoff_sha256, receipt_sha256):
    return (record["handoffSha256"], record["receiptSha256"]) == (handoff_sha256, receipt_sha256)


def report_restore(outbox, config, *, handoff, handoff_sha256, receipt_sha256, send=_send):
    """Publish one sequenced observation, or retry the exact retained body without the handoff file."""
    require(_matches(HASH, handoff_sha256) and _matches(HASH, receipt_sha256), "Independent recovery SHA-256 pins required")
    socket_path, binding, key = _configuration(config)
    require(all(_operations_uuid(value) for value in binding.values()), "Canonical Operations UUID binding required")
    generation = binding["generationId"]
    with _locked_outbox(outbox):
        filename = outbox / "recovery-restore-monitor.json"
        prior = _state(filename) if os.path.lexists(filename) else None
        state = {"binding": binding, "sequence": 0, "published": None, "pending": None} if prior is None else prior
        require(type(state) is dict and set(state) == {"binding", "sequence", "published", "pending"}
                and state["binding"] == binding and _integer(state["sequence"], 0, _MAX_SEQUENCE),
                "Exact recovery outbox generation required")
        sequence, published, pending = state["sequence"], state["published"], state["pending"]
        require((sequence > 0) == (published is not None or pending is not None)
                and (published is not None or sequence <= 1), "Recovery outbox sequence history differs")
        if published is not None:
            _validate_record(published, generation, sequence - int(pending is not None))
        if pending is not None:
            _validate_record(pending, generation, sequence)
            require(_selected(pending, handoff_sha256, receipt_sha256)
                    and (published is None or pending["batch"]["observedAtMs"] > published["batch"]["observedAtMs"]),
                    "Pending recovery observation differs from the selected handoff or ordering")
            # A previous invocation may have stopped after rename but before
            # syncing the directory. Establish durability before any send.
            _fsync(outbox)
        else:
            if published is not None and _selected(published, handoff_sha256, receipt_sha256):
                return "unchanged"
            require(handoff is not None and sequence < _MAX_SEQUENCE, "No matching recovery observation to retry")
            observation = _read_observation(handoff, handoff_sha256, receipt_sha256, binding["installationId"])
            observed = observation["completedAtMs"]
            require(published is None or observed > published["batch"]["observedAtMs"],
                    "Recovery observation would replace newer or equally timed evidence")
            batch = {"schemaVersion": 2, "generationId": generation, "sequence": sequence + 1,
                     "observedAtMs": observed, "observations": [observation]}
            pending = {"handoffSha256": handoff_sha256, "receiptSha256": receipt_sha256, "batch": batch}
            state = {**state, "sequence": sequence + 1, "pending": pending}
            _retain_pending(filename, state, prior)
        result = send(socket_path, binding, key, pending["batch"])
        if result == "accepted":
            _write_state(filename, {**state, "published": pending, "pending": None}, previous=state)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    report = commands.add_parser("report", help="Publish or replay exact recovery byte-readback evidence")
    source = report.add_mutually_exclusive_group(required=True)
    source.add_argument("--handoff", type=Path)
    source.add_argument("--retry-pending", action="store_true")
    report.add_argument("--outbox", required=True, type=Path)
    report.add_argument("--config", required=True, type=Path)
    report.add_argument("--handoff-sha256", required=True)
    report.add_argument("--receipt-sha256", required=True)
    args = parser.parse_args()
    try:
        result = report_restore(args.outbox, args.config, handoff=args.handoff,
                                handoff_sha256=args.handoff_sha256, receipt_sha256=args.receipt_sha256)
    except (OSError, ValueError, TypeError, KeyError, SwitchConflict):
        result = "held"
    print(result)
    return 0 if result in ("accepted", "unchanged") else 1


if __name__ == "__main__":
    raise SystemExit(main())
