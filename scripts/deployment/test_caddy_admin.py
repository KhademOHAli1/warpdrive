"""Exercise bounded admin HTTP over an owned Unix socket and native Caddy."""

from contextlib import contextmanager
from copy import deepcopy
from email.message import Message
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import caddy_admin as admin
from web_switch import DefiniteRejected, SwitchHeld, SwitchUnknown


ROOT_TAG = '"/config/ 0123456789abcdef"'
CADDY = shutil.which("caddy")
LINUX_PEER = sys.platform == "linux" and hasattr(socket, "SO_PEERCRED")


def address(path, pid, **overrides):
    settings = {"socket_uid": os.geteuid(), "socket_gid": os.getegid(), "socket_mode": 0o600,
                "directory_uid": os.geteuid(), "peer_pid": pid, "peer_uid": os.geteuid(), "peer_gid": os.getegid(),
                "timeout": 0.5}
    return admin.CaddyAdmin(path, **(settings | overrides))


@contextmanager
def local_peer(pid):
    if LINUX_PEER:
        yield
    else:
        with patch.object(admin, "_process_start", return_value=777), patch.object(
            admin, "_peer_credentials", return_value=(pid, os.geteuid(), os.getegid()),
        ):
            yield


def await_config(client):
    deadline = time.monotonic() + 2
    while True:
        try:
            return client.config()
        except SwitchHeld:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.02)


def headers(*entries):
    result = Message()
    for key, value in entries:
        result.add_header(key, value)
    return result


class SocketTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wd-caddy-", dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / "a.sock"
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(self.listener.close)
        self.listener.settimeout(2)
        self.listener.bind(str(self.path))
        self.path.chmod(0o600)
        self.listener.listen()
        self.expected = {"admin": {"listen": "unix//fixture"}, "test": "before"}
        self.desired = {**self.expected, "test": "after"}
        self.requests = []
        self.errors = []

    def server(self, *replies):
        def run():
            try:
                for reply in replies:
                    connection, _ = self.listener.accept()
                    with connection:
                        connection.settimeout(1)
                        request = bytearray()
                        while b"\r\n\r\n" not in request:
                            chunk = connection.recv(4096)
                            if not chunk:
                                return
                            request.extend(chunk)
                        head, body = bytes(request).split(b"\r\n\r\n", 1)
                        size = next((int(line.split(b": ", 1)[1]) for line in head.splitlines()
                                     if line.startswith(b"Content-Length: ")), 0)
                        while len(body) < size:
                            chunk = connection.recv(4096)
                            if not chunk:
                                return
                            body += chunk
                        self.requests.append((head, body))
                        if callable(reply):
                            reply(connection)
                        elif reply is not None:
                            connection.sendall(reply)
            except OSError as error:
                self.errors.append(error)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2.2)
        return thread

    def config_reply(self, value, tag=ROOT_TAG):
        raw = json.dumps(value).encode()
        tag_header = b"" if tag is None else f"ETag: {tag}\r\n".encode()
        return (b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n" + tag_header
                + f"Content-Length: {len(raw)}\r\n\r\n".encode() + raw)

    def test_strong_root_get_one_patch_and_exact_readback(self):
        final_etag = '"/config/ 1111111111111111"'
        thread = self.server(self.config_reply(self.expected), b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
                             self.config_reply(self.desired, final_etag))
        with local_peer(os.getpid()):
            client = address(self.path, os.getpid())
            self.assertEqual(client.compare_and_swap(self.expected, self.desired), (self.desired, final_etag))
        thread.join(1)
        self.assertEqual(self.errors, [])
        self.assertEqual([head.splitlines()[0] for head, _ in self.requests],
                         [b"GET /config/ HTTP/1.1", b"PATCH /config/ HTTP/1.1", b"GET /config/ HTTP/1.1"])
        self.assertIn(b"If-Match: " + ROOT_TAG.encode(), self.requests[1][0])
        self.assertEqual(json.loads(self.requests[1][1]), self.desired)

    def test_genuine_412_is_definite_without_replay(self):
        thread = self.server(self.config_reply(self.expected), b"HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\n\r\n")
        with local_peer(os.getpid()):
            with self.assertRaises(DefiniteRejected):
                address(self.path, os.getpid()).compare_and_swap(self.expected, self.desired)
        thread.join(1)
        self.assertEqual(len(self.requests), 2)

    def test_dropped_patch_response_is_unknown_and_not_retried(self):
        thread = self.server(self.config_reply(self.expected), None)
        with local_peer(os.getpid()):
            with self.assertRaises(SwitchUnknown) as error:
                address(self.path, os.getpid()).compare_and_swap(self.expected, self.desired)
        self.assertNotIsInstance(error.exception, DefiniteRejected)
        thread.join(1)
        self.assertEqual(len(self.requests), 2)

    def test_ack_with_foreign_readback_is_unknown(self):
        thread = self.server(self.config_reply(self.expected), b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
                             self.config_reply({**self.expected, "test": "foreign"}))
        with local_peer(os.getpid()):
            with self.assertRaisesRegex(SwitchUnknown, "readback is unresolved"):
                address(self.path, os.getpid()).compare_and_swap(self.expected, self.desired)
        thread.join(1)
        self.assertEqual(len(self.requests), 3)

    def test_no_valid_etag_means_no_patch(self):
        invalid = [None, 'W/"/config/ 0123456789abcdef"', '"/config/apps abcdef0123456789"', '*']
        thread = self.server(*(self.config_reply(self.expected, tag) for tag in invalid))
        with local_peer(os.getpid()):
            client = address(self.path, os.getpid())
            for tag in invalid:
                with self.subTest(tag=tag), self.assertRaises(SwitchHeld):
                    client.compare_and_swap(self.expected, self.desired)
        thread.join(1)
        self.assertEqual(len(self.requests), len(invalid))
        self.assertTrue(all(head.startswith(b"GET ") for head, _ in self.requests))

    def test_deadline_bounds_slow_byte_response(self):
        def drip(connection):
            for byte in self.config_reply(self.expected):
                connection.sendall(bytes([byte]))
                time.sleep(0.01)

        thread = self.server(drip)
        started = time.monotonic()
        with local_peer(os.getpid()):
            with self.assertRaises(SwitchHeld):
                address(self.path, os.getpid(), timeout=0.12).config()
        self.assertLess(time.monotonic() - started, 0.9)
        thread.join(1)

    def test_replacement_wrong_mode_symlink_and_peer_refuse_before_http(self):
        with local_peer(os.getpid()):
            client = address(self.path, os.getpid())
            self.path.chmod(0o666)
            with self.assertRaises(SwitchHeld):
                client.config()
            self.path.chmod(0o600)
            sibling = self.root / "symlink.sock"
            sibling.symlink_to(self.path)
            with self.assertRaises(SwitchHeld):
                address(sibling, os.getpid())
            with patch.object(admin, "_peer_credentials", return_value=(os.getpid() + 1, os.geteuid(), os.getegid())):
                with self.assertRaises(SwitchHeld):
                    client.config()
            connection, _ = self.listener.accept()
            with connection:
                self.assertEqual(connection.recv(1), b"")
            self.path.unlink()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as substitute:
                substitute.bind(str(self.path))
                self.path.chmod(0o600)
                substitute.listen()
                with self.assertRaises(SwitchHeld):
                    client.config()

    def test_non_json_duplicate_members_and_conflicting_response_framing_refused(self):
        invalid = [
            b'Content-Length: 13\r\n\r\n{"a":1,"a":2}',
            b'Content-Length: 12\r\n\r\n{"a":1e9999}',
            b'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}',
            b'Content-Length: 99999999\r\n\r\n{}',
            b'Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}',
        ]
        preface = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: {ROOT_TAG}\r\nConnection: close\r\n".encode()
        thread = self.server(*(preface + raw for raw in invalid))
        with local_peer(os.getpid()):
            client = address(self.path, os.getpid())
            for raw in invalid:
                with self.subTest(raw=raw), self.assertRaises(SwitchHeld):
                    client.config()
        thread.join(1)
        self.assertEqual(len(self.requests), len(invalid))

    def test_cannot_change_admin_section_or_patch_after_expected_mismatch(self):
        thread = self.server(self.config_reply(self.expected))
        with local_peer(os.getpid()):
            client = address(self.path, os.getpid())
            with self.assertRaises(SwitchHeld):
                client.compare_and_swap(self.expected, {"admin": {"listen": "127.0.0.1:1"}})
            with self.assertRaises(DefiniteRejected):
                client.compare_and_swap({**self.expected, "test": "different"}, self.desired)
        thread.join(1)
        self.assertEqual(len(self.requests), 1)


