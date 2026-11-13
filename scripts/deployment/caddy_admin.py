"""Whole-config Caddy compare-and-swap over an admitted Unix admin socket."""

from __future__ import annotations

from contextlib import contextmanager
from http.client import HTTPException, HTTPResponse
import io
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import struct
import sys
import time

from web_switch import DefiniteRejected, SwitchHeld, SwitchUnknown


_PATH = "/config/"
_ETAG = re.compile(r'"/config/ [0-9a-f]{16}"\Z')
_DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_MAX_CONFIG = 1024 * 1024
_MAX_WIRE = _MAX_CONFIG + 96 * 1024


def _require(condition, message):
    if not condition:
        raise SwitchHeld(message)


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink)


def _directory_identity(info):
    # Directory link count can change for unrelated protected files/directories.
    return _identity(info)[:-1]


def _peer_credentials(connection):
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def _process_start(pid):
    _require(sys.platform == "linux" and hasattr(socket, "SO_PEERCRED"), "Linux Caddy peer identity is required")
    with Path(f"/proc/{pid}/stat").open("rb") as source:
        raw = source.read(8193)
    pid_prefix, separator, rest = raw.rpartition(b") ")
    fields = rest.split()
    _require(len(raw) <= 8192 and bool(separator) and pid_prefix.startswith(f"{pid} (".encode())
             and len(fields) > 19 and fields[0] not in {b"Z", b"X"} and fields[19].isdigit(),
             "Caddy peer process generation is unavailable")
    return int(fields[19])


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Caddy admin request deadline exceeded")
    return remaining


class _WireReader(io.RawIOBase):
    def __init__(self, connection, deadline):
        self.connection = connection
        self.deadline = deadline
        self.remaining = _MAX_WIRE

    def readable(self):
        return True

    def readinto(self, buffer):
        self.connection.settimeout(_remaining(self.deadline))
        count = self.connection.recv_into(memoryview(buffer)[:self.remaining + 1])
        self.remaining -= count
        if self.remaining < 0:
            raise ValueError("Caddy admin response exceeds wire bound")
        return count


class _ResponseSocket:
    def __init__(self, connection, deadline):
        self.connection = connection
        self.deadline = deadline

    def makefile(self, _mode):
        return io.BufferedReader(_WireReader(self.connection, self.deadline))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate Caddy configuration property")
        result[key] = value
    return result


def _invalid_number(_value):
    raise ValueError("Non-finite Caddy configuration number")


def _document(value):
    _require(isinstance(value, dict), "Whole Caddy configuration object required")
    try:
        result = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        _require(0 < len(result) <= _MAX_CONFIG and json.loads(result, object_pairs_hook=_unique_object) == value,
                 "Bounded Caddy configuration object required")
        return result
    except (ValueError, TypeError, RecursionError):
        raise SwitchHeld("Invalid Caddy configuration object") from None


