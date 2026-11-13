"""Exercise repeat Web routing with the real installed target and journal controller."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from installed_web_repeat import InstalledWebRepeat
from test_caddy_web_repeat import A, B, C, HOST, PEER, RELAY, compile_next, installed_after_first_switch
from test_installed_web_target import Admin
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, SwitchHeld, SwitchUnknown, _read, canonical, content_hash


class InstalledWebRepeatTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.state = Path(scratch.name).resolve() / "target"
        self.clock = FakeClock()
        self.installed = installed_after_first_switch()
        self.documents = compile_next(self.installed)
        self.admin = Admin(self.installed)
        before, after, candidate = slot("1", "a", "a"), slot("2", "b", "b"), slot("3", "c", "c")
        after["route"]["fingerprint"] = content_hash(self.installed)
        after["runtime"]["name"], candidate["runtime"]["name"] = B.target, C.target
        self.prior = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "first-web-reapply", "targetKey": "installed",
                      "backendFingerprint": "d" * 64, "qualificationSha256": "e" * 64, "before": before, "after": after}
        result = rollout_web(self.prior, state_dir=self.state, target=Target(self.prior), initialize=True,
                            clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.assertEqual(result["state"], "accepted")
        self.backend = self.prior["backendFingerprint"]
        self.chain = {"targetKey": self.prior["targetKey"], "backendFingerprint": self.backend,
                      "acceptedOperationId": self.prior["operationId"], "acceptedPlanSha256": content_hash(self.prior),
                      "active": {"slot": after, "alias": B.target, "provenance": {}, "receiptSha256": "a" * 64},
                      "previous": {"slot": before, "alias": A.target, "provenance": {}, "receiptSha256": "b" * 64}}
        self.raw = canonical(self.installed) + b"\n"
        self.candidate = candidate["runtime"]
        self.runtimes = {generation.deployment_id: deepcopy(entry["runtime"])
                         for generation, entry in ((A, before), (B, after), (C, candidate))}
        self.healthy = True
        self.retained_healthy = True
        self.definite_failure = None
        self.authorized = True
        self.controller = self.build()

    def build(self, **changes):
        options = {"admitted_chain": self.chain, "expected_chain_sha256": content_hash(self.chain), "installed_bytes": self.raw,
                   "expected_installed_sha256": sha256(self.raw).hexdigest(), "host": HOST, "traefik_ip": PEER, "relay_alias": RELAY,
                   "candidate_runtime": self.candidate, "candidate_alias": C.target, "qualification_sha256": "f" * 64,
                   "admin": self.admin, "verify_release": lambda _plan, *, initialize: self.authorized and not initialize,
                   "observe_installed": lambda: {"backendFingerprint": self.backend, "runtimes": deepcopy(self.runtimes)},
                   "probe_health": self.health, "read_durable_config": lambda: self.admin.persisted,
                   "observe_candidate_failure": lambda slot: self.definite_failure if slot["route"]["generation"] == C.deployment_id else None}
        return InstalledWebRepeat(self.state, **(options | changes))

    def health(self, slot, *, proxied):
        generation = slot["route"]["generation"]
        if proxied:
            active = C.deployment_id if self.admin.live == self.documents["after"] else B.deployment_id
            self.assertEqual(active, generation)
        return {"generation": generation, "runtimeId": slot["runtime"]["runtimeId"],
                "healthy": self.healthy if generation == C.deployment_id and proxied else self.retained_healthy}

    def act(self, action):
        return self.controller.run(action, clock=self.clock.monotonic, sleep=self.clock.sleep)

    def assert_pointer(self, action):
        plan = self.controller.plan(action)
        self.assertEqual(_read(self.state / "accepted-web-generation.json"), _record(plan, plan["after"]))

    def test_forward_healthy_rollback_reapply_and_terminal_reconciliation(self):
        for action, document, generation in (("promote", "after", C), ("rollback", "manualRollback", B), ("reapply", "after", C)):
            result = self.act(action)
            self.assertEqual(result["acceptedGeneration"], generation.deployment_id)
            self.assertEqual(result["state"], "accepted")
            self.assertEqual(self.act(action), result)
            self.assertEqual(self.admin.live, self.documents[document])
            self.assert_pointer(action)
        self.assertEqual(self.admin.writes, [self.documents[key] for key in ("after", "manualRollback", "after")])

    def test_candidate_lost_ack_then_confirmed_failure_restores_exact_b_plus_a_once(self):
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.act("promote")
        self.admin.mode = None
        with self.assertRaisesRegex(SwitchHeld, "failure is unverified"):
            self.act("recover")
        self.definite_failure = True
        recovery = self.act("recover")
        self.assertEqual(recovery["state"], "rolled-back")
        self.assertEqual(self.act("recover"), recovery)
        self.assertEqual(self.admin.writes, [self.documents["after"], self.installed])
        self.assertEqual(_read(self.state / "accepted-web-generation.json"), _record(self.prior, self.prior["after"]))

    def test_acknowledged_unhealthy_candidate_is_compensated_to_b_plus_a(self):
        self.healthy = False
        result = self.act("promote")
        self.assertEqual(result["state"], "rolled-back")
        self.assertEqual(result["acceptedGeneration"], B.deployment_id)
        self.assertEqual(self.admin.writes, [self.documents["after"], self.installed])

    def test_stopped_candidate_with_changed_identity_cannot_authorize_recovery(self):
        self.act("promote")
        self.runtimes[C.deployment_id].update(running=False, imageId="sha256:" + "f" * 64)
        with self.assertRaisesRegex(SwitchConflict, "candidate Web artifact identity"):
            self.act("recover")
        self.assertEqual(self.admin.writes, [self.documents["after"]])

    def test_accepted_reapply_failure_restores_exact_b_plus_a(self):
        for action in ("promote", "rollback", "reapply"):
            self.act(action)
        self.runtimes[C.deployment_id]["running"] = False
        recovery = self.act("recover-reapply")
        self.assertEqual(recovery["state"], "accepted")
        self.assertEqual(recovery["acceptedGeneration"], B.deployment_id)
        self.assertEqual(self.act("recover-reapply"), recovery)
        self.assertEqual(self.admin.writes[-1], self.installed)
        self.assertEqual(len(self.admin.writes), 4)

    def test_unaccepted_reapply_recovery_reports_retained_failed_c_stamps(self):
        for action in ("promote", "rollback"):
            self.act(action)
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.act("reapply")
        self.admin.mode = None
        self.definite_failure = True
        recovery = self.act("recover-reapply")
        self.assertEqual(recovery["state"], "rolled-back")
        self.assertIs(recovery["failedCandidateStampsRetained"], True)
        self.assertEqual(self.admin.live, self.documents["manualRollback"])
        self.assertEqual(self.act("recover-reapply"), recovery)
        self.assertEqual(len(self.admin.writes), 4)

    def failed_reapply(self):
        for action in ("promote", "rollback"):
            self.act(action)
        self.healthy = False
        result = self.act("reapply")
        self.assertTrue(result["failedCandidateStampsRetained"])
        self.assertEqual(self.admin.live, self.documents["manualRollback"])
        return self.controller.plan("reapply")["operationId"] + "-route.json"

    def test_failed_stamp_reconciliation_retains_active_b_and_restores_admitted_b_plus_a(self):
        name = self.failed_reapply()
        self.definite_failure = True
        result = self.act("reconcile-failed-stamps")
        self.assertEqual(result["acceptedGeneration"], B.deployment_id)
        self.assertIs(result["failedCandidateStampsRetained"], False)
        self.assertEqual(self.admin.live, self.installed)
        self.assertEqual(_read(self.state / "accepted-web-generation.json"), _record(self.prior, self.prior["after"]))
        self.assertEqual(_read(self.state / name)["state"], "accepted")
        self.assertFalse((self.state / "web-rollouts" / name).exists())
        self.assertEqual(self.act("reconcile-failed-stamps"), result)
        self.assertEqual(len(self.admin.writes), 5)

    def test_failed_stamp_lost_ack_blocks_other_operations_and_reconciles_without_replay(self):
        name = self.failed_reapply()
        self.runtimes[C.deployment_id]["running"] = False
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.act("reconcile-failed-stamps")
        self.assert_pointer("rollback")
        self.assertEqual(_read(self.state / "web-rollouts" / name)["state"], "switch-intent")
        with self.assertRaisesRegex(SwitchConflict, "invalid rollout journal"):
            self.act("promote")
        self.admin.mode = None
        self.assertEqual(self.act("reconcile-failed-stamps")["state"], "accepted")
        self.assertEqual(len(self.admin.writes), 5)

    def test_unknown_without_cas_effect_never_retries_the_route_change(self):
        name = self.failed_reapply()
        self.definite_failure = True
        call_count = 0

        def fail_before_cas(*_args):
            nonlocal call_count
            call_count += 1
            raise TimeoutError("injected transport loss before effect")

        self.admin.compare_and_swap = fail_before_cas
        with self.assertRaises(SwitchUnknown):
            self.act("reconcile-failed-stamps")
        with self.assertRaisesRegex(SwitchConflict, "configuration changed during health proof"):
            self.act("reconcile-failed-stamps")
        self.assertEqual(call_count, 1)
        self.assert_pointer("rollback")
        self.assertEqual(_read(self.state / "web-rollouts" / name)["state"], "switch-intent")

    def test_failed_stamp_reconciliation_requires_definite_c_and_healthy_a_b_before_writes(self):
        name = self.failed_reapply()
        with self.assertRaisesRegex(SwitchHeld, "without definite failure"):
            self.act("reconcile-failed-stamps")
        self.definite_failure = True
        self.retained_healthy = False
        with self.assertRaisesRegex(SwitchConflict, "must be healthy"):
            self.act("reconcile-failed-stamps")
        self.retained_healthy = True
        self.runtimes[C.deployment_id].update(running=False, imageId="sha256:" + "f" * 64)
        with self.assertRaisesRegex(SwitchConflict, "cannot identify the failed candidate"):
            self.act("reconcile-failed-stamps")
        self.assertFalse((self.state / "web-rollouts" / name).exists())
        self.assertEqual(len(self.admin.writes), 4)

    def test_route_only_definite_rejection_allows_a_new_explicit_attempt(self):
        name = self.failed_reapply()
        self.definite_failure = True
        self.admin.mode = "reject"
        with self.assertRaisesRegex(SwitchHeld, "without changing the accepted route"):
            self.act("reconcile-failed-stamps")
        self.assertFalse((self.state / "web-rollouts" / name).exists())
        self.assert_pointer("rollback")
        self.admin.mode = None
        self.assertEqual(self.act("reconcile-failed-stamps")["state"], "accepted")
        self.assertEqual(len(self.admin.writes), 5)

    def test_wrong_lineage_protected_state_autosave_and_retained_a_hold_without_writes(self):
        with self.assertRaisesRegex(SwitchConflict, "lineage required"):
            self.build(expected_chain_sha256="f" * 64)
        self.runtimes[A.deployment_id]["restartCount"] += 1
        with self.assertRaisesRegex(SwitchConflict, "retained Web runtime changed"):
            self.act("promote")
        self.runtimes[A.deployment_id]["restartCount"] -= 1
        self.admin.persisted = self.documents["manualRollback"]
        with self.assertRaises(SwitchHeld):
            self.act("promote")
        self.admin.persisted = self.installed
        self.backend = "f" * 64
        with self.assertRaisesRegex(SwitchConflict, "protected backend readback"):
            self.act("promote")
        self.assertEqual(self.admin.writes, [])

    def test_compiler_binds_to_accepted_predecessor_and_unrelated_pending_journal_holds(self):
        operations = self.state / "web-rollouts"
        path = operations / (self.prior["operationId"] + ".json")
        journal = _read(path)
        pending = {**journal, "state": "switch-intent"}
        _write_state(path, pending, previous=journal)
        with self.assertRaisesRegex(SwitchConflict, "qualification is unavailable"):
            self.act("promote")
        _write_state(path, journal, previous=pending)
        _write_state(operations / "foreign-pending.json", {"plan": {**self.prior, "operationId": "foreign-pending"}, "state": "switch-intent"})
        with self.assertRaisesRegex(SwitchConflict, "another or invalid Web rollout"):
            self.act("promote")
        self.assertEqual(self.admin.writes, [])
