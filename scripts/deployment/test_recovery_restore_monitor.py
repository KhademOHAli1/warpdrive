"""Verify the exact recovery handoff, durable replay, and private socket wire."""

import base64
from copy import deepcopy
from hashlib import sha256
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from installed_web_chain import _state
from recovery_restore_monitor import build_restore_handoff, report_restore
from web_rollout_monitor import _locked_outbox
from web_switch import SwitchConflict, canonical


class RecoveryRestoreMonitorTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get("WARPDRIVE_RECOVERY_SOCKET_TMPDIR", "/tmp")).resolve(strict=True)
        temporary = tempfile.TemporaryDirectory(prefix="wd-recmon-", dir=base)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.outbox = self.root / "outbox"
        self.outbox.mkdir(mode=0o700)
        self.config = self.root / "reporter.json"
        self.socket = self.root / "collector.sock"
        self.key = bytes(range(32))
        self.binding = {key: str(uuid.uuid4()) for key in ("installationId", "sourceId", "generationId")}
        self.write_config()
        self.handoff = self.root / "handoff.json"
        self.journal = self.outbox / "recovery-restore-monitor.json"
        self.completed = time.time_ns() // 1_000_000 - 10_000
        self.repository = "1" * 64
        self.result = {"schemaVersion": 1, "kind": "warpdrive-independent-recovery-restore",
                       "snapshotId": "2" * 64, "receiptSha256": "3" * 64, "manifestSha256": "4" * 64,
                       "verifiedBytes": 104, "verifiedEntries": 9, "durationMs": 205,
                       "isolatedRestoreBytesVerified": True, "applicationRecoveryAccepted": False,
                       "offHostAccepted": False, "keyCustodyAccepted": False, "writerResumptionAuthorized": False}
        self.raw = self.seal()
        self.sent = []

    def write_config(self):
        self.write_private(self.config, canonical({"socketPath": str(self.socket), "binding": self.binding,
                                                  "signingKey": base64.urlsafe_b64encode(self.key).decode().rstrip("=")}))

    @staticmethod
    def write_private(path, raw):
        path.touch(mode=0o600, exist_ok=True)
        path.write_bytes(raw)

    def seal(self, *, restore=None, **changes):
        fields = {"installation_id": self.binding["installationId"], "repository_id": self.repository,
                  "completed_at_ms": self.completed, **changes}
        raw = build_restore_handoff(self.result if restore is None else restore, **fields)
        self.write_private(self.handoff, raw)
        return raw

    def send(self, path, binding, key, batch):
        self.assertEqual((path, binding, key), (self.socket, self.binding, self.key))
        self.assertEqual(_state(self.journal)["pending"]["batch"], batch)
        self.assertEqual(self.journal.stat().st_nlink, 1)
        self.sent.append(deepcopy(batch))
        return "accepted"

    def report(self, **changes):
        options = {"handoff": self.handoff, "handoff_sha256": sha256(self.raw).hexdigest(),
                   "receipt_sha256": self.result["receiptSha256"], "send": self.send, **changes}
        return report_restore(self.outbox, self.config, **options)

    def test_projects_only_byte_readback_and_orders_by_actual_completion(self):
        self.assertEqual(self.report(), "accepted")
        first = self.sent[0]
        self.assertEqual(first, {"schemaVersion": 2, "generationId": self.binding["generationId"], "sequence": 1,
                                 "observedAtMs": self.completed, "observations": [{
                                     "kind": "recovery", "stage": "restore_bytes_verified", "state": "healthy", "reason": "ok",
                                     "recoverySetId": str(uuid.uuid5(uuid.UUID(self.binding["installationId"]),
                                                                     f"warpdrive-recovery-set/v1/{self.repository}/{self.result['snapshotId']}")),
                                     "completedAtMs": self.completed, "durationMs": 205, "bytes": 104,
                                     "encrypted": True, "contentSha256": "4" * 64,
                                 }]})
        self.assertEqual(self.report(handoff=None), "unchanged")
        for timestamp in (self.completed - 1, self.completed):
            self.raw = self.seal(restore={**self.result, "durationMs": 209}, completed_at_ms=timestamp)
            with self.assertRaisesRegex(SwitchConflict, "newer or equally timed"):
                self.report()
        self.raw = self.seal(restore={**self.result, "durationMs": 209}, completed_at_ms=self.completed + 1)
        self.assertEqual(self.report(), "accepted")
        second = self.sent[1]
        self.assertEqual(second["sequence"], 2)
        self.assertEqual(second["observations"][0]["recoverySetId"], first["observations"][0]["recoverySetId"])
        self.assertEqual(second["observedAtMs"], self.completed + 1)

    def test_refuses_untrusted_private_scope_pin_clock_and_receipt(self):
        for changed in ({"handoff_sha256": "a" * 64}, {"receipt_sha256": "a" * 64}):
            with self.subTest(changed=changed), self.assertRaises(SwitchConflict):
                self.report(**changed)
        for changed in ({"installation_id": str(uuid.uuid4())}, {"completed_at_ms": self.completed + 1_000_000}):
            self.raw = self.seal(**changed)
            with self.subTest(changed=changed), self.assertRaisesRegex(SwitchConflict, "scope, receipt or clock"):
                self.report()
        self.raw = self.seal() + b"\n"
        self.write_private(self.handoff, self.raw)
        with self.assertRaisesRegex(SwitchConflict, "scope, receipt or clock"):
            self.report()
        self.raw = self.seal()
        self.handoff.chmod(0o644)
        with self.assertRaisesRegex(SwitchConflict, "private"):
            self.report()
        self.assertFalse(self.journal.exists())
        self.assertEqual(self.sent, [])

    def test_result_shape_is_exact_and_rejects_other_acceptance(self):
        for changed in ({"offHostAccepted": True}, {"keyCustodyAccepted": 0}, {"schemaVersion": True},
                        {"isolatedRestoreBytesVerified": 1}, {"writerResumptionAuthorized": True},
                        {"applicationRecoveryAccepted": True}, {"verifiedBytes": 2**51},
                        {"verifiedEntries": 100_001}, {"durationMs": -1}, {"unexpected": "payload"}):
            with self.subTest(changed=changed), self.assertRaisesRegex(SwitchConflict, "Exact successful"):
                self.seal(restore={**self.result, **changed})
        with self.assertRaisesRegex(SwitchConflict, "Exact recovery monitoring handoff"):
            self.seal(installation_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    def test_replay_holds_new_handoff_retired_binding_and_parallel_invocation(self):
        def reject(*args):
            self.send(*args)
            return "rejected"

        old_pin = sha256(self.raw).hexdigest()
        self.assertEqual(self.report(send=reject), "rejected")
        old = self.sent[0]
        self.raw = self.seal(completed_at_ms=self.completed + 1)
        with self.assertRaisesRegex(SwitchConflict, "Pending recovery"):
            self.report()
        generation = self.binding["generationId"]
        self.binding["generationId"] = str(uuid.uuid4())
        self.write_config()
        with self.assertRaisesRegex(SwitchConflict, "outbox generation"):
            self.report(handoff=None, handoff_sha256=old_pin)
        self.binding["generationId"] = generation
        self.write_config()
        with _locked_outbox(self.outbox), self.assertRaises(BlockingIOError):
            self.report(handoff=None, handoff_sha256=old_pin)
        self.assertEqual(self.report(handoff=None, handoff_sha256=old_pin), "accepted")
        self.assertEqual(self.sent, [old, old])
        self.assertEqual(self.report(), "accepted")
        self.assertEqual(self.sent[-1]["sequence"], 2)

    def test_reestablishes_pending_durability_before_send_after_interrupted_sync(self):
        with patch("web_rollout_monitor._fsync", side_effect=OSError("simulated interruption")):
            with self.assertRaises(OSError):
                self.report()
        self.assertEqual(self.sent, [])
        self.assertEqual(_state(self.journal)["pending"]["batch"]["sequence"], 1)
        self.handoff.unlink()
        with patch("recovery_restore_monitor._fsync", side_effect=OSError("simulated interruption")):
            with self.assertRaises(OSError):
                self.report(handoff=None)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.report(handoff=None), "accepted")
        self.assertEqual(len(self.sent), 1)

    def test_native_cli_lost_ack_retries_exact_signed_batch_with_no_handoff(self):
        requests = []
        failures = []
        script = Path(__file__).with_name("recovery_restore_monitor.py")
        command = [sys.executable, "-B", str(script), "report", "--outbox", str(self.outbox),
                   "--config", str(self.config), "--handoff-sha256", sha256(self.raw).hexdigest(),
                   "--receipt-sha256", self.result["receiptSha256"]]
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(self.socket))
            self.socket.chmod(0o600)
            server.listen(1)
            server.settimeout(5)

            def exchange():
                try:
                    for reply in (None, b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"):
                        connection, _ = server.accept()
                        with connection, connection.makefile("rb") as wire:
                            connection.settimeout(3)
                            line = wire.readline(1024)
                            headers = {}
                            while (header := wire.readline(1024)) not in (b"\r\n", b""):
                                name, value = header.decode().split(":", 1)
                                headers[name.lower()] = value.strip()
                            requests.append((line, headers, wire.read(int(headers["content-length"]))))
                            if reply is not None:
                                connection.sendall(reply)
                except (OSError, KeyError, ValueError) as error:
                    failures.append(error)

            worker = threading.Thread(target=exchange, daemon=True)
            worker.start()
            first = subprocess.run([*command, "--handoff", str(self.handoff)], capture_output=True, timeout=5, check=False)
            self.assertEqual((first.returncode, first.stdout, first.stderr), (1, b"unknown\n", b""))
            self.handoff.unlink()
            second = subprocess.run([*command, "--retry-pending"], capture_output=True, timeout=5, check=False)
            self.assertEqual((second.returncode, second.stdout, second.stderr), (0, b"accepted\n", b""))
            worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0][2], requests[1][2])
        for line, headers, body in requests:
            self.assertEqual(line, b"POST /api/internal/operations/observations HTTP/1.1\r\n")
            self.assertEqual(headers["x-warpdrive-collector-source"], self.binding["sourceId"])
            prefix = "\n".join(("warpdrive.operations.collector.v1", "POST", "/api/internal/operations/observations",
                                *self.binding.values(), headers["x-warpdrive-collector-timestamp"], ""))
            self.assertEqual(headers["x-warpdrive-collector-signature"],
                             "v1=" + hmac.new(self.key, prefix.encode() + body, sha256).hexdigest())
            self.assertNotIn(self.result["snapshotId"].encode(), body)
            self.assertNotIn(self.result["receiptSha256"].encode(), body)
            self.assertNotIn(self.repository.encode(), body)
            self.assertEqual(json.loads(body)["sequence"], 1)
        last = subprocess.run([*command, "--retry-pending"], capture_output=True, timeout=5, check=False)
        self.assertEqual((last.returncode, last.stdout, last.stderr), (0, b"unchanged\n", b""))


if __name__ == "__main__":
    unittest.main()
