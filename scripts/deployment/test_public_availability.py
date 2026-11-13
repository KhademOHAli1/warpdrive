"""Public availability probe states and transport bounds."""

from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest

from check_public_availability import (
    AvailabilityQueueFull, acknowledge_event, check, read_observer, record_observation,
)
from web_rollout import _write_state
from web_switch import SwitchConflict


HOST = "app.example.test"
SCRIPT = Path(__file__).with_name("check_public_availability.py")


class AvailabilityTests(unittest.TestCase):
    def test_reports_only_fixed_facts_and_never_follows_redirects(self):
        commands = []

        def run(command, **options):
            commands.append(command)
            self.assertEqual(options["timeout"], 8)
            self.assertEqual(set(options["env"]), {"PATH", "LC_ALL"})
            return subprocess.CompletedProcess(command, 0, b'{"ok":true}\n200')

        sample = check("app.example.test", curl="/owned/curl", run=run)
        self.assertEqual((sample["state"], sample["reason"]), ("healthy", "ok"))
        self.assertEqual(commands[0][1], "--disable")
        self.assertNotIn("--location", commands[0])
        self.assertNotIn("--insecure", commands[0])
        self.assertEqual(commands[0][-1], "https://app.example.test/api/health")
        self.assertNotIn("app.example.test", str(sample))

    def test_distinguishes_remote_failure_throttling_and_observer_failure(self):
        cases = [
            (0, b'{"ok":false}\n503', ("failed", "http_status")),
            (0, b"redirect\n302", ("failed", "http_status")),
            (0, b"slow down\n429", ("unknown", "rate_limited")),
            (0, b'{"ok":1}\n200', ("failed", "invalid_response")),
            (0, b'{"ok":false,"ok":true}\n200', ("failed", "invalid_response")),
            (0, b'[["ok",true]]\n200', ("failed", "invalid_response")),
            (0, b'[{"ok":true}]\n200', ("failed", "invalid_response")),
            (0, b"{}\n000", ("failed", "invalid_response")),
            (28, b"", ("failed", "timeout")),
            (60, b"", ("failed", "transport")),
            (63, b"", ("failed", "invalid_response")),
            (2, b"", ("unknown", "observer_error")),
        ]
        for code, payload, expected in cases:
            with self.subTest(code=code, expected=expected):
                sample = check("app.example.test", curl="/owned/curl", run=lambda *_a, **_k:
                               subprocess.CompletedProcess([], code, payload))
                self.assertEqual((sample["state"], sample["reason"]), expected)

    def test_refuses_a_path_credentials_port_or_address(self):
        def unexpected(*_args, **_kwargs):
            self.fail("Invalid authority reached transport")

        for host in ("127.0.0.1", "app.example.test.", "app.example.test:443",
                     "app.example.test/other", "user@app.example.test", "https://app.example.test"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                check(host, curl="/owned/curl", run=unexpected)

    def test_observer_retains_incident_across_uncertainty_without_duplicate_open(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            start = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)

            def sample(index, state):
                now = start + timedelta(minutes=index)
                return record_observation(directory, "app.example.test",
                                          {"observedAt": now.isoformat(), "state": state}, now=now)

            self.assertIsNone(sample(1, "failed")["transition"])
            opened = sample(2, "failed")
            self.assertEqual(opened["transition"]["kind"], "opened")
            self.assertIsNone(sample(3, "failed")["transition"])
            self.assertIsNone(sample(4, "unknown")["transition"])
            unknown = sample(5, "unknown")
            self.assertEqual((unknown["transition"]["kind"], unknown["incidentOpen"]), ("unknown", True))
            self.assertIsNone(sample(6, "failed")["transition"])
            self.assertIsNone(sample(7, "failed")["transition"])
            self.assertIsNone(sample(8, "healthy")["transition"])
            recovered = sample(9, "healthy")
            self.assertEqual((recovered["transition"]["kind"], recovered["incidentOpen"]), ("recovered", False))
            self.assertEqual(sample(10, "healthy")["lastTransition"], recovered["transition"])
            with self.assertRaisesRegex(ValueError, "out-of-order"):
                sample(9, "failed")

    def test_observer_restarts_a_streak_after_a_long_gap(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            start = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
            for offset in (0, 181):
                now = start + timedelta(seconds=offset)
                recorded = record_observation(directory, "app.example.test",
                                              {"observedAt": now.isoformat(), "state": "failed"}, now=now)
                self.assertEqual(recorded["consecutive"], 1)
                self.assertFalse(recorded["incidentOpen"])

    def test_old_healthy_result_expires_on_the_first_check_after_a_long_gap(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            start = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
            for offset, state in ((0, "healthy"), (60, "healthy"), (241, "failed"), (301, "failed")):
                now = start + timedelta(seconds=offset)
                observed = record_observation(directory, "app.example.test",
                                              {"observedAt": now.isoformat(), "state": state}, now=now)
                if offset == 60:
                    self.assertEqual(observed["status"], "healthy")
                if offset == 241:
                    self.assertEqual(observed["status"], "unknown")
                    self.assertEqual(observed["transition"]["kind"], "unknown")
                    self.assertFalse(observed["incidentOpen"])
            self.assertEqual(observed["transition"]["kind"], "opened")

    def test_native_read_and_ack_replay_all_events_after_producer_exits(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            start = datetime.now(UTC) - timedelta(minutes=10)
            for offset, state in enumerate(("failed", "unknown", "healthy")):
                instant = start + timedelta(minutes=offset)
                record_observation(directory, HOST, {"observedAt": instant.isoformat(), "state": state},
                                   now=instant, threshold=1)

            def invoke(action, *args, code=0):
                result = subprocess.run([sys.executable, "-B", str(SCRIPT), action, HOST, "--state-dir", str(directory), *args],
                                        capture_output=True, timeout=5, check=False)
                self.assertEqual(result.returncode, code, result.stderr)
                return json.loads(result.stdout) if code == 0 else result

            saved = directory / "availability.json"
            before = saved.read_bytes()
            snapshot = invoke("read")
            self.assertEqual(snapshot, invoke("read"))
            self.assertEqual(saved.read_bytes(), before)
            self.assertEqual((snapshot["status"], snapshot["stale"], snapshot["incidentOpen"]), ("unknown", True, False))
            self.assertEqual([entry["kind"] for entry in snapshot["pending"]], ["opened", "unknown", "recovered"])
            opening, uncertainty, recovery = [entry["id"] for entry in snapshot["pending"]]
            invoke("ack", "--event-id", uncertainty, code=2)
            self.assertEqual(saved.read_bytes(), before)
            self.assertFalse(invoke("ack", "--event-id", opening)["alreadyAcknowledged"])
            self.assertTrue(invoke("ack", "--event-id", opening)["alreadyAcknowledged"])
            self.assertEqual([entry["id"] for entry in invoke("read")["pending"]], [uncertainty, recovery])
            invoke("ack", "--event-id", uncertainty)
            invoke("ack", "--event-id", recovery)
            self.assertEqual(invoke("read")["pending"], [])
            self.assertEqual(invoke("read")["lastAcknowledgedId"], recovery)

    def test_v1_state_remains_readable_and_latest_event_survives_upgrade(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            saved = directory / "availability.json"
            start = datetime.now(UTC) - timedelta(seconds=60)
            opened = {"kind": "opened", "observedAt": start.isoformat()}
            _write_state(saved, {"hostname": HOST, "threshold": 1, "sampleState": "failed", "streak": 1,
                                 "status": "failed", "incidentOpen": True, "observedAt": start.isoformat(),
                                 "lastTransition": opened})
            before = saved.read_bytes()
            prior = read_observer(directory, HOST, now=start)
            self.assertEqual(saved.read_bytes(), before)
            self.assertEqual(prior["status"], "failed")
            oldest = prior["pending"][0]
            self.assertEqual({key: oldest[key] for key in opened}, opened)
            now = start + timedelta(seconds=10)
            record_observation(directory, HOST, {"state": "healthy", "observedAt": now.isoformat()}, threshold=1, now=now)
            pending = read_observer(directory, HOST, now=now)["pending"]
            self.assertEqual(pending[0], oldest)
            self.assertEqual(pending[1]["kind"], "recovered")

    def test_full_queue_preserves_atomic_prior_state_and_resumes_after_ack(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            saved = directory / "availability.json"
            start = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)

            def observe(offset):
                now = start + timedelta(seconds=offset)
                state = "healthy" if offset % 2 else "failed"
                return record_observation(directory, HOST, {"state": state, "observedAt": now.isoformat()},
                                          threshold=1, now=now)

            for index in range(64):
                observe(index)
            pending = read_observer(directory, HOST, now=start + timedelta(seconds=63))["pending"]
            self.assertEqual(len(pending), 64)
            before = saved.read_bytes()
            with self.assertRaises(AvailabilityQueueFull):
                observe(64)
            self.assertEqual(saved.read_bytes(), before)
            acknowledge_event(directory, HOST, pending[0]["id"])
            self.assertEqual(observe(64)["transition"]["kind"], "opened")
            after = read_observer(directory, HOST, now=start + timedelta(seconds=64))["pending"]
            self.assertEqual(after[:-1], pending[1:])
            self.assertEqual(len(after), 64)

    def test_stale_read_keeps_open_incident_and_does_not_consume_pending(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            now = datetime.now(UTC)
            empty = read_observer(directory, HOST, now=now)
            self.assertEqual((empty["status"], empty["stale"], empty["observedAt"]), ("unknown", True, None))
            record_observation(directory, HOST, {"state": "failed", "observedAt": now.isoformat()}, threshold=1, now=now)
            fresh = read_observer(directory, HOST, now=now + timedelta(seconds=180))
            stale = read_observer(directory, HOST, now=now + timedelta(seconds=181))
            self.assertEqual((fresh["status"], fresh["stale"]), ("failed", False))
            self.assertEqual((stale["status"], stale["stale"], stale["incidentOpen"]), ("unknown", True, True))
            self.assertEqual(stale["pending"], fresh["pending"])

    def test_first_publish_interruption_keeps_event_and_mutating_call_repairs_owned_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            now = datetime.now(UTC)
            record_observation(directory, HOST, {"state": "failed", "observedAt": now.isoformat()}, threshold=1, now=now)
            saved = directory / "availability.json"
            staged = directory / ".web-rollout-abcdefgh.tmp"
            os.link(saved, staged)
            opening = read_observer(directory, HOST, now=now)["pending"][0]
            self.assertTrue(staged.exists())
            self.assertEqual(saved.stat().st_nlink, 2)
            acknowledge_event(directory, HOST, opening["id"])
            self.assertFalse(staged.exists())
            self.assertEqual(saved.stat().st_nlink, 1)
            self.assertEqual(read_observer(directory, HOST, now=now)["lastAcknowledgedId"], opening["id"])

    def test_reads_and_acknowledgements_reject_another_hostname_or_unowned_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            now = datetime.now(UTC)
            record_observation(directory, HOST, {"state": "failed", "observedAt": now.isoformat()}, threshold=1, now=now)
            event_id = read_observer(directory, HOST, now=now)["pending"][0]["id"]
            saved = directory / "availability.json"
            before = saved.read_bytes()
            with self.assertRaisesRegex(ValueError, "another authority"):
                acknowledge_event(directory, "other.example.test", event_id)
            self.assertEqual(saved.read_bytes(), before)
            unknown = directory / "unowned-link"
            os.link(saved, unknown)
            with self.assertRaisesRegex(SwitchConflict, "private installed Web chain file"):
                read_observer(directory, HOST, now=now)
            self.assertTrue(unknown.exists())

    @unittest.skipUnless(shutil.which("curl") and shutil.which("openssl"), "curl and openssl required")
    def test_actual_tls_and_http_with_an_owned_loopback_origin(self):
        host = "app.example.test"
        curl, openssl = shutil.which("curl"), shutil.which("openssl")
        paths = []
        with tempfile.TemporaryDirectory() as temporary, HTTPServer(("127.0.0.1", 0), self.handler(paths)) as server:
            directory = Path(temporary).resolve()
            key, certificate = directory / "key.pem", directory / "certificate.pem"
            subprocess.run([
                openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-keyout", str(key), "-out", str(certificate), "-days", "1",
                "-subj", f"/CN={host}", "-addext", f"subjectAltName=DNS:{host}",
            ], capture_output=True, check=True, timeout=10)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            server.timeout = 1
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def native(command, *, trust=True, **options):
                    routed = [*command[:-1], "--connect-to", f"{host}:443:127.0.0.1:{server.server_port}"]
                    if trust:
                        routed += ["--cacert", str(certificate)]
                    return subprocess.run([*routed, command[-1]], **options)

                self.assertEqual(check(host, curl=curl, run=native)["state"], "healthy")
                self.assertEqual(check(host, curl=curl, run=lambda *a, **k: native(*a, trust=False, **k))["reason"],
                                 "transport")
                self.assertEqual(paths, ["/api/health"])
            finally:
                server.shutdown()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())

    @staticmethod
    def handler(paths):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

            def log_message(self, *_):
                pass

        return Handler