@unittest.skipUnless(CADDY, "native Caddy executable unavailable")
class NativeCaddyTests(unittest.TestCase):
    def test_native_unix_root_etag_unchanged_reload_and_stale_refusal(self):
        with tempfile.TemporaryDirectory(prefix="wd-caddy-", dir=Path(tempfile.gettempdir()).resolve()) as directory:
            root = Path(directory)
            path = root / "a.sock"
            config_file = root / "caddy.json"
            before = {"admin": {"listen": f"unix/{path}|0600", "config": {"persist": False}},
                      "logging": {"logs": {"default": {"level": "ERROR"}}}}
            config_file.write_text(json.dumps(before))
            process = subprocess.Popen([CADDY, "run", "--config", str(config_file)],
                                       env={"PATH": os.defpath, "XDG_CONFIG_HOME": str(root), "XDG_DATA_HOME": str(root)},
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not path.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(path.is_socket(), "native Caddy did not open its owned socket")
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                inode = path.stat().st_ino
                with local_peer(process.pid):
                    client = address(path, process.pid, timeout=3)
                    before_read, tag = await_config(client)
                    self.assertEqual(before_read, before)
                    self.assertEqual(client.compare_and_swap(before, before), (before, tag))
                    desired = deepcopy(before)
                    desired["logging"]["logs"]["default"]["level"] = "WARN"
                    try:
                        self.assertEqual(client.compare_and_swap(before, desired)[0], desired)
                    except SwitchUnknown:
                        # An admin listener handover can close the readback
                        # connection. Observe the result without replaying PATCH.
                        self.assertEqual(await_config(client)[0], desired)
                    self.assertNotEqual(client.config()[1], tag)
                    self.assertEqual(path.stat().st_ino, inode)
                    with self.assertRaises(DefiniteRejected):
                        client._patch(admin._document(before), tag)
                    self.assertEqual(client.config()[0], desired)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=4)


if __name__ == "__main__":
    unittest.main()
