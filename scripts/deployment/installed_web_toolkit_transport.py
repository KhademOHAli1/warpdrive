"""Move an exact reviewed installed Web toolkit over a preselected stdio channel.

Install this stdlib-only receiver from trusted bytes before using it remotely.
The manifest pin comes from the caller. Toolkit source is never executed here.
The output directory is a transport receipt, separate from mutable release state.
After an uncertain response, use readback on the same destination and pin.
"""

from __future__ import annotations

import argparse
import ast
from contextlib import contextmanager
import ctypes
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import select
import stat
import struct
import sys
import time


MAX_FILES = 96
MAX_MANIFEST = 64 * 1024
MAX_FILE = 512 * 1024
MAX_TOTAL = 8 * 1024 * 1024
IO_SECONDS = 30
MAGIC = b"warpdrive-installed-web-toolkit-v1\n"
MANIFEST_NAME = "manifest.json"
SOURCE_NAME = "source"
SHA = re.compile(r"[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
DESTINATION = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
MODULE = re.compile(r"scripts/deployment/[a-z0-9_-]{1,64}\.py\Z")
EXTRA = {"deploy/newsletters/engine/migration-tests/verify.py", "deploy/newsletters/engine/tests/consent.py",
         "scripts/delivery/release_gates.py", "scripts/delivery/release_security.py", "scripts/delivery/release_support.py"}
DEPLOYMENT = "scripts/deployment/"
STAGE_ACK = DEPLOYMENT + "installed_web_stage_ack.py"
FUNCTIONAL_OPERATOR = DEPLOYMENT + "installed_web_functional_operator.py"
CORE_OPERATOR = DEPLOYMENT + "installed_core_operator.py"
STAGE_FILES = {STAGE_ACK, DEPLOYMENT + "installed_web_stage.py", DEPLOYMENT + "installed_web_stage_readback.py"}
REQUIRED = STAGE_FILES | {DEPLOYMENT + "vps-functional-web-entry.py"}
MODERN_ENTRIES = {"functionalOperatorEntry": FUNCTIONAL_OPERATOR, "coreOperatorEntry": CORE_OPERATOR}
MODERN_REQUIRED = STAGE_FILES | set(MODERN_ENTRIES.values()) | EXTRA | {
    DEPLOYMENT + name + ".py" for name in ("installed_web_functional_lineage", "installed_core_activation",
                                         "installed_core_lineage", "installed_core_lineage_seal")
}
EXTERNAL_IMPORTS = {PurePosixPath(name).stem: name for name in EXTRA}
# Earlier private fixture manifests carry their own exact independent pin.
LEGACY_STAGE_ACK = "scripts/deployment/vps-functional-web-stage-ack.py"
RECEIPT_KEYS = {"kind", "version", "state", "destination", "manifestSha256", "sourceFiles", "sourceBytes", "deploymentAuthorized"}
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
NEW_FILE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
SIZE = struct.Struct("!I")


class TransportError(ValueError):
    """A source, manifest, channel or destination failed admission."""


class ReceiptUnknown(TransportError):
    """Publication may have taken effect. Read back the same destination."""


def require(value, reason):
    if not value:
        raise TransportError(reason)


def _unique(pairs):
    fields = {}
    for name, value in pairs:
        require(name not in fields, "Duplicate toolkit JSON key")
        fields[name] = value
    return fields


def _invalid_constant(_value):
    raise TransportError("Invalid toolkit JSON constant")


def _json(raw):
    return json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=_unique, parse_constant=_invalid_constant)


