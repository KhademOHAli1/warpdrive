"""Exercise stable availability delivery through a retained outbox and owned HTTPS."""

from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest

from check_public_availability import read_observer, record_observation
from deliver_public_availability import _delivery_lock, deliver_next


HOST = "app.example.test"
ALERT_HOST = "alerts.example.test"
TOKEN = "fixture-alert-bearer-1234567890"


class DeliverAvailabilityTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.state = root / "state"
        self.state.mkdir(mode=0o700)
        self.config = root / "config.json"
        self.config.write_text(json.dumps({"url": f"https://{ALERT_HOST}/receive", "token": TOKEN}))
        self.config.chmod(0o600)
        self.now = datetime.now(UTC)

    def events(self):
        for offset, status in ((3, "failed"), (2, "failed"), (1, "healthy"), (0, "healthy")):
            timestamp = self.now - timedelta(seconds=offset)
            record_observation(self.state, HOST, {"state": status, "observedAt": timestamp.isoformat()}, now=self.now)
        return read_observer(self.state, HOST)["pending"]

    def test_unknown_or_wrong_receipt_retains_same_body_then_delivers_in_order(self):
        opened, recovered = self.events()
        calls = []

        def run(command, *, input, **options):
            self.assertNotIn(TOKEN, str(command))
            self.assertNotIn(TOKEN, str(options))
            self.assertIn(TOKEN.encode(), input)
            calls.append(input)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(command, options["timeout"])
            target = recovered if len(calls) in (2, 4) else opened
            return subprocess.CompletedProcess(command, 0, json.dumps({"accepted": True, "eventId": target["id"]}).encode() + b"\n202")

        results = [deliver_next(self.state, HOST, self.config, run=run) for _ in range(4)]
        self.assertEqual([item["state"] for item in results], ["held", "held", "accepted", "accepted"])
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(calls[1], calls[2])
        self.assertNotEqual(calls[2], calls[3])
        self.assertEqual(read_observer(self.state, HOST)["pending"], [])

    def test_rejects_shared_authority_and_serializes_consumers(self):
        self.events()
        with _delivery_lock(self.state):
            with self.assertRaises(BlockingIOError):
                deliver_next(self.state, HOST, self.config, run=lambda *_a, **_k: self.fail("concurrent send"))
        self.config.write_text(json.dumps({"url": f"https://{HOST}/receive", "token": TOKEN}))
        with self.assertRaisesRegex(ValueError, "separate authority"):
            deliver_next(self.state, HOST, self.config, run=lambda *_a, **_k: self.fail("shared destination"))

    def test_empty_stale_observer_is_visible_without_transport(self):
        result = deliver_next(self.state, HOST, self.config, run=lambda *_a, **_k: self.fail("empty queue sent"))
        self.assertEqual(result, {"state": "empty", "observerStale": True})

    @unittest.skipUnless(shutil.which("curl") and shutil.which("openssl"), "curl and openssl required")
    def test_actual_tls_idempotency_and_exact_receipt(self):
        opened, _ = self.events()
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                requests.append((self.path, self.headers.get("Idempotency-Key"), self.headers.get("Authorization"), json.loads(raw)))
                reply = json.dumps({"eventId": requests[-1][1], "accepted": True}).encode()
                self.send_response(202)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(reply)

            def log_message(self, *_):
                pass

        with HTTPServer(("127.0.0.1", 0), Handler) as server:
            certificate, key = self.state.parent / "cert.pem", self.state.parent / "key.pem"
            subprocess.run([shutil.which("openssl"), "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-keyout", str(key), "-out", str(certificate), "-subj", f"/CN={ALERT_HOST}",
                            "-addext", f"subjectAltName=DNS:{ALERT_HOST}"], check=True, capture_output=True, timeout=10)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def local(command, *, trust=False, **options):
                    routed = [*command, "--connect-to", f"{ALERT_HOST}:443:127.0.0.1:{server.server_port}"]
                    if trust:
                        routed += ["--cacert", os.fspath(certificate)]
                    return subprocess.run(routed, **options)

                curl = shutil.which("curl")
                self.assertEqual(deliver_next(self.state, HOST, self.config, curl=curl, run=local)["state"], "held")
                self.assertEqual(requests, [])
                result = deliver_next(self.state, HOST, self.config, curl=curl, run=lambda *a, **k: local(*a, trust=True, **k))
                self.assertEqual(result["state"], "accepted")
                self.assertEqual(requests, [("/receive", opened["id"], "Bearer " + TOKEN,
                    {"schemaVersion": 1, "kind": "warpdrive-availability-alert", "hostname": HOST, "event": opened})])
            finally:
                server.shutdown()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
