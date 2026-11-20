"""Exercise failed startup reporting independently of the Core process."""

import base64
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid

from core_runtime_monitor import report_core_diagnostic
from web_switch import SwitchConflict


class CoreRuntimeMonitorTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="wd-core-mon-", dir=Path("/tmp").resolve())
        self.addCleanup(scratch.cleanup)
        root = Path(scratch.name)
        self.outbox = root / "outbox"
        self.outbox.mkdir(mode=0o700)
        self.config = root / "reporter.json"
        self.config.touch(mode=0o600)
        self.binding = {key: str(uuid.uuid4()) for key in ("installationId", "sourceId", "generationId")}
        self.config.write_text(json.dumps({"socketPath": str(root / "collector.sock"), "binding": self.binding,
                                          "signingKey": base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")}))
        self.failed = {
            "event": "warpdrive.runtime.diagnostic", "schemaVersion": 1, "component": "core-api",
            "observedAtMs": time.time_ns() // 1_000_000 - 1000, "processGeneration": str(uuid.uuid4()),
            "code": "CORE_DB_ROLE_REJECTED", "phase": "startup", "level": "error", "state": "starting",
        }

    def test_failed_startup_replays_once_then_next_process_can_recover(self):
        seen = []

        def send(_path, binding, _key, batch):
            self.assertEqual(binding, self.binding)
            seen.append(deepcopy(batch))
            return "unknown" if len(seen) == 1 else "accepted"

        ready = {**self.failed, "observedAtMs": self.failed["observedAtMs"] + 100,
                 "processGeneration": str(uuid.uuid4()), "code": "CORE_READY",
                 "phase": "readiness", "level": "info", "state": "ready"}
        self.assertEqual(report_core_diagnostic(self.outbox, self.config, raw=self.failed, send=send), "unknown")
        with self.assertRaises(SwitchConflict):
            report_core_diagnostic(self.outbox, self.config, raw=ready, send=send)
        self.assertEqual(report_core_diagnostic(self.outbox, self.config, retry_pending=True, send=send), "accepted")
        self.assertEqual(report_core_diagnostic(self.outbox, self.config, raw=self.failed, send=send), "unchanged")
        self.assertEqual(report_core_diagnostic(self.outbox, self.config, raw=ready, send=send), "accepted")
        self.assertEqual(seen[0], seen[1])
        self.assertEqual([batch["sequence"] for batch in seen], [1, 1, 2])
        failure, success = (batch["observations"][0] for batch in (seen[0], seen[2]))
        self.assertEqual(failure, {"kind": "component", "component": "core_api", "state": "failed",
                                   "reason": "core_db_role_rejected", "latencyMs": None,
                                   "processGeneration": self.failed["processGeneration"],
                                   "installed": {"evidence": "unchecked"}})
        self.assertEqual((success["state"], success["reason"], success["processGeneration"]),
                         ("healthy", "ok", ready["processGeneration"]))

    def test_rejects_arbitrary_data_and_invalid_facts_before_touching_the_outbox(self):
        for extra in ({"connectionString": "private"}, {"phase": "runtime"},
                      {"processGeneration": "some-private-host"}, {"admittedBodyBytes": -1},
                      {"code": "CORE_READY", "phase": "readiness", "level": "info"},
                      {"observedAtMs": int(time.time() * 1000) + 40_000}):
            with self.subTest(extra=extra), self.assertRaises(SwitchConflict):
                report_core_diagnostic(self.outbox, self.config, raw={**self.failed, **extra})
        starting = {**self.failed, "code": "CORE_STARTING", "level": "info"}
        self.assertEqual(report_core_diagnostic(self.outbox, self.config, raw=starting), "ignored")
        self.assertEqual(list(self.outbox.iterdir()), [])
