"""Exercise credential-free handoff classification and native loopback TLS."""
from __future__ import annotations

import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

import installed_web_probe as probe


HOST, STORAGE = "crm.example.invalid", "s3.crm.example.invalid"
REVISION, VERSION = "a" * 40, "1.2.3"
EDGE = "a" * 64
ALIAS = "warpdrive-web-relay-" + "b" * 12
OLD, NEW, REALTIME = "http://old:8080", f"http://{ALIAS}:8080", "http://realtime:8080"
IDENTITY = {"contract": "warpdrive.web.identity.v1", "component": "web", "version": VERSION,
            "sourceRevision": REVISION}


def accept(key):
    raw = hashlib.sha1((key + probe.WS_GUID).encode(), usedforsecurity=False).digest()
    return base64.b64encode(raw).decode()


def arguments(**extras):
    return {"host": HOST, "storage_host": STORAGE, "revision": REVISION, "version": VERSION,
            "successor_alias": ALIAS, "incumbent_upstream": OLD, "successor_upstream": NEW,
            "realtime_upstream": REALTIME, "edge_runtime_id": EDGE, **extras}


def response(path, headers, *, marked=True):
    marker = ((probe.PROBE_RESPONSE_HEADER, ALIAS),) if marked else ()
    no_store = (("Cache-Control", "no-store"),)
    if path == probe.IDENTITY_PATH:
        return probe.Response(200, (*marker, *no_store, ("Content-Type", "application/json")), json.dumps(IDENTITY).encode())
    if path == probe.POST_PATH:
        return probe.Response(409, (*marker, *no_store, (probe.REJECTION_HEADER, "before-forward")), probe.REJECTION_BODY)
    if path == probe.WS_PATH:
        return probe.Response(101, (("Connection", "Upgrade"), ("Upgrade", "websocket"),
                                   ("Sec-WebSocket-Accept", accept(headers["Sec-WebSocket-Key"]))), b"")
    return probe.Response(403, (), b"")


