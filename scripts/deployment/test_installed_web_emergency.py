"""Exercise installed failure recovery against the normal rollout journal."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from installed_web_emergency import restore_failed_installed_web
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, SwitchHeld, SwitchUnknown, _read, content_hash


class InstalledWebEmergencyTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.state = Path(scratch.name).resolve() / "target"
        self.clock = FakeClock()
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deploy-one",
                     "targetKey": "installed", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        self.target = Target(self.plan)
        self.assertEqual(self.promote(initialize=True)["state"], "accepted")
        self.target.updates.clear()
        self.before = self.plan["before"]
        self.after = self.plan["after"]
        self.operations = self.state / "web-rollouts"
        self.forward = self.operations / "deploy-one.json"
        self.reverse = {**self.plan, "operationId": "emergency-" + content_hash(self.plan)[:48],
                        "before": self.after, "after": self.before}
        self.recovery = self.operations / f"{self.reverse['operationId']}.json"
        self.pointer = self.state / "accepted-web-generation.json"

    def promote(self, *, initialize=False):
        return rollout_web(self.plan, state_dir=self.state, target=self.target, initialize=initialize,
                           clock=self.clock.monotonic, sleep=self.clock.sleep)

    def restore(self, failure=lambda _slot: True, *, timeout=45, accepted_plan=None):
        return restore_failed_installed_web(self.plan, state_dir=self.state, target=self.target,
                                           observe_candidate_failure=failure, accepted_plan=accepted_plan, public_timeout=timeout,
                                           clock=self.clock.monotonic, sleep=self.clock.sleep)

    def test_stopped_B_restores_exact_A_and_uses_normal_terminal_journal(self):
        self.target.candidate_running = False
        result = self.restore(lambda _slot: self.fail("a stopped B needs no HTTP failure proof"))
        self.assertEqual(result["state"], "accepted")
        self.assertEqual(result["acceptedGeneration"], self.before["route"]["generation"])
        self.assertEqual(_read(self.pointer), _record(self.plan, self.before))
        self.assertEqual(_read(self.forward), {"plan": self.plan, "state": "accepted"})
        self.assertEqual(_read(self.recovery), {"plan": self.reverse, "state": "accepted"})
        self.assertEqual(self.restore(), result)
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_running_B_needs_repeat_definite_direct_failure(self):
        for unconfirmed in (False, None, 1):
            with self.subTest(unconfirmed=unconfirmed), self.assertRaises(SwitchHeld):
                self.restore(lambda _slot: unconfirmed)
        statuses = iter((True, False))
        with self.assertRaisesRegex(SwitchHeld, "no longer confirmed"):
            self.restore(lambda _slot: next(statuses))
        self.assertFalse(self.recovery.exists())
        self.assertFalse(self.target.updates)
        self.assertEqual(self.restore()["state"], "accepted")

    def test_restarted_exact_B_is_a_definitive_failure(self):
        self.target.plan["after"]["runtime"]["restartCount"] += 1
        self.target.verify_qualification = lambda plan, *, initialize: plan == self.plan and not initialize
        self.assertEqual(self.restore(lambda _slot: self.fail("restart already proves B failed"))["state"], "accepted")
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_retained_A_or_protected_backend_drift_prevents_any_write(self):
        self.target.old_healthy = False
        with self.assertRaisesRegex(SwitchHeld, "directly healthy"):
            self.restore()
        self.target.old_healthy = True
        self.target.backend = "b" * 64
        with self.assertRaisesRegex(SwitchConflict, "backend runtime identity"):
            self.restore()
        self.assertFalse(self.recovery.exists())
        self.assertFalse(self.target.updates)

    def test_pending_forward_or_foreign_pointer_cannot_start_emergency(self):
        original = _read(self.forward)
        pending = {**original, "state": "switch-acknowledged"}
        _write_state(self.forward, pending, previous=original)
        with self.assertRaisesRegex(SwitchConflict, "never accepted"):
            self.restore()
        _write_state(self.forward, original, previous=pending)
        pointer = _read(self.pointer)
        _write_state(self.pointer, {**pointer, "targetKey": "foreign"}, previous=pointer)
        with self.assertRaisesRegex(SwitchConflict, "Exact accepted B pointer"):
            self.restore()
        self.assertFalse(self.target.updates)

    def test_lost_ack_resumes_exact_live_A_without_another_CAS(self):
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.restore()
        self.assertEqual(_read(self.recovery)["state"], "switch-intent")
        self.assertEqual(_read(self.pointer), _record(self.plan, self.after))
        self.assertEqual(self.restore()["state"], "accepted")
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_unknown_write_with_B_live_never_retries_and_blocks_generic_write(self):
        self.target.mode = "lost-before"
        with self.assertRaises(SwitchUnknown):
            self.restore()
        with self.assertRaisesRegex(SwitchHeld, "not the exact retained"):
            self.restore()
        with self.assertRaisesRegex(SwitchConflict, "holds this target"):
            self.promote()
        self.assertEqual(self.target.updates, [self.before["route"]])
        self.assertEqual(_read(self.pointer), _record(self.plan, self.after))

    def test_public_readmission_waits_within_bound_and_preserves_sustained_check(self):
        probe = self.target.observe_health
        public_checks = []

        def delayed(slot, *, proxied):
            if proxied and slot == self.before:
                public_checks.append(self.clock.monotonic())
                if len(public_checks) <= 15:
                    raise SwitchHeld("Traefik is re-admitting restored relay")
            return probe(slot, proxied=proxied)

        self.target.observe_health = delayed
        self.assertEqual(self.restore()["state"], "accepted")
        self.assertEqual(len(public_checks), 18)
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_wait_timeout_holds_pointer_and_resumes_readback_only(self):
        probe = self.target.observe_health
        self.target.observe_health = lambda slot, *, proxied: (
            {**probe(slot, proxied=proxied), "healthy": not proxied}
        )
        with self.assertRaisesRegex(SwitchHeld, "awaiting verified"):
            self.restore(timeout=5)
        self.assertEqual(_read(self.pointer), _record(self.plan, self.after))
        self.assertEqual(_read(self.recovery)["state"], "switch-intent")
        self.target.observe_health = probe
        self.assertEqual(self.restore()["state"], "accepted")
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_acceptance_crash_between_pointer_and_journal_recovers(self):
        def lose_write(path, value, *, previous=None):
            if path == self.recovery and value["state"] == "accepted":
                raise OSError("injected before terminal receipt")
            _write_state(path, value, previous=previous)

        with patch("installed_web_emergency._write_state", side_effect=lose_write), self.assertRaises(OSError):
            self.restore()
        self.assertEqual(_read(self.pointer), _record(self.plan, self.before))
        self.assertEqual(_read(self.recovery)["state"], "switch-intent")
        self.assertEqual(self.restore()["state"], "accepted")
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_prior_prepared_state_has_no_mutation_intent_and_rechecks_failure(self):
        _write_state(self.recovery, {"plan": self.reverse, "state": "prepared"})
        with self.assertRaises(SwitchHeld):
            self.restore(lambda _slot: False)
        self.assertFalse(self.target.updates)
        self.assertEqual(self.restore()["state"], "accepted")

    def test_foreign_recovery_journal_is_never_reconciled(self):
        foreign = {**self.reverse, "qualificationSha256": "f" * 64}
        _write_state(self.recovery, {"plan": foreign, "state": "switch-intent"})
        with self.assertRaisesRegex(SwitchConflict, "not an admitted restore"):
            self.restore()
        self.assertFalse(self.target.updates)

    def reapply_plan(self):
        before = {**self.before, "route": {**self.before["route"], "fingerprint": "f" * 64}}
        return {**self.plan, "operationId": "deploy-one-reapply", "before": before}

    def test_accepted_reapply_restores_original_a_only_and_reconciles_its_own_intent(self):
        reapplied = self.reapply_plan()
        path = self.operations / f"{reapplied['operationId']}.json"
        _write_state(path, {"plan": reapplied, "state": "accepted"})
        self.target.candidate_running = False
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.restore(accepted_plan=reapplied)
        self.assertFalse(self.recovery.exists())
        with self.assertRaisesRegex(SwitchConflict, "Exact accepted B pointer and live B route"):
            self.restore()
        receipt = self.restore(accepted_plan=reapplied)
        self.assertEqual(receipt["acceptedGeneration"], self.before["route"]["generation"])
        reverse_path = self.operations / f"{receipt['operationId']}.json"
        self.assertEqual(_read(reverse_path)["plan"]["after"], self.before)
        self.assertEqual(_read(self.pointer), _record(self.plan, self.before))
        self.assertEqual(self.target.updates, [self.before["route"]])

    def test_alternate_accepted_source_must_be_exact_and_terminal(self):
        reapplied = self.reapply_plan()
        for changes in ({"targetKey": "other"}, {"backendFingerprint": "9" * 64}, {"qualificationSha256": "9" * 64},
                        {"before": {**reapplied["before"], "runtime": {**self.before["runtime"], "configSha256": "9" * 64}}},
                        {"after": {**self.after, "route": {**self.after["route"], "fingerprint": "9" * 64}}}):
            with self.subTest(changes=changes), self.assertRaisesRegex(SwitchConflict, "admitted runtime pair"):
                self.restore(accepted_plan=reapplied | changes)
        pending = self.operations / f"{reapplied['operationId']}.json"
        _write_state(pending, {"plan": reapplied, "state": "switch-acknowledged"})
        with self.assertRaisesRegex(SwitchConflict, "never accepted"):
            self.restore(accepted_plan=reapplied)
        self.assertFalse(self.target.updates)

    def test_wrong_public_runtime_and_unqualified_restart_never_accept(self):
        probe = self.target.observe_health
        self.target.observe_health = lambda slot, *, proxied: (
            {**probe(slot, proxied=proxied), "runtimeId": self.after["runtime"]["runtimeId"]}
            if proxied else probe(slot, proxied=proxied)
        )
        with self.assertRaisesRegex(SwitchConflict, "exact retained runtime"):
            self.restore()
        self.assertEqual(_read(self.pointer), _record(self.plan, self.after))
        self.target.qualifies = False
        self.target.observe_health = probe
        with self.assertRaisesRegex(SwitchConflict, "authority"):
            self.restore()
        self.assertEqual(self.target.updates, [self.before["route"]])


if __name__ == "__main__":
    unittest.main()
