"""Exact configuration and native Caddy request routing tests."""

from copy import deepcopy
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

from caddy_web_config import ADMIN_SOCKET, PROBE_REQUEST_HEADER, PROBE_RESPONSE_HEADER, compile_successor_web_configs
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes


A = WebGeneration("wd-" + "a" * 40, "app")
B = WebGeneration("wd-" + "b" * 40, "warpdrive-web-candidate")
HOST = "crm.example.invalid"
PEER = "127.0.0.1"
OLD = "warpdrive-web-relay-" + "a" * 12
NEW = "warpdrive-web-relay-" + "b" * 12
CADDY = shutil.which("caddy")


def server(document):
    return document["apps"]["http"]["servers"]["web-relay"]


def handler(document):
    return server(document)["routes"][0]["handle"][0]


def installed():
    return _caddy_config(HOST, PEER + "/32", compile_web_generation_routes(current=A))


def compile_configs(raw=None, **overrides):
    raw = json.dumps(installed(), indent=2).encode() if raw is None else raw
    arguments = {"expected_sha256": hashlib.sha256(raw).hexdigest(), "host": HOST, "traefik_ip": PEER,
                 "installed_relay_alias": OLD, "successor_relay_alias": NEW, "current": A, "candidate": B}
    return compile_successor_web_configs(raw, **(arguments | overrides))


