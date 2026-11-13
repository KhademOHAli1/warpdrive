"""Restore a verified cold recovery set independently of its original host."""

import argparse
from contextlib import ExitStack
import fcntl
import os
import secrets
import stat
import time

from recovery import (
    Command, DirectoryHandle, HASH, INSTALLED_MAX_ROOTS, INSTALLED_RECEIPT_KIND, INSTALLED_SCOPE, MAX_METADATA,
    NAME, RecoveryError, Restic, RestoreTarget, VOLUMES, _validate_installed_manifest, _verify_restore, absolute,
    canonical, digest, document, limits, no_overlap, open_path, require, validate_installed_plan,
)


def _private_document(path):
    with os.fdopen(open_path(path), "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and before.st_nlink == 1
                and stat.S_IMODE(before.st_mode) in (0o400, 0o600) and 0 < before.st_size <= MAX_METADATA,
                "An owned private recovery metadata file is required")
        raw = stream.read(before.st_size + 1)
        after = os.fstat(stream.fileno())
        visible = path.lstat()
        require(len(raw) == before.st_size and os.path.samestat(after, visible)
                and (before.st_mtime_ns, before.st_ctime_ns) == (after.st_mtime_ns, after.st_ctime_ns),
                "Recovery metadata changed during read")
    return raw, document(raw)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _inventory(value, budget, *, max_roots=len(VOLUMES) + 65):
    require(type(value) is dict and set(value) == {"roots", "entries", "bytes"},
            "Exact recovery file inventory required")
    roots, rows, total = (value[key] for key in ("roots", "entries", "bytes"))
    require(type(roots) is list and type(rows) is list and 0 < len(roots) <= min(max_roots, len(rows)) <= budget["files"]
            and len(rows) <= budget["files"]
            and type(total) is int and 0 <= total <= budget["bytes"], "Recovery inventory exceeds its resource budget")
    selected = []
    for name in roots:
        root = absolute(name)
        require(all(no_overlap(root, other) for other in selected), "Overlapping recovery roots")
        selected.append(root)
    indexed = {}
    observed_bytes = 0
    for row in rows:
        require(type(row) is dict and {"kind", "path", "mode", "uid", "gid"} <= row.keys(),
                "Invalid recovery inventory entry")
        path = absolute(row["path"])
        common = {"kind", "path", "mode", "uid", "gid"}
        require(path not in indexed and all(type(row[key]) is int for key in ("mode", "uid", "gid"))
                and 0 <= row["mode"] <= 0o7777 and 0 <= row["uid"] < 2**32 and 0 <= row["gid"] < 2**32,
                "Invalid recovery inventory ownership or mode")
        if row["kind"] == "file":
            require(set(row) == common | {"bytes", "sha256"} and type(row["bytes"]) is int
                    and 0 <= row["bytes"] <= budget["fileBytes"] and _matches(HASH, row["sha256"]),
                    "Recovery file exceeds its bound or lacks a checksum")
            observed_bytes += row["bytes"]
        else:
            require(row["kind"] == "directory" and set(row) == common, "Unsupported recovery inventory member")
        indexed[path] = row["kind"]
    require(observed_bytes == total and set(selected) <= indexed.keys()
            and all(path in selected or indexed.get(path.parent) == "directory" for path in indexed),
            "Recovery inventory roots, ancestors or byte count differ")
    return selected, indexed


def _publish_handoff(directory, name, raw):
    temporary = ".restore-handoff-" + secrets.token_hex(16)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        directory.check()
        require(not os.path.lexists(directory.path / name), "Monitor handoff path is already occupied")
        descriptor = os.open(temporary, flags, 0o600, dir_fd=directory.fd)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            directory.check()
            os.replace(temporary, name, src_dir_fd=directory.fd, dst_dir_fd=directory.fd)
            os.fsync(directory.fd)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory.fd)
            except FileNotFoundError:
                pass
    finally:
        fcntl.flock(directory.fd, fcntl.LOCK_UN)


