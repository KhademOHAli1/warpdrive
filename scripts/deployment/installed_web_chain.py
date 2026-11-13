"""Admit an installed Web lineage from protected, independently pinned records."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import stat

from component_inputs import decode
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, IMAGE, NAME, MAX_BYTES, _lock, _matches, canonical, content_hash, require


REPOSITORY = "KhademOHAli1/warpdrive"
_GENERATION_KEYS = {"schemaVersion", "kind", "targetKey", "backendFingerprint", "runtime", "alias", "provenance"}
_PROVENANCE_KEYS = {"repository", "revision", "manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256"}
_TERMINAL = {"accepted", "rejected", "rolled-back"}


def _directory(path):
    info = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "Exact private installed Web chain directory required")


def _witness(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode, info.st_uid, info.st_nlink


def _private_bytes(path, *, modes):
    _directory(path.parent)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) in modes
                and info.st_nlink == 1 and 0 < info.st_size <= MAX_BYTES, "Exact private installed Web chain file required")
        raw = source.read(info.st_size + 1)
        require(len(raw) == info.st_size and _witness(info) == _witness(os.fstat(source.fileno())) == _witness(path.lstat()),
                "Installed Web chain file changed during readback")
    return raw


def _state(path):
    value = decode(_private_bytes(path, modes=(0o600,)))
    require(type(value) is dict and set(value) == {"payload", "sha256"}
            and value["sha256"] == content_hash(value["payload"]), "Invalid installed Web rollout state checksum")
    return value["payload"]


def _generation(path, digest, plan, side):
    raw = _private_bytes(path, modes=(0o400, 0o600))
    require(_matches(HASH, digest) and sha256(raw).hexdigest() == digest, "Installed Web generation receipt SHA-256 differs")
    value = decode(raw)
    require(type(value) is dict and set(value) == _GENERATION_KEYS and type(value["schemaVersion"]) is int
            and value["schemaVersion"] == 1 and value["kind"] == "warpdrive-installed-web-generation"
            and value["targetKey"] == plan["targetKey"] and value["backendFingerprint"] == plan["backendFingerprint"],
            "Installed Web generation receipt scope or protected backend differs")
    slot = plan[side]
    require(canonical(value["runtime"]) == canonical(slot["runtime"]), "Installed Web generation runtime differs from the accepted plan")
    route = WebGeneration(slot["route"]["generation"], value["alias"])
    provenance = value["provenance"]
    require(type(provenance) is dict and set(provenance) == _PROVENANCE_KEYS
            and provenance["repository"] == REPOSITORY and provenance["revision"] == slot["runtime"]["sourceRevision"]
            and _matches(IMAGE, provenance["testedConfigDigest"])
            and all(_matches(HASH, provenance[key]) for key in ("manifestSha256", "archiveSha256", "authoritySha256")),
            "Installed Web generation source or artifact provenance differs")
    return {"slot": deepcopy(slot), "alias": route.target, "provenance": deepcopy(provenance), "receiptSha256": digest}


def _admit_journals(directory, plan):
    predecessor_found = False
    for index, path in enumerate(directory.iterdir()):
        require(index < 1000 and path.suffix == ".json" and _matches(NAME, path.stem),
                "Unexpected or oversized installed Web rollout journal inventory")
        journal = _state(path)
        require(type(journal) is dict and set(journal) == {"plan", "state"}
                and isinstance(journal["state"], str) and journal["state"] in _TERMINAL,
                "Another unresolved Web rollout holds this target")
        recorded = journal["plan"]
        _validate(recorded)
        require(recorded["targetKey"] == plan["targetKey"] and recorded["operationId"] == path.stem,
                "Installed Web rollout journal scope differs")
        if recorded["operationId"] == plan["operationId"]:
            require(journal["state"] == "accepted" and canonical(recorded) == canonical(plan),
                    "The exact predecessor Web rollout was never accepted")
            predecessor_found = True
    require(predecessor_found, "The exact predecessor Web rollout was never accepted")


def admit_installed_web_chain(
    state_dir: Path, *, plan: dict, active: Path, previous: Path,
    expected_active_sha256: str, expected_previous_sha256: str,
) -> dict:
    """Match current pointer and predecessor acceptance to two generation receipts.

    The paths and raw receipt digests come from independently authenticated
    custody. The shared target lock only brackets this read, so the caller must
    recheck live route/backend state under its mutation authority before any CAS.
    """
    plan = deepcopy(plan)
    _validate(plan)
    state_dir, active, previous = map(Path, (state_dir, active, previous))
    _directory(state_dir)
    require(active != previous and expected_active_sha256 != expected_previous_sha256,
            "Distinct active and previous installed Web receipts required")
    with _lock(state_dir):
        operations = state_dir / "web-rollouts"
        _directory(operations)
        _admit_journals(operations, plan)
        pointer = state_dir / "accepted-web-generation.json"
        expected = _record(plan, plan["after"])
        require(canonical(_state(pointer)) == canonical(expected), "Accepted installed Web pointer differs from the predecessor plan")
        current = _generation(active, expected_active_sha256, plan, "after")
        retained = _generation(previous, expected_previous_sha256, plan, "before")
        require(current["alias"] != retained["alias"] and all(current["provenance"][key] != retained["provenance"][key]
                for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
                "Active and previous Web receipts refer to the same alias or artifact")
        require(canonical(_state(pointer)) == canonical(expected), "Accepted installed Web pointer changed during chain admission")
    return {"targetKey": plan["targetKey"], "backendFingerprint": plan["backendFingerprint"],
            "acceptedOperationId": plan["operationId"], "acceptedPlanSha256": content_hash(plan),
            "active": current, "previous": retained}