class CompilerTests(unittest.TestCase):
    def test_a_preserves_baseline_and_b_replaces_only_generation_handlers(self):
        result = compile_configs()
        a, b = deepcopy(result["successorA"]), deepcopy(result["successorB"])
        self.assertEqual(a["admin"], {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}})
        self.assertEqual(b["admin"], a["admin"])
        self.assertEqual(handler(a)["routes"][0], handler(b)["routes"][0])
        marker = handler(a)["routes"].pop(0)
        self.assertEqual(set(marker), {"match", "handle"})
        self.assertEqual(marker["handle"], [{"handler": "headers", "response": {
            "deferred": True, "set": {PROBE_RESPONSE_HEADER: [NEW]},
        }}])
        a["admin"] = {"disabled": True}
        self.assertEqual(a, installed())
        expected_b = _caddy_config(HOST, PEER + "/32", compile_web_generation_routes(current=B, previous=A))
        handler(b)["routes"].pop(0)
        b["admin"] = {"disabled": True}
        self.assertEqual(b, expected_b)

    def test_digest_origin_bindings_and_unknown_changes_refuse(self):
        for override in ({"expected_sha256": "0" * 64}, {"traefik_ip": "127.0.0.2"}, {"host": "other.example.invalid"},
                         {"successor_relay_alias": OLD}, {"successor_relay_alias": "not-an-owned-relay"},
                         {"admin_socket": "/tmp/another.sock"}, {"candidate": A},
                         {"current": WebGeneration(A.deployment_id, "different-app")},
                         {"candidate": WebGeneration(B.deployment_id, NEW)}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                compile_configs(**override)
        for change in (lambda x: x.update(admin={"listen": ":2019"}),
                       lambda x: server(x)["trusted_proxies"].update(ranges=["0.0.0.0/0"]),
                       lambda x: server(x)["routes"][1].update(terminal=1),
                       lambda x: handler(x)["routes"].pop(),
                       lambda x: x.update(logging={})):
            candidate = installed()
            change(candidate)
            with self.assertRaisesRegex(ValueError, "differs from the admitted"):
                compile_configs(json.dumps(candidate).encode())

    def test_invalid_json_and_duplicate_keys_refuse_even_with_matching_digest(self):
        for raw in (b'{"admin":{},"admin":{}}', b'{"x":NaN}', b'{"x":1e9999}', b'\xff', b'null', b'[' * 5000):
            with self.subTest(raw=raw[:30]), self.assertRaises(ValueError):
                compile_configs(raw)


class FixtureApp(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.reply()

    def reply(self):
        body = self.server.name.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


@unittest.skipUnless(CADDY, "native Caddy required for owned loopback proof")
class NativeCaddyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wd-web-config-", dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.dials = {}
        for generation in (A, B):
            app = ThreadingHTTPServer((PEER, 0), FixtureApp)
            app.name = generation.target
            thread = threading.Thread(target=app.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
            thread.start()
            self.addCleanup(thread.join, 2)
            self.addCleanup(app.server_close)
            self.addCleanup(app.shutdown)
            self.dials[generation.target + ":3000"] = f"{PEER}:{app.server_port}"

    def start(self, document):
        # Only socket/dial locations change in this isolated execution fixture.
        config = deepcopy(document)
        admin_path = self.root / "a.sock"
        config["admin"]["listen"] = f"unix/{admin_path}|0600"
        with socket.socket() as reserved:
            reserved.bind((PEER, 0))
            self.port = reserved.getsockname()[1]
        server(config)["listen"] = [f"{PEER}:{self.port}"]
        for route in handler(config)["routes"]:
            for proxy in route["handle"]:
                for upstream in proxy.get("upstreams", []):
                    upstream["dial"] = self.dials[upstream["dial"]]
        path = self.root / "caddy.json"
        path.write_text(json.dumps(config))
        process = subprocess.Popen([CADDY, "run", "--config", str(path)], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   env={"PATH": os.defpath, "XDG_CONFIG_HOME": str(self.root), "XDG_DATA_HOME": str(self.root)})
        self.addCleanup(self.stop, process)
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            try:
                if self.request("GET", "/api/runtime/web-identity")[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.03)
        else:
            self.fail("Owned Caddy config did not become ready")
        persisted = self.root / "caddy/autosave.json"
        self.assertEqual(json.loads(persisted.read_bytes()), config)

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)

    def request(self, method, path, *, extra=(), body=b"", host=HOST, proto="https"):
        connection = HTTPConnection(PEER, self.port, timeout=2)
        try:
            connection.putrequest(method, path, skip_host=True)
            connection.putheader("Host", host)
            connection.putheader("X-Forwarded-Proto", proto)
            connection.putheader("Content-Length", str(len(body)))
            for name, value in extra:
                connection.putheader(name, value)
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    def test_actual_a_keeps_get_and_rejects_unstamped_post_with_probe_marker(self):
        self.start(compile_configs()["successorA"])
        probe = [(PROBE_REQUEST_HEADER, NEW)]
        status, headers, body = self.request("GET", "/api/runtime/web-identity", extra=probe)
        self.assertEqual((status, headers.get_all(PROBE_RESPONSE_HEADER), body), (200, [NEW], b"app"))
        action = ("Next-Action", "a" * 42)
        status, headers, _ = self.request("POST", "/board", extra=[*probe, action])
        self.assertEqual((status, headers.get_all(PROBE_RESPONSE_HEADER), headers.get_all("X-Warpdrive-Web-Rejection")),
                         (409, [NEW], ["before-forward"]))
        for method, path, extras, body in (
            ("GET", "/api/runtime/web-identity", [], b""),
            ("GET", "/api/runtime/web-identity", [*probe, *probe], b""),
            ("GET", "/api/runtime/web-identity?x=1", probe, b""),
            ("GET", "/api/runtime/web-identity", [*probe, ("Cookie", "fixture=1")], b""),
            ("GET", "/api/runtime/web-identity", [*probe, ("Authorization", "Basic Zml4dHVyZQ==")], b""),
            ("POST", "/board", [*probe, action, ("X-Deployment-Id", A.deployment_id)], b""),
            ("POST", "/board", [*probe, action], b"fixture"),
        ):
            with self.subTest(method=method, path=path, extras=extras):
                self.assertIsNone(self.request(method, path, extra=extras, body=body)[1].get(PROBE_RESPONSE_HEADER))
        for options in ({"host": "other.example.invalid"}, {"proto": "http"}):
            status, headers, _ = self.request("GET", "/api/runtime/web-identity", extra=probe, **options)
            self.assertEqual(status, 421)
            self.assertIsNone(headers.get(PROBE_RESPONSE_HEADER))

    def test_actual_b_keeps_previous_asset_and_action_routes_and_probe(self):
        self.start(compile_configs()["successorB"])
        probe = [(PROBE_REQUEST_HEADER, NEW)]
        status, headers, body = self.request("GET", "/api/runtime/web-identity", extra=probe)
        self.assertEqual((status, headers.get_all(PROBE_RESPONSE_HEADER), body), (200, [NEW], B.target.encode()))
        self.assertEqual(self.request("GET", "/_next/static/fixture?dpl=" + A.deployment_id)[2], b"app")
        action = ("Next-Action", "a" * 42)
        self.assertEqual(self.request("POST", "/board", extra=[action, ("X-Deployment-Id", A.deployment_id)])[2], b"app")
        status, headers, _ = self.request("POST", "/board", extra=[*probe, action])
        self.assertEqual((status, headers.get_all(PROBE_RESPONSE_HEADER)), (409, [NEW]))


if __name__ == "__main__":
    unittest.main()