def _manifest(raw, expected):
    require(isinstance(expected, str) and SHA.fullmatch(expected), "Independent toolkit manifest SHA-256 required")
    require(0 < len(raw) <= MAX_MANIFEST and sha256(raw).hexdigest() == expected, "Toolkit manifest differs from its pin")
    document = _json(raw)
    entry = document.get("stageAcknowledgementEntry") if type(document) is dict else None
    require(type(document) is dict and document.get("kind") == "warpdrive-local-installed-web-toolkit-proposal"
            and type(document.get("version")) is int and document["version"] == 1
            and isinstance(document.get("repositoryHead"), str) and REVISION.fullmatch(document["repositoryHead"])
            and document.get("draft") is False and document.get("transferred") is False
            and document.get("deploymentAuthorized") is False
            and entry in (STAGE_ACK, LEGACY_STAGE_ACK),
            "Exact reviewed toolkit manifest required")
    pins = document.get("pins")
    modern = any(field in document for field in MODERN_ENTRIES)
    if modern:
        require(entry == STAGE_ACK and all(document.get(field) == path for field, path in MODERN_ENTRIES.items()),
                "Exact paired functional Web and Core toolkit entrypoints required")
    required = MODERN_REQUIRED if modern else (REQUIRED - {STAGE_ACK}) | {entry}
    require(type(pins) is dict and type(document.get("sourceFiles")) is int and required <= pins.keys()
            and len(pins) == document["sourceFiles"] <= MAX_FILES
            and all((MODULE.fullmatch(name) or name in EXTRA) and isinstance(pin, str) and SHA.fullmatch(pin)
                    for name, pin in pins.items()), "Exact bounded toolkit source pins required")
    if modern:
        reserved = sys.stdlib_module_names | EXTERNAL_IMPORTS.keys()
        require(all(not name.startswith(DEPLOYMENT) or PurePosixPath(name).stem not in reserved for name in pins),
                "Modern toolkit source shadows an interpreter or explicit dependency module")
    return pins, required if modern else ()


def _validate_closure(files, roots):
    """Verify the standalone import graph from pinned bytes without importing them."""
    visited, pending = set(), set(roots)
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        require(path in files, "Modern toolkit import dependency is missing from the pinned sources")
        visited.add(path)
        try:
            source = ast.parse(files[path], filename=path)
        except SyntaxError as error:
            raise TransportError("Modern toolkit dependency is not valid Python source") from error
        for node in ast.walk(source):
            if isinstance(node, ast.ImportFrom) and node.level:
                require(node.level == 1 and path.startswith(DEPLOYMENT), "Modern toolkit relative import escapes its module directory")
                imports = (node.module,) if node.module else tuple(alias.name for alias in node.names)
                for module in imports:
                    dependency = DEPLOYMENT + module + ".py"
                    require(MODULE.fullmatch(dependency), "Modern toolkit relative imports require standalone modules")
                    pending.add(dependency)
                continue
            if isinstance(node, ast.ImportFrom):
                imports = (node.module,)
            elif isinstance(node, ast.Import):
                imports = tuple(alias.name for alias in node.names)
            else:
                continue
            for imported in imports:
                module = imported.split(".")[0]
                if module not in sys.stdlib_module_names:
                    require(module == imported, "Modern toolkit dependencies must be standalone modules")
                    pending.add(EXTERNAL_IMPORTS.get(module, DEPLOYMENT + module + ".py"))


def _receipt(destination, expected, files):
    return {"kind": "warpdrive-installed-web-toolkit-transport", "version": 1, "state": "verified",
            "destination": destination, "manifestSha256": expected,
            "sourceFiles": len(files), "sourceBytes": sum(map(len, files.values())),
            "deploymentAuthorized": False}