def restore_existing(receipt_path, *, expected_receipt_sha256, manifest_path, original_manifest_member,
                     reader, restore_target, budget, monitor_handoff=None, operations_installation_id=None,
                     installed_plan=None):
    """Read the exact encrypted snapshot into a new quarantine with no source-host calls.

    Installed profile restore requires its independently retained plan. The
    stock CLI and monitoring contract continue to admit only the Compose schema.
    """
    started = time.monotonic()
    budget = limits(budget)
    deadline = started + budget["seconds"]
    installed = installed_plan is not None
    if installed:
        validate_installed_plan(installed_plan)
        installed_plan = document(canonical(installed_plan))
        require(monitor_handoff is None and operations_installation_id is None,
                "Installed recovery has no approved monitor handoff schema")
    receipt_path, manifest_path, member, target_path = map(
        lambda path: absolute(str(path)), (receipt_path, manifest_path, original_manifest_member, restore_target))
    require(member.name == "recovery-manifest.json", "Exact snapshot manifest member required")
    require(isinstance(reader, Restic) and reader.directory is None, "A separate unused Restic reader is required")
    controls = [receipt_path, manifest_path, target_path, reader.key]
    if reader.repository.startswith("/"):
        controls.append(absolute(reader.repository))
    for index, path in enumerate(controls):
        require(all(no_overlap(path, other) for other in controls[index + 1:]),
                "Recovery control, key, repository and restore paths must be disjoint")
    require(not os.path.lexists(target_path), "Restore target must be a new path")
    raw_receipt, receipt = _private_document(receipt_path)
    require(_matches(HASH, expected_receipt_sha256) and digest(raw_receipt) == expected_receipt_sha256,
            "Verified recovery receipt differs from its independent checksum")
    expected_version = 2 if installed else 1
    expected_kind = INSTALLED_RECEIPT_KIND if installed else "warpdrive-verified-cold-recovery-set"
    require(type(receipt) is dict and type(receipt.get("schemaVersion")) is int and receipt["schemaVersion"] == expected_version
            and receipt.get("kind") == expected_kind
            and all(_matches(NAME, receipt.get(key)) for key in ("operationId", "installationId"))
            and all(_matches(HASH, receipt.get(key)) for key in ("repositoryId", "snapshotId", "manifestSha256", "coldFingerprint"))
            and all(receipt.get(key) is True for key in ("sourceUnchanged", "fullRepositoryIntegrityRead", "isolatedRestoreBytesVerified")),
            "An independently verified cold recovery receipt is required")
    raw_manifest, manifest = _private_document(manifest_path)
    require(digest(raw_manifest) == receipt["manifestSha256"] and canonical(manifest) == raw_manifest
            and type(manifest) is dict and manifest.get("coldFingerprint") == receipt["coldFingerprint"],
            "Recovery manifest differs from the verified receipt")
    if installed:
        require(receipt.get("planSha256") == digest(canonical(installed_plan)) and receipt.get("scope") == INSTALLED_SCOPE
                and receipt.get("separateCredentialFileReadback") is True
                and all(receipt.get(key) is False for key in ("applicationRecoveryAccepted", "offHostAccepted",
                                                               "keyCustodyAccepted", "writerResumptionAuthorized"))
                and all(receipt[key] == installed_plan[key] for key in ("operationId", "installationId", "repositoryId")),
                "Installed recovery receipt differs from its independently admitted plan")
        require("inventory" in manifest, "Installed recovery manifest lacks a file inventory")
        inventory = manifest["inventory"]
        roots, _ = _inventory(inventory, budget, max_roots=INSTALLED_MAX_ROOTS + 1)
        _validate_installed_manifest(manifest, installed_plan, member, inventory)
        watched = absolute(installed_plan["watchedIngress"])
        require(all(no_overlap(control, watched) and no_overlap(control, member)
                    and all(no_overlap(control, root) for root in roots) for control in controls),
                "Installed restore controls overlap original recovery sources")
    else:
        require(set(manifest) == {"schemaVersion", "kind", "planSha256", "tag", "coldFingerprint", "members", "inventory"}
                and type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 1
                and manifest["kind"] == "warpdrive-cold-recovery-manifest" and _matches(HASH, manifest["planSha256"])
                and manifest["tag"] == "warpdrive-recovery:" + receipt["operationId"],
                "Recovery manifest differs from the verified receipt")
        inventory = manifest["inventory"]
        roots, indexed = _inventory(inventory, budget)
        members = manifest["members"]
        require(type(members) is dict and set(members) == set(VOLUMES)
                and all(isinstance(path, str) for path in members.values())
                and len(set(members.values())) == len(VOLUMES)
                and all(indexed.get(absolute(path)) == "directory" for path in members.values()),
                "Every recovery volume must match an inventoried directory")
    require(type(receipt.get("sourceBytes")) is int and receipt["sourceBytes"] == inventory["bytes"]
            and type(receipt.get("sourceEntries")) is int and receipt["sourceEntries"] == len(inventory["entries"])
            and all(no_overlap(root, member) and no_overlap(root, target_path) for root in roots)
            and no_overlap(member, target_path), "Restore target overlaps captured state or source inventory differs")
    require((monitor_handoff is None) == (operations_installation_id is None),
            "Monitor handoff path and Operations installation must be supplied together")
    with ExitStack() as stack:
        if monitor_handoff is not None:
            from recovery_restore_monitor import _operations_uuid, build_restore_handoff
            from web_switch import SwitchConflict

            handoff_path = absolute(str(monitor_handoff))
            require(_operations_uuid(operations_installation_id), "Canonical Operations installation UUID required")
            require(all(no_overlap(handoff_path, path) for path in [*controls, *roots, member]),
                    "Monitor handoff must be outside recovery control and data paths")
            handoff_directory = DirectoryHandle(handoff_path.parent)
            stack.callback(handoff_directory.close)
            metadata = os.fstat(handoff_directory.fd)
            require(metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o700
                    and not os.path.lexists(handoff_path), "Monitor handoff requires a new path in an owned 0700 directory")
        if isinstance(reader.command, Command):
            if hasattr(reader.command, "deadline"):
                previous_deadline = reader.command.deadline
                stack.callback(setattr, reader.command, "deadline", previous_deadline)
                deadline = min(deadline, previous_deadline)
            else:
                stack.callback(delattr, reader.command, "deadline")
            reader.command.deadline = deadline
        if reader.repository.startswith("/"):
            handle = DirectoryHandle(controls[-1], private_parent=True)
            stack.callback(handle.close)
            reader.directory = handle
            stack.callback(setattr, reader, "directory", None)
        target = RestoreTarget(target_path)
        stack.callback(target.close)
        snapshot = receipt["snapshotId"]
        require(reader.repository_id() == receipt["repositoryId"], "Restore repository differs from the verified receipt")
        reader.validate_snapshot(snapshot, manifest["tag"], member, raw_manifest, inventory)
        free = os.fstatvfs(target.parent.fd)
        require(free.f_bavail * free.f_frsize >= inventory["bytes"] + len(raw_manifest) + budget["reserveBytes"]
                and time.monotonic() <= deadline, "Insufficient isolated restore capacity or time budget")
        target.create()
        reader.restore(snapshot, target, budget, inventory=inventory)
        _verify_restore(target, member, raw_manifest, inventory, {**budget, "deadline": deadline}, installed=installed)
        target.argument()
        require(reader.repository_id() == receipt["repositoryId"] and time.monotonic() <= deadline,
                "Restore repository identity or deadline changed")
        completed_at_ms = time.time_ns() // 1_000_000
        result = {"schemaVersion": 1, "kind": "warpdrive-independent-recovery-restore", "snapshotId": snapshot,
                  "receiptSha256": expected_receipt_sha256, "manifestSha256": receipt["manifestSha256"],
                  "verifiedBytes": inventory["bytes"], "verifiedEntries": len(inventory["entries"]),
                  "durationMs": int((time.monotonic() - started) * 1000), "isolatedRestoreBytesVerified": True,
                  "applicationRecoveryAccepted": False, "offHostAccepted": False, "keyCustodyAccepted": False,
                  "writerResumptionAuthorized": False}
        if installed:
            result.update(schemaVersion=2, kind="warpdrive-independent-installed-recovery-restore",
                          planSha256=receipt["planSha256"], scope=INSTALLED_SCOPE)
        if monitor_handoff is not None:
            try:
                raw = build_restore_handoff(result, installation_id=operations_installation_id,
                                            repository_id=receipt["repositoryId"], completed_at_ms=completed_at_ms)
            except SwitchConflict as error:
                raise RecoveryError("Restored evidence is outside the monitoring handoff contract") from error
            _publish_handoff(handoff_directory, handoff_path.name, raw)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("receipt", "receipt-sha256", "manifest", "original-manifest-member", "restic", "repository",
                 "readback-password-file", "restore-target", "limits"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--monitor-handoff")
    parser.add_argument("--operations-installation-id")
    args = parser.parse_args()
    try:
        _, budget = _private_document(absolute(args.limits))
        budget = limits(budget)
        reader = Restic(args.restic, args.repository, args.readback_password_file, seconds=budget["seconds"])
        result = restore_existing(args.receipt, expected_receipt_sha256=args.receipt_sha256, manifest_path=args.manifest,
                                  original_manifest_member=args.original_manifest_member, reader=reader,
                                  restore_target=args.restore_target, budget=budget, monitor_handoff=args.monitor_handoff,
                                  operations_installation_id=args.operations_installation_id)
    except (OSError, TypeError, ValueError, KeyError, RecoveryError) as error:
        parser.exit(1, f"Independent recovery restore held ({type(error).__name__}).\n")
    print(canonical(result).decode())


if __name__ == "__main__":
    main()