class PublicProbeTests(unittest.TestCase):
    def test_public_core_probe_requires_protected_denial_and_exact_marker(self):
        marker = (probe.CORE_RESPONSE_HEADER, probe.CORE_RESPONSE_MARKER)
        common = (("Content-Type", "application/json"), ("Cache-Control", "no-store"))
        body = b'{"error":{"json":{"data":{"code":"UNAUTHORIZED"}}}}'
        response = probe.Response(401, (*common, marker), body)

        def request(method, path, headers, *, read_body):
            self.assertEqual((method, path, read_body), ("GET", probe.CORE_READ_PATH, True))
            self.assertEqual(headers[probe.CORE_PROBE_HEADER], probe.CORE_RESPONSE_MARKER)
            return response

        self.assertTrue(probe.read_public_core_route(request))
        self.assertFalse(probe.read_public_core_route(request, active=False))
        response = probe.Response(401, common, body)
        self.assertTrue(probe.read_public_core_route(request, active=False))
        self.assertFalse(probe.read_public_core_route(request))
        for invalid in (probe.Response(502, (*common, marker), body), probe.Response(401, (*common, marker, marker), body),
                        probe.Response(401, (*common, marker), b'{"error":{"data":{"code":"UNAUTHORIZED"}}}')):
            response = invalid
            self.assertFalse(probe.read_public_core_route(request))

    def exercise(self, *, marked=True, hints=None, replace=None):
        requests = []

        def request(method, path, headers, *, read_body):
            requests.append((method, path, headers, read_body))
            reply = response(path, headers, marked=marked)
            return replace(path, reply) if replace else reply

        result = probe.probe_public(request, request, **arguments(read_route_hints=hints))
        self.assertEqual([(m, p, b) for m, p, _, b in requests], [
            ("GET", probe.IDENTITY_PATH, True), ("POST", probe.POST_PATH, True), ("GET", probe.WS_PATH, False),
            ("GET", probe.STORAGE_PATH, False),
        ])
        post = requests[1][2]
        self.assertEqual(post["Content-Length"], "0")
        self.assertEqual(post["Next-Action"], "0" * 42)
        self.assertNotIn("X-Deployment-Id", post)
        for _, path, headers, _ in requests:
            self.assertNotIn("Cookie", headers)
            self.assertNotIn("Authorization", headers)
            self.assertNotIn("?", path)
        return result

    def test_successor_marker_on_each_hop_and_direct_realtime(self):
        result = self.exercise(hints=lambda: probe.RouteHints(EDGE, NEW, NEW, REALTIME))
        self.assertTrue(result.handoff_observation(peers_unchanged=True).healthy_at("after"))
        self.assertFalse(result.handoff_observation(peers_unchanged=False).healthy_at("after"))

    def test_unmarked_public_success_needs_positive_incumbent_readback(self):
        result = self.exercise(marked=False)
        self.assertIsNone(result.safe_hop)
        self.assertIsNone(result.unsafe_hop)
        self.assertIsNone(result.websocket_direct)
        self.assertTrue(result.websocket_upgrade)
        result = self.exercise(marked=False, hints=lambda: probe.RouteHints(EDGE, OLD, OLD, REALTIME))
        self.assertTrue(result.handoff_observation(peers_unchanged=True).healthy_at("before"))

    def test_wrong_edge_and_mixed_hops_are_distinct_from_success(self):
        observed = self.exercise(hints=lambda: probe.RouteHints("b" * 64, NEW, NEW, REALTIME))
        self.assertEqual((observed.safe_hop, observed.unsafe_hop, observed.websocket_direct), ("after", "after", None))
        self.assertFalse(observed.handoff_observation(peers_unchanged=True).healthy_at("after"))

        def missing_safe_marker(path, reply):
            return probe.Response(reply.status, tuple(row for row in reply.headers if row[0] != probe.PROBE_RESPONSE_HEADER),
                                  reply.body) if path == probe.IDENTITY_PATH else reply

        mixed = self.exercise(hints=lambda: probe.RouteHints(EDGE, OLD, NEW, NEW), replace=missing_safe_marker)
        self.assertEqual((mixed.safe_hop, mixed.unsafe_hop, mixed.websocket_direct), ("before", "after", False))
        reads = iter((probe.RouteHints(EDGE, OLD, OLD, REALTIME), probe.RouteHints(EDGE, NEW, NEW, REALTIME)))
        unstable = self.exercise(hints=lambda: next(reads))
        self.assertEqual((unstable.safe_hop, unstable.unsafe_hop, unstable.websocket_direct), (None, None, None))

    def test_unexpected_revision_fake_rejection_upgrade_and_storage_fail_closed(self):
        def altered(path, reply):
            if path == probe.IDENTITY_PATH:
                return probe.Response(200, reply.headers, reply.body.replace(b"a" * 40, b"b" * 40))
            if path == probe.POST_PATH:
                return probe.Response(409, reply.headers, b"generic conflict")
            if path == probe.WS_PATH:
                return probe.Response(101, (*reply.headers, ("Sec-WebSocket-Accept", "forged")), b"")
            return probe.Response(200, (), b"")

        result = self.exercise(hints=lambda: probe.RouteHints(EDGE, NEW, NEW, REALTIME), replace=altered)
        self.assertEqual((result.safe_hop, result.unsafe_hop), ("after", "after"))
        self.assertEqual((result.identity_matches, result.unstamped_rejected, result.websocket_upgrade,
                          result.storage_anonymous_denied), (False, False, False, False))
        self.assertFalse(result.handoff_observation(peers_unchanged=True).healthy_at("after"))

    def test_duplicate_identity_fields_and_relay_headers_are_rejected(self):
        def altered(path, reply):
            if path == probe.IDENTITY_PATH:
                return probe.Response(200, reply.headers, reply.body[:-1] + b', "version": "1.2.3"}')
            if path == probe.POST_PATH:
                return probe.Response(409, (*reply.headers, (probe.PROBE_RESPONSE_HEADER.lower(), ALIAS)), reply.body)
            return reply

        result = self.exercise(hints=lambda: probe.RouteHints(EDGE, NEW, NEW, REALTIME), replace=altered)
        self.assertEqual((result.safe_hop, result.unsafe_hop, result.identity_matches), ("after", None, False))

    def test_tls_authorities_and_header_scope_admit_only_exact_values(self):
        for host, address in (("https://crm.example.invalid", "127.0.0.1"), (HOST, "dns.invalid"), (HOST, "0.0.0.0")):
            with self.subTest(host=host, address=address), self.assertRaises(probe.ProbeError):
                probe.Endpoint(host, address)
        connection = probe.TlsProbe(probe.Endpoint(HOST, "127.0.0.1"))
        for header in ("Cookie", "Authorization", "Host", "X-Deployment-Id", "Transfer-Encoding"):
            with self.subTest(header=header), self.assertRaisesRegex(probe.ProbeError, "headers"):
                connection("GET", probe.IDENTITY_PATH, {header: "synthetic"}, read_body=True)
        with self.assertRaisesRegex(probe.ProbeError, "Storage probe TLS authority"):
            probe.probe_public(connection, connection, **arguments())


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.handle_probe()

    def do_POST(self):
        self.handle_probe()

    def handle_probe(self):
        self.server.received.append((self.command, self.path, self.headers["Host"], self.headers.get("Content-Length")))
        if getattr(self.server, "trickle", False):
            self.send_response_only(200)
            self.send_header("Connection", "close")
            self.end_headers()
            for _ in range(100):
                try:
                    self.wfile.write(b"1")
                    self.wfile.flush()
                except OSError:
                    return
                time.sleep(0.01)
            return
        reply = response(self.path, self.headers)
        self.send_response_only(reply.status)
        for name, value in reply.headers:
            self.send_header(name, value)
        if reply.status != 101:
            self.send_header("Content-Length", str(len(reply.body)))
        self.end_headers()
        if reply.body:
            self.wfile.write(reply.body)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required for the owned local TLS fixture")