def _receipt_bytes(receipt):
    return (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _read_receipt(raw, destination, expected):
    require(isinstance(expected, str) and SHA.fullmatch(expected), "Independent toolkit manifest SHA-256 required")
    require(isinstance(destination, str) and DESTINATION.fullmatch(destination), "Exact toolkit destination name required")
    document = _json(raw)
    require(type(document) is dict and set(document) == RECEIPT_KEYS
            and document["kind"] == "warpdrive-installed-web-toolkit-transport" and type(document["version"]) is int
            and document["version"] == 1 and document["state"] == "verified" and document["destination"] == destination
            and document["manifestSha256"] == expected
            and document["deploymentAuthorized"] is False
            and type(document["sourceFiles"]) is int and len(REQUIRED) <= document["sourceFiles"] <= MAX_FILES
            and type(document["sourceBytes"]) is int and document["sourceFiles"] <= document["sourceBytes"] <= MAX_TOTAL
            and raw == _receipt_bytes(document), "Exact toolkit receipt required")
    return document


def _mode(info, expected):
    return info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == expected


def _witness(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink


def _private_directory(fd):
    info = os.fstat(fd)
    require(stat.S_ISDIR(info.st_mode) and _mode(info, 0o700), "Owned mode 0700 toolkit directory required")
    return info


@contextmanager
def _open_directory(path):
    require(path.is_absolute() and path != Path(path.anchor) and ".." not in path.parts, "Absolute toolkit directory required")
    fd = os.open(path.anchor, DIR_FLAGS)
    try:
        for part in path.parts[1:]:
            child = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        before = _private_directory(fd)
        yield fd
        after = path.lstat()
        require(os.path.samestat(before, after) and _mode(after, 0o700), "Toolkit directory identity changed")
    finally:
        os.close(fd)


@contextmanager
def _child_directory(parent, name):
    fd = os.open(name, DIR_FLAGS, dir_fd=parent)
    try:
        before = _private_directory(fd)
        yield fd
        require(_witness(before) == _witness(os.fstat(fd)) == _witness(os.stat(name, dir_fd=parent, follow_symlinks=False)),
                "Toolkit directory changed during readback")
    finally:
        os.close(fd)


def _private_bytes(parent, name, maximum):
    with os.fdopen(os.open(name, READ_FLAGS, dir_fd=parent), "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and (_mode(before, 0o400) or _mode(before, 0o600))
                and 0 < before.st_size <= maximum, "Owned bounded single-link toolkit file required")
        raw = source.read(before.st_size + 1)
        named = os.stat(name, dir_fd=parent, follow_symlinks=False)
        require(len(raw) == before.st_size and _witness(before) == _witness(os.fstat(source.fileno())) == _witness(named),
                "Toolkit file changed during readback")
    return raw


def _tree(pins):
    tree = {}
    for name, digest in sorted(pins.items()):
        parts = PurePosixPath(name).parts
        directory = tree
        for part in parts[:-1]:
            directory = directory.setdefault(part, {})
        directory[parts[-1]] = (name, digest)
    return tree


def _exact_names(fd, expected):
    with os.scandir(fd) as names:
        found = set()
        for index, item in enumerate(names):
            require(index < len(expected) and item.name in expected, "Toolkit source inventory differs from the manifest")
            found.add(item.name)
    require(found == set(expected), "Toolkit source inventory differs from the manifest")


def _read_tree(fd, tree, files, total=0):
    _exact_names(fd, tree)
    for name, item in tree.items():
        if isinstance(item, dict):
            with _child_directory(fd, name) as child:
                total = _read_tree(child, item, files, total)
        else:
            relative, digest = item
            raw = _private_bytes(fd, name, min(MAX_FILE, MAX_TOTAL - total))
            total += len(raw)
            require(sha256(raw).hexdigest() == digest, "Toolkit source differs from its pin")
            files[relative] = raw
    return total


def _source(source, manifest, expected):
    with _open_directory(manifest.parent) as parent:
        raw = _private_bytes(parent, manifest.name, MAX_MANIFEST)
        pins, roots = _manifest(raw, expected)
    files = {}
    with _open_directory(source) as directory:
        before = _witness(os.fstat(directory))
        _read_tree(directory, _tree(pins), files)
        require(before == _witness(os.fstat(directory)), "Toolkit source directory changed")
    _validate_closure(files, roots)
    return raw, files


def _ready(poller, deadline):
    remaining = deadline - time.monotonic()
    require(remaining > 0, "Toolkit transport deadline exceeded")
    require(poller.poll(max(1, int(remaining * 1000))), "Toolkit transport deadline exceeded")


def _read(fd, count, deadline):
    raw = bytearray()
    poller = select.poll()
    poller.register(fd, select.POLLIN)
    while len(raw) < count:
        _ready(poller, deadline)
        data = os.read(fd, min(count - len(raw), 64 * 1024))
        require(data, "Truncated toolkit transport")
        raw.extend(data)
    return bytes(raw)


def _write(fd, raw, deadline):
    view = memoryview(raw)
    poller = select.poll()
    poller.register(fd, select.POLLOUT)
    blocking = os.get_blocking(fd)
    os.set_blocking(fd, False)
    try:
        while view:
            _ready(poller, deadline)
            try:
                written = os.write(fd, view[:64 * 1024])
            except BlockingIOError:
                continue
            require(written > 0, "Incomplete toolkit transport write")
            view = view[written:]
    finally:
        os.set_blocking(fd, blocking)


def _write_frame(fd, raw, deadline):
    _write(fd, SIZE.pack(len(raw)), deadline)
    _write(fd, raw, deadline)


def _read_frame(fd, maximum, deadline):
    length, = SIZE.unpack(_read(fd, SIZE.size, deadline))
    require(0 < length <= maximum, "Toolkit frame exceeds its byte bound")
    return _read(fd, length, deadline)


def _read_to_eof(fd, maximum, deadline):
    raw = bytearray()
    poller = select.poll()
    poller.register(fd, select.POLLIN)
    while len(raw) <= maximum:
        _ready(poller, deadline)
        data = os.read(fd, maximum + 1 - len(raw))
        if not data:
            return raw
        raw.extend(data)
    raise TransportError("Unexpected bytes beyond the toolkit transport bound")


def _receive_frames(fd, expected):
    deadline = time.monotonic() + IO_SECONDS
    require(_read(fd, len(MAGIC), deadline) == MAGIC, "Unknown toolkit transport protocol")
    raw = _read_frame(fd, MAX_MANIFEST, deadline)
    pins, roots = _manifest(raw, expected)
    files, total = {}, 0
    for name, digest in sorted(pins.items()):
        value = _read_frame(fd, min(MAX_FILE, MAX_TOTAL - total), deadline)
        total += len(value)
        require(sha256(value).hexdigest() == digest, "Received toolkit source differs from its pin")
        files[name] = value
    _read_to_eof(fd, 0, deadline)
    _validate_closure(files, roots)
    return raw, files


def send(source, manifest, expected, output):
    """Write the exact source snapshot to stdout. The caller owns channel closure."""
    raw, files = _source(source, manifest, expected)
    deadline = time.monotonic() + IO_SECONDS
    _write(output, MAGIC, deadline)
    _write_frame(output, raw, deadline)
    for name in sorted(files):
        _write_frame(output, files[name], deadline)


def _write_private(fd, name, raw):
    with os.fdopen(os.open(name, NEW_FILE_FLAGS, 0o600, dir_fd=fd), "wb") as output:
        os.fchmod(output.fileno(), 0o600)
        require(output.write(raw) == len(raw), "Incomplete private toolkit file write")
        output.flush()
        os.fsync(output.fileno())


@contextmanager
def _new_directory(parent, name):
    os.mkdir(name, mode=0o700, dir_fd=parent)
    fd = os.open(name, DIR_FLAGS, dir_fd=parent)
    try:
        os.fchmod(fd, 0o700)
        yield fd
    finally:
        os.close(fd)


def _write_tree(fd, tree, files):
    for name, item in tree.items():
        if isinstance(item, dict):
            with _new_directory(fd, name) as child:
                _write_tree(child, item, files)
        else:
            _write_private(fd, name, files[item[0]])
    os.fsync(fd)


def _rename_noreplace(parent, temporary, final):
    # Standalone bootstrap equivalent of the installed stage receipt's
    # exclusive rename. A regular rename can replace an unrelated directory.
    library = ctypes.CDLL(None, use_errno=True)
    platforms = {"linux": ("renameat2", 1), "darwin": ("renameatx_np", 0x4)}
    require(sys.platform in platforms, "Exclusive toolkit publication is unavailable on this platform")
    symbol, flags = platforms[sys.platform]
    rename = getattr(library, symbol, None)
    require(rename is not None, "Exclusive toolkit publication is unavailable in libc")
    rename.argtypes = ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint
    rename.restype = ctypes.c_int
    if rename(parent, os.fsencode(temporary), parent, os.fsencode(final), flags) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _remove_owned_tree(parent, name, expected):
    fd = os.open(name, DIR_FLAGS, dir_fd=parent)
    try:
        info = os.fstat(fd)
        require(os.path.samestat(info, expected) and info.st_uid == os.geteuid(), "Toolkit scratch identity changed")
        for child in os.listdir(fd):
            child_info = os.stat(child, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(child_info.st_mode):
                _remove_owned_tree(fd, child, child_info)
            else:
                os.unlink(child, dir_fd=fd)
    finally:
        os.close(fd)
    require(os.path.samestat(info, os.stat(name, dir_fd=parent, follow_symlinks=False)), "Toolkit scratch identity changed")
    os.rmdir(name, dir_fd=parent)


def _destination(path):
    require(DESTINATION.fullmatch(path.name), "Exact toolkit destination name required")


def _same_parent(fd, path):
    require(os.path.samestat(_private_directory(fd), path.lstat()), "Toolkit destination parent changed")


def _received(fd, expected):
    _exact_names(fd, {MANIFEST_NAME, SOURCE_NAME})
    raw = _private_bytes(fd, MANIFEST_NAME, MAX_MANIFEST)
    pins, roots = _manifest(raw, expected)
    files = {}
    with _child_directory(fd, SOURCE_NAME) as source:
        _read_tree(source, _tree(pins), files)
    _validate_closure(files, roots)
    return raw, files


def _publish(destination, raw, files, expected):
    published = False
    try:
        with _open_directory(destination.parent) as parent:
            fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                os.stat(destination.name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise TransportError("Toolkit destination already exists. Read back the same operation")
            temporary = ".wd-toolkit-" + secrets.token_hex(12)
            with _new_directory(parent, temporary) as stage:
                owned = os.fstat(stage)
                try:
                    _write_private(stage, MANIFEST_NAME, raw)
                    with _new_directory(stage, SOURCE_NAME) as source:
                        pins, _ = _manifest(raw, expected)
                        _write_tree(source, _tree(pins), files)
                    os.fsync(stage)
                    require(_received(stage, expected) == (raw, files), "Written toolkit differs from its admitted bytes")
                    _same_parent(parent, destination.parent)
                    _rename_noreplace(parent, temporary, destination.name)
                    published = True
                    os.fsync(parent)
                    _same_parent(parent, destination.parent)
                    require(os.path.samestat(owned, os.stat(destination.name, dir_fd=parent, follow_symlinks=False)),
                            "Published toolkit directory identity changed")
                finally:
                    if not published:
                        _remove_owned_tree(parent, temporary, owned)
                        os.fsync(parent)
    except (OSError, TransportError) as error:
        if published:
            raise ReceiptUnknown("Toolkit publication response unavailable. Read back the same operation") from error
        raise
    return _receipt(destination.name, expected, files)


def receive(destination, expected, input_fd):
    """Read, verify and atomically publish one fresh destination."""
    _destination(destination)
    raw, files = _receive_frames(input_fd, expected)
    return _publish(destination, raw, files, expected)


def readback(destination, expected):
    """Observe the exact committed transport after a lost response."""
    _destination(destination)
    with _open_directory(destination.parent) as parent:
        fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with _child_directory(parent, destination.name) as directory:
            _, files = _received(directory, expected)
            # Recover a prior rename that became visible before the directory sync.
            os.fsync(parent)
    return _receipt(destination.name, expected, files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    sender = commands.add_parser("send", help="Write the exact pinned toolkit to stdout")
    sender.add_argument("--source", type=Path, required=True)
    sender.add_argument("--manifest", type=Path, required=True)
    receiver = commands.add_parser("receive", help="Read stdin and publish one private toolkit directory")
    observation = commands.add_parser("readback", help="Verify the same directory after an uncertain response")
    receipt = commands.add_parser("verify-receipt", help="Check a bounded transport receipt against its expected manifest")
    for command in (receiver, observation):
        command.add_argument("--destination", type=Path, required=True)
    receipt.add_argument("--destination-name", required=True)
    for command in (sender, receiver, observation, receipt):
        command.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        expected = args.manifest_sha256
        if args.action == "send":
            send(args.source, args.manifest, expected, sys.stdout.fileno())
        else:
            if args.action == "receive":
                result = receive(args.destination, expected, sys.stdin.fileno())
            elif args.action == "readback":
                result = readback(args.destination, expected)
            else:
                deadline = time.monotonic() + IO_SECONDS
                value = _read_to_eof(sys.stdin.fileno(), 512, deadline)
                result = _read_receipt(value, args.destination_name, expected)
            try:
                _write(sys.stdout.fileno(), _receipt_bytes(result), time.monotonic() + IO_SECONDS)
            except (OSError, TransportError) as error:
                if args.action == "receive":
                    raise ReceiptUnknown("Toolkit receipt unavailable. Read back the same operation") from error
                raise
        return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
        print(json.dumps({"state": "unknown" if isinstance(error, ReceiptUnknown) else "held",
                          "errorType": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
