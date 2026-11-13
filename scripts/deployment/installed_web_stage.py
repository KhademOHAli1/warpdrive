"""Journal and read back an already-qualified private installed Web runtime."""
from __future__ import annotations

from contextlib import contextmanager
import ctypes
import errno
import fcntl
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import time

from component_inputs import decode
from installed_docker import DockerNativeError
from installed_web_runtime import require
from web_switch import content_hash


MAX_RECORD_BYTES = 256 * 1024
OWNER_UID = 0


def _publish_record(directory, temporary, name):
    # A no-replace rename publishes one durable inode. A link/unlink pair
    # could leave the final receipt with two links if the writer stops.
    library = ctypes.CDLL(None, use_errno=True)
    try:
        if sys.platform == "linux":
            rename = library.renameat2
            flags = 1  # RENAME_NOREPLACE
        elif sys.platform == "darwin":
            rename = library.renameatx_np
            flags = 0x4  # RENAME_EXCL
        else:
            raise AttributeError
    except AttributeError:
        raise OSError(errno.ENOTSUP, "Atomic no-replace stage receipt publication is unavailable") from None
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(directory, os.fsencode(temporary), directory, os.fsencode(name), flags) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), name)


def write_record(path, value):
    raw = (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    require(len(raw) <= MAX_RECORD_BYTES, "Stage receipt exceeds its byte bound")
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = ".web-stage-" + secrets.token_hex(12)
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                if stream.write(raw) != len(raw):
                    raise OSError(errno.EIO, "Incomplete stage receipt write")
                stream.flush()
                os.fsync(stream.fileno())
                require(os.fstat(stream.fileno()).st_nlink == 1, "Stage receipt acquired another link")
            _publish_record(directory, temporary, path.name)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory)


def read_record(path):
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        with os.fdopen(os.open(path.name, flags, dir_fd=directory), "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and (info.st_uid, stat.S_IMODE(info.st_mode), info.st_nlink) == (OWNER_UID, 0o600, 1)
                    and 0 < info.st_size <= MAX_RECORD_BYTES, "Private bounded stage receipt required")
            raw = stream.read(info.st_size + 1)
            after = os.fstat(stream.fileno())
            require(len(raw) == info.st_size and os.path.samestat(info, path.lstat())
                    and (info.st_mtime_ns, info.st_ctime_ns) == (after.st_mtime_ns, after.st_ctime_ns),
                    "Stage receipt changed during read")
        result = decode(raw)
        # A prior writer may have stopped after rename and before the directory
        # sync. Establish durability before acknowledging observed evidence.
        os.fsync(directory)
        return result
    finally:
        os.close(directory)


@contextmanager
def exclusive(directory):
    info = directory.lstat()
    require(directory.is_absolute() and directory == directory.resolve(strict=True)
            and stat.S_ISDIR(info.st_mode) and info.st_uid == OWNER_UID and stat.S_IMODE(info.st_mode) == 0o700,
            "Exact root-owned stage directory required")
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.path.samestat(info, os.fstat(fd)), "Stage directory changed")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def start_private(docker, *, operation, alias, document, qualification, verify_created, ready, timeout=35):
    """Issue one create and one start at most. Re-enter for readback only after uncertainty."""
    require(isinstance(operation, Path) and type(timeout) is int and 0 < timeout <= 65,
            "Bounded private runtime stage required")
    binding = {"kind": "warpdrive-private-web-stage", "alias": alias,
               "configSha256": content_hash(document), "qualificationSha256": content_hash(qualification)}
    intent = operation / "stage-intent.json"
    created = operation / "stage-created.json"
    accepted = operation / "stage-ready.json"
    with exclusive(operation):
        if not os.path.lexists(intent):
            require(not os.path.lexists(created) and not os.path.lexists(accepted), "Unjournaled runtime receipts")
            write_record(intent, binding)
            identifier = docker.create(alias, document)
            write_record(created, {**binding, "id": identifier})
            row = docker.inspect(identifier)
            require(row["Id"] == identifier and row["Name"] == "/" + alias and row["State"]["Status"] == "created"
                    and row["State"]["Running"] is False and verify_created(row) is True,
                    "Created private runtime differs from its admitted configuration")
            docker.start(identifier)
        else:
            require(read_record(intent) == binding, "Existing runtime intent differs from the selected stage")
            # A lost create acknowledgment can only be resolved through the exact
            # owned alias. A found-but-stopped slot is never started on recovery.
            if os.path.lexists(created):
                evidence = read_record(created)
                require({k: v for k, v in evidence.items() if k != "id"} == binding,
                        "Created runtime receipt differs from intent")
                identifier = evidence["id"]
            else:
                row = docker.inspect(alias)
                identifier = row["Id"]
        deadline = time.monotonic() + timeout
        while True:
            row = docker.inspect(identifier)
            require(row["Id"] == identifier and row["Name"] == "/" + alias, "Runtime identity differs from durable intent")
            if row["State"]["Status"] in ("exited", "dead", "created"):
                raise DockerNativeError("Private runtime is not running and needs observation")
            observed = ready(row)
            if observed is not None:
                result = {**binding, "id": identifier, "runtime": observed}
                if os.path.lexists(accepted):
                    require(read_record(accepted) == result, "Accepted private runtime changed after stage")
                else:
                    write_record(accepted, result)
                return result
            if time.monotonic() >= deadline:
                raise DockerNativeError("Private runtime readiness is unresolved")
            time.sleep(0.4)