class TlsProbeTests(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="wd-public-probe-")))
        self.cert, key = directory / "cert.pem", directory / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", f"/CN={HOST}", "-addext", f"subjectAltName=DNS:{HOST},DNS:{STORAGE}",
                        "-out", str(self.cert), "-keyout", str(key)], check=True, timeout=10, capture_output=True)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(self.cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        server.received = []
        self.server = server
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        thread.start()

    def client(self, host, *, verify=True):
        endpoint = probe.Endpoint(host, "127.0.0.1", self.server.server_port)
        return probe.TlsProbe(endpoint, cafile=self.cert if verify else None, timeout=2)

    def test_actual_pinned_tls_upgrade_and_all_probe_requests(self):
        result = probe.probe_public(self.client(HOST), self.client(STORAGE),
                                    **arguments(read_route_hints=lambda: probe.RouteHints(EDGE, NEW, NEW, REALTIME)))
        self.assertTrue(result.handoff_observation(peers_unchanged=True).healthy_at("after"))
        self.assertEqual(self.server.received, [("GET", probe.IDENTITY_PATH, HOST, None), ("POST", probe.POST_PATH, HOST, "0"),
                                               ("GET", probe.WS_PATH, HOST, None), ("GET", probe.STORAGE_PATH, STORAGE, None)])

    def test_actual_wrong_certificate_name_and_untrusted_certificate_are_refused(self):
        for client in (self.client("wrong.example.invalid"), self.client(HOST, verify=False)):
            with self.assertRaises(ssl.SSLCertVerificationError):
                client("GET", probe.IDENTITY_PATH, {}, read_body=True)
        self.assertEqual(self.server.received, [])

    def test_actual_slow_close_delimited_body_cannot_extend_total_deadline(self):
        self.server.trickle = True
        client = probe.TlsProbe(probe.Endpoint(HOST, "127.0.0.1", self.server.server_port),
                                cafile=self.cert, timeout=0.2)
        start = time.monotonic()
        with self.assertRaises((probe.ProbeError, OSError)):
            client("GET", probe.IDENTITY_PATH, {}, read_body=True)
        self.assertLess(time.monotonic() - start, 0.7)


if __name__ == "__main__":
    unittest.main()
