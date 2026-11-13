"""Bounded native Docker Engine Unix transport for secret-safe container operations."""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat

from component_inputs import decode


API = "/v1.52"
MAX_RESPONSE = 4 * 1024**2
ID = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,62}\Z")


class DockerNativeError(RuntimeError):
    """An installed Docker request failed or cannot be resolved from readback."""


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("localhost", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class InstalledDocker:
    """Pass selected request data only over the owner-pinned local socket."""

    def __init__(self, *, expected_socket, path=Path("/run/docker.sock")):
        self.path = path
        self.expected_socket = expected_socket
        self.verify_socket()

    def verify_socket(self):
        info = self.path.lstat()
        if not (self.path.is_absolute() and self.path == self.path.resolve(strict=True) and stat.S_ISSOCK(info.st_mode)
                and info.st_uid == 0 and (info.st_dev, info.st_ino) == self.expected_socket):
            raise DockerNativeError("Installed Docker socket differs from its independent identity")

    def request(self, method, path, *, value=None, accepted=(200,)):
        if os.geteuid() != 0 or not path.startswith("/") or "//" in path or any(ch in path for ch in ("\r", "\n")):
            raise DockerNativeError("Native root Docker operation required")
        self.verify_socket()
        conn = UnixHTTP(str(self.path), 10)
        try:
            body = None if value is None else json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
            if body is not None and len(body) > 128 * 1024:
                raise DockerNativeError("Docker operation body exceeds its bound")
            conn.request(method, API + path, body=body, headers={"Content-Type": "application/json", "Connection": "close"})
            response = conn.getresponse()
            payload = response.read(MAX_RESPONSE + 1)
            status = response.status
        except (OSError, ValueError, http.client.HTTPException) as error:
            raise DockerNativeError("Docker operation has no authenticated response") from error
        finally:
            conn.close()
        self.verify_socket()
        if status not in accepted or len(payload) > MAX_RESPONSE:
            raise DockerNativeError(f"Docker operation returned an unexpected status or size ({status})")
        return decode(payload) if payload else None

    def inspect(self, identifier):
        if not ID.fullmatch(identifier) and not NAME.fullmatch(identifier):
            raise DockerNativeError("Exact Docker container identifier required")
        return self.request("GET", f"/containers/{identifier}/json")

    def network(self, identifier):
        if not ID.fullmatch(identifier):
            raise DockerNativeError("Exact Docker network ID required")
        return self.request("GET", f"/networks/{identifier}")

    def create(self, name, document):
        if not NAME.fullmatch(name):
            raise DockerNativeError("Exact owned container name required")
        response = self.request("POST", f"/containers/create?name={name}", value=document, accepted=(201,))
        if not ID.fullmatch(response.get("Id", "")) or response.get("Warnings") not in (None, []):
            raise DockerNativeError("Docker create returned an unexpected response")
        return response["Id"]

    def start(self, identifier):
        if not ID.fullmatch(identifier):
            raise DockerNativeError("Exact Docker container ID required")
        self.request("POST", f"/containers/{identifier}/start", accepted=(204,))

    def stop(self, identifier):
        if not ID.fullmatch(identifier):
            raise DockerNativeError("Exact Docker container ID required")
        self.request("POST", f"/containers/{identifier}/stop?t=20", accepted=(204,))

    def remove_stopped(self, identifier):
        if not ID.fullmatch(identifier):
            raise DockerNativeError("Exact Docker container ID required")
        self.request("DELETE", f"/containers/{identifier}?v=false&force=false", accepted=(204,))