class CaddyAdmin:
    """Authenticate a socket and its Linux process before each fixed admin request.

    The bootstrap supplies independently observed host-side identities. It owns
    the socket directory and keeps one controller mutation authority per target.
    """

    def __init__(self, socket_path, *, socket_uid, socket_gid, socket_mode,
                 peer_pid, peer_uid, peer_gid, directory_uid=0, directory_mode=0o700, timeout=5.0):
        self.path = Path(socket_path)
        _require(self.path.anchor == "/" and ".." not in self.path.parts
                 and len(self.path.parts) > 2 and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", self.path.name),
                 "Canonical Caddy Unix socket path required")
        _require(all(type(value) is int and 0 <= value <= 2**31 - 1 for value in
                     (socket_uid, socket_gid, peer_pid, peer_uid, peer_gid, directory_uid))
                 and peer_pid > 0 and socket_uid == peer_uid and socket_gid == peer_gid
                 and directory_mode == 0o700 and socket_mode in {0o200, 0o600},
                 "Exact private Caddy socket and peer ownership required")
        _require(type(timeout) in {int, float} and math.isfinite(timeout) and 0 < timeout <= 20,
                 "Bounded Caddy admin timeout required")
        self.timeout = timeout
        self.peer = (peer_pid, peer_uid, peer_gid)
        self.directory_uid = directory_uid
        self.directory_mode = directory_mode
        self.socket_authority = (socket_uid, socket_gid, socket_mode)
        try:
            self.peer_start = _process_start(peer_pid)
            with self._open_directory() as directory:
                self.directory = _directory_identity(os.fstat(directory))
                self.socket = self._socket_identity(directory)
        except OSError:
            raise SwitchHeld("Caddy admin socket authority is unavailable") from None

    @contextmanager
    def _open_directory(self):
        descriptor = os.open("/", _DIRECTORY)
        try:
            for part in self.path.parent.parts[1:]:
                child = os.open(part, _DIRECTORY, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
                info = os.fstat(descriptor)
                mode = stat.S_IMODE(info.st_mode)
                _require(info.st_uid in {0, os.geteuid(), self.directory_uid}
                         and (not mode & 0o022 or (info.st_uid == 0 and bool(mode & stat.S_ISVTX))),
                         "Untrusted Caddy socket ancestor")
            info = os.fstat(descriptor)
            _require(info.st_uid == self.directory_uid and stat.S_IMODE(info.st_mode) == self.directory_mode,
                     "Exact private Caddy socket directory required")
            yield descriptor
        finally:
            os.close(descriptor)

    def _socket_identity(self, directory):
        info = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False)
        _require(stat.S_ISSOCK(info.st_mode) and info.st_nlink == 1
                 and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == self.socket_authority,
                 "Exact private Caddy socket required")
        return _identity(info)

    def _check_authority(self, directory):
        _require(_directory_identity(os.fstat(directory)) == self.directory and self._socket_identity(directory) == self.socket
                 and _process_start(self.peer[0]) == self.peer_start, "Caddy socket or process generation changed")

    def _exchange(self, method, body=None, etag=None):
        deadline = time.monotonic() + self.timeout
        sent = False
        try:
            with self._open_directory() as directory, socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                self._check_authority(directory)
                address = f"/proc/self/fd/{directory}/{self.path.name}" if sys.platform == "linux" else str(self.path)
                connection.settimeout(_remaining(deadline))
                connection.connect(address)
                _require(_peer_credentials(connection) == self.peer, "Caddy admin socket peer credentials differ")
                self._check_authority(directory)
                headers = [f"{method} {_PATH} HTTP/1.1", "Host: localhost", "Connection: close", "Accept: application/json",
                           "Accept-Encoding: identity"]
                if body is not None:
                    headers += ["Content-Type: application/json", f"Content-Length: {len(body)}", f"If-Match: {etag}"]
                request = ("\r\n".join(headers) + "\r\n\r\n").encode("ascii")
                connection.settimeout(_remaining(deadline))
                sent = True
                connection.sendall(request if body is None else request + body)
                with HTTPResponse(_ResponseSocket(connection, deadline), method=method) as response:
                    response.begin()
                    encoding = response.headers.get_all("Content-Encoding", [])
                    length = response.headers.get_all("Content-Length", [])
                    transfer = response.headers.get_all("Transfer-Encoding", [])
                    _require(encoding in ([], ["identity"]) and transfer in ([], ["chunked"])
                             and len(length) <= 1 and not (length and transfer)
                             and (not length or (re.fullmatch(r"[0-9]{1,8}", length[0]) and int(length[0]) <= _MAX_CONFIG)),
                             "Caddy admin response framing is unsupported")
                    payload = response.read(_MAX_CONFIG + 1)
                    _require(len(payload) <= _MAX_CONFIG and (not length or len(payload) == int(length[0])),
                             "Caddy admin response is incomplete or exceeds its bound")
                    status, headers = response.status, response.headers
                self._check_authority(directory)
                with self._open_directory() as visible:
                    self._check_authority(visible)
                _remaining(deadline)
        except (OSError, ValueError, HTTPException, SwitchHeld):
            if method == "PATCH" and sent:
                raise SwitchUnknown("Caddy PATCH outcome is unresolved") from None
            raise SwitchHeld("Caddy admin transport is unavailable") from None
        return status, headers, payload

    def config(self):
        """Read the complete config and one strong Caddy root-resource ETag."""
        status, headers, body = self._exchange("GET")
        etags = headers.get_all("ETag", [])
        _require(status == 200 and headers.get_all("Content-Type", []) == ["application/json"]
                 and len(etags) == 1 and _ETAG.fullmatch(etags[0]), "Caddy root config or strong ETag is unavailable")
        try:
            value = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_invalid_number)
        except (ValueError, RecursionError):
            raise SwitchHeld("Invalid Caddy root config response") from None
        _document(value)
        return value, etags[0]

    def _patch(self, body, etag):
        _require(isinstance(etag, str) and _ETAG.fullmatch(etag), "Strong Caddy root ETag required")
        status, _, payload = self._exchange("PATCH", body, etag)
        if status == 412:
            raise DefiniteRejected("Caddy rejected the stale root ETag")
        if status != 200 or payload:
            raise SwitchUnknown("Caddy PATCH outcome is unresolved")

    def compare_and_swap(self, expected_full_dict, desired_full_dict):
        """Submit one full JSON PATCH, then require exact readback."""
        expected = _document(expected_full_dict)
        desired = _document(desired_full_dict)
        old_admin = json.loads(expected).get("admin")
        new_admin = json.loads(desired).get("admin")
        _require(isinstance(old_admin, dict) and _document(old_admin) == _document(new_admin),
                 "Caddy admin configuration must be preserved")
        current, etag = self.config()
        if _document(current) != expected:
            raise DefiniteRejected("Current Caddy root config differs from the expected config")
        self._patch(desired, etag)
        try:
            current, observed_etag = self.config()
            _require(_document(current) == desired, "Caddy exact root config readback differs")
        except SwitchHeld:
            raise SwitchUnknown("Caddy PATCH readback is unresolved") from None
        return current, observed_etag
