import copy
from pathlib import Path
import tempfile
import unittest

from test_web_switch import FakeClock, runtime
from web_rollout import rollout_web
from web_switch import DefiniteRejected, SwitchConflict, SwitchHeld, SwitchUnknown, _read


def slot(number, image, revision):
    item = runtime(number, f"web-{number}")
    item.update(imageId="sha256:" + image * 64, sourceRevision=revision * 40)
    return {"runtime": item, "route": {"runtimeId": item["runtimeId"], "generation": "wd-" + revision * 40,
                                      "fingerprint": number * 64}}


class Target:
    def __init__(self, plan):
        self.plan = copy.deepcopy(plan)
        self.route = plan["before"]["route"]
        self.backend = plan["backendFingerprint"]
        self.qualifies = True
        self.initializes = True
        self.candidate_ready = True
        self.candidate_healthy = True
        self.old_healthy = True
        self.candidate_running = True
        self.mode = None
        self.updates = []

    def verify_qualification(self, plan, *, initialize):
        return self.qualifies and (not initialize or self.initializes) and plan == self.plan

    def inspect(self, plan):
        after = {**self.plan["after"]["runtime"], "running": self.candidate_running}
        return {"beforeRuntime": self.plan["before"]["runtime"], "afterRuntime": after,
                "backendFingerprint": self.backend, "route": self.route}

    def observe_health(self, slot, *, proxied):
        healthy = (self.old_healthy if slot == self.plan["before"] else
                   self.candidate_healthy if proxied else self.candidate_ready)
        return {"healthy": healthy, "generation": slot["route"]["generation"],
                "runtimeId": slot["runtime"]["runtimeId"]}

    def compare_and_swap_route(self, expected, desired):
        if self.route != expected or self.mode == "reject":
            raise DefiniteRejected("route CAS refused")
        self.updates.append(desired)
        if self.mode == "lost-before":
            raise TimeoutError
        self.route = desired
        if self.mode == "lost-after" or (self.mode == "lost-rollback" and len(self.updates) == 2):
            raise TimeoutError


class WebRolloutTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.state = Path(scratch.name) / "target"
        self.clock = FakeClock()
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deploy-one",
                     "targetKey": "fixture", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        self.target = Target(self.plan)

    def run_rollout(self, plan=None, *, initialize=True):
        return rollout_web(plan or self.plan, state_dir=self.state, target=self.target,
                           initialize=initialize, clock=self.clock.monotonic, sleep=self.clock.sleep)

    def accepted(self):
        return _read(self.state / "accepted-web-generation.json")["slot"]

    def test_accepts_a_different_image_once_and_allows_qualified_reverse_rollout(self):
        first = self.run_rollout()
        self.assertEqual(first["state"], "accepted")
        self.assertEqual(self.accepted(), self.plan["after"])
        self.assertEqual(self.run_rollout(), first)
        self.assertEqual(self.target.updates, [self.plan["after"]["route"]])
        reverse = {**self.plan, "operationId": "restore-one", "before": self.plan["after"], "after": self.plan["before"]}
        self.target.plan = reverse
        self.assertEqual(self.run_rollout(reverse)["state"], "accepted")
        self.assertEqual(self.accepted(), self.plan["before"])

    def test_rejects_unready_candidate_before_touching_ingress(self):
        self.target.candidate_ready = False
        self.assertEqual(self.run_rollout()["state"], "rejected")
        self.assertEqual(self.target.updates, [])
        self.assertEqual(self.accepted(), self.plan["before"])

    def test_rejects_missing_qualification_or_backend_drift_before_any_write(self):
        self.target.qualifies = False
        with self.assertRaises(SwitchConflict):
            self.run_rollout()
        self.target.qualifies = True
        self.target.backend = "0" * 64
        with self.assertRaises(SwitchConflict):
            self.run_rollout()
        self.assertFalse((self.state / "accepted-web-generation.json").exists())
        self.assertEqual(self.target.updates, [])

    def test_durably_intends_switch_then_rolls_back_a_definite_health_failure(self):
        self.target.candidate_healthy = False
        update = self.target.compare_and_swap_route

        def checked(before, after):
            journal = _read(self.state / "web-rollouts" / "deploy-one.json")
            self.assertEqual(journal["state"], "rollback-intent" if self.target.updates else "switch-intent")
            update(before, after)

        self.target.compare_and_swap_route = checked
        self.assertEqual(self.run_rollout()["state"], "rolled-back")
        self.assertEqual(self.target.updates, [self.plan["after"]["route"], self.plan["before"]["route"]])
        self.assertEqual(self.accepted(), self.plan["before"])
        self.assertEqual(self.run_rollout()["state"], "rolled-back")
        self.assertEqual(len(self.target.updates), 2)

    def test_lost_acknowledgement_never_repeats_write_and_reconciles_exact_healthy_route(self):
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.run_rollout()
        self.assertEqual(self.accepted(), self.plan["before"])
        self.assertEqual(self.run_rollout()["state"], "accepted")
        self.assertEqual(len(self.target.updates), 1)

    def test_unknown_switch_cannot_rollback_or_open_a_second_operation(self):
        self.target.mode = "lost-after"
        self.target.candidate_healthy = False
        with self.assertRaises(SwitchUnknown):
            self.run_rollout()
        with self.assertRaises(SwitchHeld):
            self.run_rollout()
        other = {**self.plan, "operationId": "deploy-two"}
        self.target.plan = other
        with self.assertRaises(SwitchConflict):
            self.run_rollout(other)
        self.assertEqual(len(self.target.updates), 1)

    def test_reconciles_rollback_acknowledgement_loss_without_a_second_rollback(self):
        self.target.mode = "lost-rollback"
        self.target.candidate_healthy = False
        with self.assertRaises(SwitchUnknown):
            self.run_rollout()
        self.assertEqual(self.run_rollout()["state"], "rolled-back")
        self.assertEqual(self.accepted(), self.plan["before"])
        self.assertEqual(len(self.target.updates), 2)

    def test_a_stopped_candidate_preserves_identity_and_triggers_confirmed_rollback(self):
        update = self.target.compare_and_swap_route

        def stop_candidate(expected, desired):
            update(expected, desired)
            if desired == self.plan["after"]["route"]:
                self.target.candidate_running = False

        self.target.compare_and_swap_route = stop_candidate
        self.assertEqual(self.run_rollout()["state"], "rolled-back")
        self.assertEqual(self.accepted(), self.plan["before"])
        self.assertEqual(len(self.target.updates), 2)

    def test_missing_state_requires_authenticated_first_use(self):
        with self.assertRaises(SwitchConflict):
            self.run_rollout(initialize=False)
        self.target.initializes = False
        with self.assertRaises(SwitchConflict):
            self.run_rollout()
        self.assertEqual(self.target.updates, [])

    def test_uncommitted_staging_bytes_are_removed_on_observation_only_resume(self):
        self.target.mode = "lost-after"
        with self.assertRaises(SwitchUnknown):
            self.run_rollout()
        staged = self.state / "web-rollouts" / ".web-rollout-1234abcd.tmp"
        staged.write_text("partial")
        staged.chmod(0o600)
        self.assertEqual(self.run_rollout(initialize=False)["state"], "accepted")
        self.assertFalse(staged.exists())
        self.assertEqual(len(self.target.updates), 1)
