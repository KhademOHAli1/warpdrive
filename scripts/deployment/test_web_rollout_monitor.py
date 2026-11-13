"""Exercise release locks, exact journal selection and durable observation delivery."""

import base64
from copy import deepcopy
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

from installed_web_readback_lock import installed_web_readback_locks
from installed_web_emergency import restore_failed_installed_web
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _write_state, rollout_web
from web_rollout_monitor import _send, _stdin_handoff, read_handoff, read_observation, report_observation
from web_switch import SwitchConflict, SwitchUnknown, canonical, content_hash


class WebRolloutMonitorTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="wd-mon-", dir=Path("/tmp").resolve())
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.original, self.state, self.outbox = (self.root / name for name in ("original", "release", "outbox"))
        self.original.mkdir(mode=0o700)
        self.outbox.mkdir(mode=0o700)
        (self.original / "production-operation.lock").touch(mode=0o600)
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deployment-a",
                     "targetKey": "fixture", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        self.target = Target(self.plan)
        self.binding = {key: str(uuid.uuid4()) for key in ("installationId", "sourceId", "generationId")}
        self.key = os.urandom(32)
        self.socket = self.root / "collector.sock"
        self.config = self.root / "reporter.json"
        self.config.touch(mode=0o600)
        self.config.write_text(json.dumps({"socketPath": str(self.socket), "binding": self.binding,
                                          "signingKey": base64.urlsafe_b64encode(self.key).decode().rstrip("=")}))

    def roll(self, *, initialize=True):
        clock = FakeClock()
        return rollout_web(self.plan, state_dir=self.state, target=self.target, initialize=initialize,
                           clock=clock.monotonic, sleep=clock.sleep)

    def observe(self):
        return read_observation(self.original, self.state, self.plan["operationId"], content_hash(self.plan))

    def test_lost_route_ack_is_unknown_then_resolves_without_repeating_mutation(self):
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.roll()
        pending = self.observe()
        self.assertEqual(pending["observation"]["outcome"], "unknown")
        self.assertIsNone(pending["observation"]["sourceRevision"])
        with self.assertRaisesRegex(SwitchConflict, "Another operation"):
            with installed_web_readback_locks(self.original, self.state):
                self.observe()
        self.roll(initialize=False)
        accepted = self.observe()
        self.assertEqual(accepted["observation"]["outcome"], "accepted")
        self.assertEqual(accepted["observation"]["sourceRevision"], "b" * 40)
        self.assertGreaterEqual(accepted["observedAtMs"], pending["observedAtMs"])
        self.assertEqual(self.target.updates, [self.plan["after"]["route"]])

    def test_rejects_wrong_plan_pointer_and_superseded_history(self):
        self.roll()
        with self.assertRaisesRegex(SwitchConflict, "selected plan"):
            read_observation(self.original, self.state, self.plan["operationId"], "f" * 64)
        later = {**self.plan, "operationId": "deployment-b", "before": self.plan["after"],
                 "after": slot("3", "c", "c")}
        path = self.state / "web-rollouts" / "deployment-b.json"
        _write_state(path, {"plan": later, "state": "rejected"})
        prior = (self.state / "web-rollouts" / "deployment-a.json").stat().st_mtime_ns
        os.utime(path, ns=(prior + 10_000_000, prior + 10_000_000))
        with self.assertRaisesRegex(SwitchConflict, "supersedes"):
            self.observe()

    def test_emergency_accepted_pointer_reports_a_rollback(self):
        self.roll()
        self.target.candidate_running = False
        clock = FakeClock()
        restored = restore_failed_installed_web(
            self.plan, state_dir=self.state, target=self.target, observe_candidate_failure=lambda _slot: True,
            clock=clock.monotonic, sleep=clock.sleep,
        )
        event = read_observation(self.original, self.state, restored["operationId"], restored["planSha256"])
        self.assertEqual(event["observation"]["outcome"], "rolled_back")
        self.assertEqual(event["observation"]["sourceRevision"], "a" * 40)

    def test_handoff_accepts_only_the_selected_canonical_bounded_event(self):
        self.roll()
        event = self.observe()
        operation, digest = self.plan["operationId"], content_hash(self.plan)
        envelope = {"operationId": operation, "event": event}
        raw = canonical(envelope) + b"\n"
        self.assertEqual(read_handoff(io.BytesIO(raw), operation, digest), event)
        for candidate in (raw[:-1], raw + b" " * 1024,
                          canonical({**envelope, "operationId": "other"}) + b"\n",
                          canonical({**envelope, "event": {**event, "planSha256": "f" * 64}}) + b"\n",
                          canonical({**envelope, "event": {**event, "observation": {
                              **event["observation"], "proofSha256": None}}}) + b"\n"):
            with self.subTest(candidate=candidate[:64]), self.assertRaises(SwitchConflict):
                read_handoff(io.BytesIO(candidate), operation, digest)

    def test_incomplete_handoff_pipe_releases_the_outbox_deadline(self):
        reader, writer = os.pipe()
        self.addCleanup(os.close, reader)
        self.addCleanup(os.close, writer)
        os.write(writer, b"{")
        with self.assertRaisesRegex(SwitchConflict, "timed out"):
            _stdin_handoff(reader, seconds=0.05)

    def test_lost_collector_reply_retains_one_sequence_and_never_reobserves_pending(self):
        self.roll()
        sent = []

        def send(_path, binding, key, batch):
            self.assertEqual((binding, key), (self.binding, self.key))
            sent.append(deepcopy(batch))
            return "unknown" if len(sent) == 1 else "accepted"

        options = {"plan_sha256": content_hash(self.plan), "send": send}
        self.assertEqual(report_observation(self.outbox, self.config, self.observe, **options), "unknown")
        with self.assertRaisesRegex(SwitchConflict, "different plan"):
            report_observation(self.outbox, self.config, self.observe, **{**options, "plan_sha256": "f" * 64})
        self.assertEqual(report_observation(self.outbox, self.config, lambda: self.fail("Pending reobserved"),
                                            **options), "accepted")
        self.assertEqual(report_observation(self.outbox, self.config, self.observe, **options), "unchanged")
        self.assertEqual(len(sent), 2)
        self.assertEqual(sent[0], sent[1])
        self.assertEqual(sent[0]["sequence"], 1)
        self.assertEqual(self.target.updates, [self.plan["after"]["route"]])

    def test_first_rename_interruption_preserves_pending_until_durable(self):
        self.roll()
        options = {"plan_sha256": content_hash(self.plan)}
        with patch("web_rollout_monitor._fsync", side_effect=OSError("simulated interruption")):
            for load in (self.observe, lambda: self.fail("Pending observation was reloaded")):
                with self.assertRaises(OSError):
                    report_observation(self.outbox, self.config, load, **options,
                                       send=lambda *args: self.fail("Outbox was not durable"))
        self.assertEqual((self.outbox / "web-monitor.json").stat().st_nlink, 1)
        batches = []
        result = report_observation(self.outbox, self.config, lambda: self.fail("Pending observation was reloaded"),
                                    **options, send=lambda *args: batches.append(args[-1]) or "accepted")
        self.assertEqual(result, "accepted")
        self.assertEqual([batch["sequence"] for batch in batches], [1])

    def test_real_unix_http_request_has_exact_signed_body_and_bounded_ack(self):
        seen = []
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(self.socket))
            self.socket.chmod(0o600)
            server.listen(1)
            server.settimeout(3)

            def exchange():
                connection, _ = server.accept()
                with connection, connection.makefile("rb") as wire:
                    connection.settimeout(3)
                    line = wire.readline(1024)
                    headers = {}
                    while (header := wire.readline(1024)) not in (b"\r\n", b""):
                        name, value = header.decode().split(":", 1)
                        headers[name.lower()] = value.strip()
                    seen.append((line, headers, wire.read(int(headers["content-length"]))))
                    connection.sendall(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")

            worker = threading.Thread(target=exchange, daemon=True)
            worker.start()
            batch = {"schemaVersion": 2, "generationId": self.binding["generationId"], "sequence": 2,
                     "observedAtMs": 0, "observations": []}
            self.assertEqual(_send(self.socket, self.binding, self.key, batch), "accepted")
            worker.join(timeout=3)
        self.assertEqual(len(seen), 1)
        line, headers, body = seen[0]
        self.assertEqual(line, b"POST /api/internal/operations/observations HTTP/1.1\r\n")
        self.assertEqual(json.loads(body), batch)
        prefix = "\n".join(("warpdrive.operations.collector.v1", "POST", "/api/internal/operations/observations",
                            *self.binding.values(), headers["x-warpdrive-collector-timestamp"], ""))
        self.assertEqual(headers["x-warpdrive-collector-signature"],
                         "v1=" + hmac.new(self.key, prefix.encode() + body, hashlib.sha256).hexdigest())
