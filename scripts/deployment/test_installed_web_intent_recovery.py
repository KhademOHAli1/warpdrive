"""Recover an unaccepted installed route change with real adapter logic."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from installed_web_intent_recovery import recover_failed_installed_web_intent
from installed_web_target import InstalledWebTarget
from test_installed_web_target import Admin, compiled_documents
from test_web_rollout import slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, SwitchHeld, SwitchUnknown, _read, content_hash


class InstalledWebIntentRecoveryTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.state = Path(scratch.name).resolve() / "target"
        self.clock = FakeClock()
        self.documents = compiled_documents()
        self.a, self.b = self.documents["successorA"], self.documents["successorB"]
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "initial-web",
                     "targetKey": "installed", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        for side, document in (("before", self.a), ("after", self.b)):
            self.plan[side]["route"]["fingerprint"] = content_hash(document)
        self.before, self.after = self.plan["before"], self.plan["after"]
        self.admin = Admin(self.a)
        self.backend = self.plan["backendFingerprint"]
        self.b_running = True
        self.a_direct_healthy = True
        self.a_public = True
        self.b_public_unavailable = False
        self.target = InstalledWebTarget(self.plan, admin=self.admin, documents=self.documents,
            verify_release=lambda selected, **_options: selected == self.plan,
            observe_runtimes=lambda: {"beforeRuntime": self.before["runtime"],
                "afterRuntime": {**self.after["runtime"], "running": self.b_running}, "backendFingerprint": self.backend},
            probe_health=self.probe, read_durable_config=lambda: self.admin.persisted)
        self.pointer = self.state / "accepted-web-generation.json"
        self.journal = self.state / "web-rollouts" / "initial-web.json"

    def probe(self, requested, *, proxied):
        observed = (self.before if self.admin.live == self.a else self.after) if proxied else requested
        if proxied and observed == self.before and self.a_public is None:
            raise SwitchHeld("Traefik has not re-admitted A")
        if proxied and observed == self.after and self.b_public_unavailable:
            raise SwitchHeld("Traefik cannot confirm B's public health")
        healthy = (self.a_public if proxied else self.a_direct_healthy) if observed == self.before else True
        return {"healthy": healthy, "generation": observed["route"]["generation"], "runtimeId": observed["runtime"]["runtimeId"]}

    def prepare(self, mode="lost-ack"):
        self.admin.mode = mode
        with self.assertRaises(SwitchUnknown):
            rollout_web(self.plan, state_dir=self.state, target=self.target, initialize=True,
                        clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.assertEqual(_read(self.journal)["state"], "switch-intent")
        self.admin.mode = None

    def recover(self, failure=lambda _slot: True, *, timeout=45):
        return recover_failed_installed_web_intent(self.plan, state_dir=self.state, target=self.target,
            observe_candidate_failure=failure, public_timeout=timeout, clock=self.clock.monotonic, sleep=self.clock.sleep)

    def test_exact_live_persisted_b_and_definite_failure_restore_a_once(self):
        self.prepare()
        checks = []

        def failure(slot):
            checks.append(slot)
            return True

        result = self.recover(failure)
        self.assertEqual(checks, [self.after, self.after])
        self.assertEqual(result["state"], "rolled-back")
        self.assertEqual(_read(self.journal), {"plan": self.plan, "state": "rolled-back"})
        self.assertEqual(_read(self.pointer), _record(self.plan, self.before))
        self.assertEqual(self.recover(lambda _slot: self.fail("terminal resume is read-only")), result)
        self.assertEqual(self.admin.writes, [self.b, self.a])

    def test_stopped_exact_b_is_definitive_without_transport_probe(self):
        self.prepare()
        self.b_running = False
        self.assertEqual(self.recover(lambda _slot: self.fail("stopped B is already proved"))["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.b, self.a])

    def test_acknowledged_switch_needs_definite_failure_before_single_reverse_cas(self):
        self.b_public_unavailable = True
        with self.assertRaisesRegex(SwitchHeld, "cannot confirm B"):
            rollout_web(self.plan, state_dir=self.state, target=self.target, initialize=True,
                        clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.assertEqual(_read(self.journal)["state"], "switch-acknowledged")
        self.assertEqual(_read(self.pointer), _record(self.plan, self.before))
        with self.assertRaisesRegex(SwitchHeld, "failure is unverified"):
            self.recover(lambda _slot: None)
        self.assertEqual(self.admin.writes, [self.b])
        self.assertEqual(self.recover()["state"], "rolled-back")
        self.assertEqual(self.recover(lambda _slot: self.fail("terminal resume is read-only"))["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.b, self.a])

    def test_unknown_or_recovered_b_and_unhealthy_a_cannot_write(self):
        self.prepare()
        for result in (None, False, 1):
            with self.subTest(result=result), self.assertRaisesRegex(SwitchHeld, "failure is unverified"):
                self.recover(lambda _slot: result)
        results = iter((True, False))
        with self.assertRaisesRegex(SwitchHeld, "failure is unverified"):
            self.recover(lambda _slot: next(results))
        self.a_direct_healthy = False
        with self.assertRaisesRegex(SwitchHeld, "not directly healthy"):
            self.recover()
        self.assertEqual(_read(self.journal)["state"], "switch-intent")
        self.assertEqual(self.admin.writes, [self.b])

    def test_a_live_or_unsealed_b_has_no_recovery_write(self):
        self.prepare("autosave-missing")
        with self.assertRaises(SwitchHeld):
            self.recover(lambda _slot: self.fail("unsealed B cannot establish failure"))
        self.admin.live = deepcopy(self.a)
        with self.assertRaisesRegex(SwitchHeld, "not confirmed live and persisted"):
            self.recover(lambda _slot: self.fail("a prior switch could still apply"))
        self.assertEqual(self.admin.writes, [self.b])
        self.assertEqual(_read(self.journal)["state"], "switch-intent")

    def test_lost_reverse_ack_and_delayed_public_health_reconcile_without_replay(self):
        self.prepare()
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.recover()
        self.assertEqual(_read(self.journal)["state"], "rollback-intent")
        self.a_public = None
        with self.assertRaisesRegex(SwitchHeld, "awaiting verified public"):
            self.recover(timeout=5)
        self.a_public = True
        self.assertEqual(self.recover()["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.b, self.a])

    def test_reverse_write_still_b_holds_without_replay(self):
        self.prepare()
        self.admin.mode = "reject"
        with self.assertRaises(SwitchUnknown):
            self.recover()
        self.admin.mode = None
        with self.assertRaisesRegex(SwitchHeld, "not the exact retained"):
            self.recover()
        self.assertEqual(_read(self.journal)["state"], "rollback-intent")
        self.assertEqual(self.admin.writes, [self.b])

    def test_foreign_pointer_or_journal_and_backend_drift_are_rejected(self):
        self.prepare()
        pointer = _read(self.pointer)
        foreign = _record(self.plan, self.after)
        _write_state(self.pointer, foreign, previous=pointer)
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            self.recover()
        _write_state(self.pointer, pointer, previous=foreign)
        original = _read(self.journal)
        journal = {"plan": {**self.plan, "qualificationSha256": "1" * 64}, "state": "switch-intent"}
        _write_state(self.journal, journal, previous=original)
        with self.assertRaisesRegex(SwitchConflict, "unsettled installed Web switch"):
            self.recover()
        _write_state(self.journal, original, previous=journal)
        self.backend = "9" * 64
        with self.assertRaisesRegex(SwitchConflict, "backend runtime identity"):
            self.recover()
        self.assertEqual(self.admin.writes, [self.b])


if __name__ == "__main__":
    unittest.main()
