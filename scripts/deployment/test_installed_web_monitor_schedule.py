"""Exercise scheduled native journal selection and collector acknowledgement recovery."""

import base64
from copy import deepcopy
from functools import partial
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

import installed_web_monitor_schedule as schedule
from installed_web_readback_lock import installed_web_readback_locks
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _write_state, rollout_web
from web_rollout_monitor import report_observation
from web_switch import SwitchConflict, SwitchUnknown, canonical, content_hash


class ScheduledWebMonitoringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="wd-web-schedule-"))).resolve()
        self.original, self.state, self.outbox = (self.root / name for name in ("original", "release", "outbox"))
        self.original.mkdir(mode=0o700)
        self.outbox.mkdir(mode=0o700)
        (self.original / "production-operation.lock").touch(mode=0o600)
        self.config = self.root / "reporter.json"
        self.config.touch(mode=0o600)
        self.binding = {key: str(uuid.uuid4()) for key in ("installationId", "sourceId", "generationId")}
        self.key = os.urandom(32)
        self.config.write_bytes(canonical({"socketPath": str(self.root / "collector.sock"), "binding": self.binding,
            "signingKey": base64.urlsafe_b64encode(self.key).decode().rstrip("=")}))
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "web-aaaaaaaaaaaa",
                     "targetKey": "fixture", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        self.target = Target(self.plan)

    def roll(self, *, initialize=True):
        clock = FakeClock()
        return rollout_web(self.plan, state_dir=self.state, target=self.target, initialize=initialize,
                           clock=clock.monotonic, sleep=clock.sleep)

    def extract(self, target_key="fixture"):
        return schedule.extract_current(self.original, self.state, target_key=target_key)

    def submit(self, raw, send):
        return schedule.submit_current(self.outbox, self.config, raw, report=partial(report_observation, send=send))

    def test_current_installed_success_requires_exact_target_pointer_and_release_lock(self):
        self.roll()
        raw = self.extract()
        value = json.loads(raw)
        self.assertEqual(value["operationId"], self.plan["operationId"])
        self.assertEqual(value["event"]["planSha256"], content_hash(self.plan))
        self.assertEqual(value["event"]["observation"]["outcome"], "accepted")
        self.assertEqual(raw, canonical(value) + b"\n")
        self.assertEqual(self.target.updates, [self.plan["after"]["route"]])
        with self.assertRaisesRegex(SwitchConflict, "scheduled target"):
            self.extract("different")
        with installed_web_readback_locks(self.original, self.state), self.assertRaisesRegex(SwitchConflict, "Another operation"):
            self.extract()

    def test_unknown_journal_and_lost_collector_reply_retry_exact_before_later_success(self):
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.roll()
        uncertain = self.extract()
        evidence = json.loads(uncertain)["event"]["observation"]
        self.assertEqual((evidence["outcome"], evidence["sourceRevision"], evidence["proofSha256"]), ("unknown", None, None))
        batches = []

        def send(_path, binding, key, batch):
            self.assertEqual((binding, key), (self.binding, self.key))
            batches.append(deepcopy(batch))
            return "unknown" if len(batches) == 1 else "accepted"

        self.assertEqual(self.submit(uncertain, send), "unknown")
        self.roll(initialize=False)
        final = self.extract()
        self.assertEqual(self.submit(final, send), "accepted")
        self.assertEqual(self.submit(final, send), "unchanged")
        self.assertEqual([batch["sequence"] for batch in batches], [1, 1, 2])
        self.assertEqual(batches[0], batches[1])
        self.assertEqual(batches[2]["observations"][0]["outcome"], "accepted")
        self.assertEqual(self.target.updates, [self.plan["after"]["route"]])

    def test_prepared_route_only_ties_and_projection_do_not_claim_rollout_outcomes(self):
        self.roll()
        directory = self.state / "web-rollouts"
        old = directory / (self.plan["operationId"] + ".json")
        latest = directory / "web-bbbbbbbbbbbb.json"
        next_plan = {**self.plan, "operationId": latest.stem, "before": self.plan["after"], "after": slot("3", "d", "d")}
        prepared = {"plan": next_plan, "state": "prepared"}
        _write_state(latest, prepared)
        newer = old.stat().st_mtime_ns + 1_000_000
        os.utime(latest, ns=(newer, newer))
        with self.assertRaisesRegex(SwitchConflict, "Prepared"):
            self.extract()
        _write_state(latest, {"kind": "warpdrive-installed-web-route-reconciliation"}, previous=prepared)
        os.utime(latest, ns=(newer, newer))
        with self.assertRaisesRegex(SwitchConflict, "no native"):
            self.extract()
        latest.unlink()
        _write_state(latest, {"plan": next_plan, "state": "rejected"})
        os.utime(latest, ns=(newer, newer))
        os.utime(old, ns=(newer, newer))
        with self.assertRaisesRegex(SwitchConflict, "supersedes"):
            self.extract()
        latest.unlink()
        pointer = self.state / "accepted-web-generation.json"
        prior = schedule._state(pointer)
        _write_state(pointer, {**prior, "backendFingerprint": "f" * 64}, previous=prior)
        with self.assertRaisesRegex(SwitchConflict, "accepted pointer"):
            self.extract()

    def test_held_read_still_gives_reporter_empty_pipe_to_retry_pending(self):
        self.roll()
        self.assertEqual(self.submit(self.extract(), lambda *_: "unknown"), "unknown")
        sent = []

        def reporter(raw, **options):
            self.assertEqual(raw, b"")
            self.assertEqual(options, {"account": "operations", "outbox": self.outbox, "config": self.config})
            return self.submit(raw, lambda *args: sent.append(args[-1]) or "accepted")

        with (patch.object(schedule, "_RELEASE_UID", os.geteuid()),
              patch.object(schedule, "extract_current", side_effect=SwitchConflict("held"))):
            result = schedule.tick(self.original, self.state, target_key="fixture", account="operations",
                                   outbox=self.outbox, config=self.config, reporter=reporter)
        self.assertEqual(result, "held")
        self.assertEqual([batch["sequence"] for batch in sent], [1])
        self.assertEqual(self.submit(b"", lambda *_: self.fail("No pending event remains")), "idle")

    def test_reporter_exec_is_fixed_and_drops_ids_groups_environment(self):
        fixture = SimpleNamespace(pw_name="operations", pw_uid=812, pw_gid=813)
        completed = SimpleNamespace(returncode=0, stdout=b"accepted\n")
        with (patch.object(schedule.pwd, "getpwnam", return_value=fixture),
              patch.object(schedule, "_trusted_source", side_effect=lambda path: path.resolve()),
              patch.object(schedule.subprocess, "run", return_value=completed) as launch):
            self.assertEqual(schedule._reporter(b"payload", account="operations", outbox=self.outbox, config=self.config), "accepted")
            fixture.pw_uid = 0
            with self.assertRaisesRegex(SwitchConflict, "separate non-root"):
                schedule._reporter(b"payload", account="operations", outbox=self.outbox, config=self.config)
        options = launch.call_args.kwargs
        self.assertEqual((options["input"], options["user"], options["group"], options["extra_groups"]), (b"payload", 812, 813, ()))
        self.assertEqual((options["env"], options["cwd"], options["timeout"]), ({"PATH": "/usr/bin:/bin"}, "/", 45))
        self.assertIn("submit-current", launch.call_args.args[0])

    def test_noncanonical_handoff_cannot_send_a_new_batch(self):
        self.roll()
        with self.assertRaisesRegex(SwitchConflict, "selected operation"):
            self.submit(self.extract().rstrip(b"\n"), lambda *_: self.fail("Untrusted handoff submitted"))
        self.assertFalse((self.outbox / "web-monitor.json").exists())

if __name__ == "__main__":
    unittest.main()
