"""Exercise the installed Caddy adapter with the actual rollout controller."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from caddy_web_config import _generation_handler, compile_successor_web_configs
from installed_web_target import InstalledWebTarget
from test_web_rollout import slot
from test_web_switch import FakeClock
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import rollout_web
from web_switch import DefiniteRejected, SwitchConflict, SwitchHeld, SwitchUnknown, canonical, content_hash


def compiled_documents():
    host, peer = "crm.pitant.de", "10.0.8.2"
    before = WebGeneration("wd-" + "a" * 40, "app")
    after = WebGeneration("wd-" + "b" * 40, "candidate-alias")
    raw = canonical(_caddy_config(host, peer + "/32", compile_web_generation_routes(current=before)))
    return compile_successor_web_configs(
        raw, expected_sha256=sha256(raw).hexdigest(), host=host, traefik_ip=peer,
        installed_relay_alias="warpdrive-web-relay-" + "1" * 12,
        successor_relay_alias="warpdrive-web-relay-" + "2" * 12, current=before, candidate=after,
    )


class Admin:
    def __init__(self, before):
        self.live = deepcopy(before)
        self.persisted = deepcopy(before)
        self.writes = []
        self.mode = None
        self.read_fails_once = False

    def config(self):
        if self.read_fails_once:
            self.read_fails_once = False
            raise TimeoutError("injected GET timeout")
        return deepcopy(self.live), content_hash(self.live)

    def compare_and_swap(self, expected, desired):
        if expected != self.live or self.mode == "reject":
            raise DefiniteRejected("injected stale ETag")
        self.writes.append(deepcopy(desired))
        self.live = deepcopy(desired)
        if self.mode != "autosave-missing":
            self.persisted = deepcopy(desired)
        if self.mode == "lost-ack":
            raise TimeoutError("injected lost PATCH acknowledgement")
        if self.mode == "GET-timeout":
            self.read_fails_once = True
        return deepcopy(self.live), content_hash(self.live)


class InstalledWebTargetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "target"
        self.clock = FakeClock()
        self.documents = compiled_documents()
        self.admin = Admin(self.documents["successorA"])
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deploy-one",
                     "targetKey": "installed", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        for side, key in (("before", "successorA"), ("after", "successorB")):
            self.plan[side]["route"]["fingerprint"] = content_hash(self.documents[key])
        self.pins = deepcopy(self.plan)
        self.observed = {"beforeRuntime": deepcopy(self.pins["before"]["runtime"]),
                         "afterRuntime": deepcopy(self.pins["after"]["runtime"]),
                         "backendFingerprint": self.pins["backendFingerprint"]}
        self.admitted = True
        self.candidate_healthy = True
        self.target = self.build_target()

    def build_target(self, **overrides):
        options = {"admin": self.admin, "documents": self.documents, "verify_release": self.verify_release,
                   "observe_runtimes": lambda: self.observed, "probe_health": self.probe_health,
                   "read_durable_config": lambda: self.admin.persisted}
        return InstalledWebTarget(self.plan, **{**options, **overrides})

    def verify_release(self, plan, *, initialize):
        return self.admitted and plan == self.pins and type(initialize) is bool

    def probe_health(self, slot, *, proxied):
        if proxied:
            before = self.admin.live == self.documents["successorA"]
            slot = self.pins["before" if before else "after"]
        return {"generation": slot["route"]["generation"], "runtimeId": slot["runtime"]["runtimeId"],
                "healthy": self.candidate_healthy if proxied and slot == self.pins["after"] else True}

    def run_rollout(self, *, initialize=False):
        return rollout_web(self.pins, state_dir=self.state, target=self.target, initialize=initialize,
                           clock=self.clock.monotonic, sleep=self.clock.sleep)

    def test_controller_accepts_and_repeated_invocation_only_observes(self):
        accepted = self.run_rollout(initialize=True)
        self.assertEqual(accepted["state"], "accepted")
        self.assertEqual(self.run_rollout(), accepted)
        self.assertEqual(self.admin.writes, [self.documents["successorB"]])

    def test_qualification_is_external_and_requires_exact_baseline_for_first_use(self):
        self.admitted = False
        with self.assertRaisesRegex(SwitchConflict, "qualification"):
            self.run_rollout(initialize=True)
        self.admitted = True
        self.admin.live = self.admin.persisted = self.documents["successorB"]
        with self.assertRaisesRegex(SwitchConflict, "qualification"):
            self.run_rollout(initialize=True)
        self.assertFalse(self.admin.writes)

    def test_canonical_readback_and_pins_are_independent_of_caller_mutation(self):
        self.plan["before"]["runtime"]["restartCount"] = 99
        self.documents["successorA"].clear()
        current = self.target.inspect(self.pins)
        current["route"]["generation"] = "modified"
        current["beforeRuntime"]["running"] = False
        self.assertEqual(self.target.inspect(self.pins)["route"], self.pins["before"]["route"])
        self.assertEqual(self.target.inspect(self.pins)["beforeRuntime"], self.pins["before"]["runtime"])

    def test_unqualified_fingerprints_non_web_changes_and_admin_changes_are_rejected(self):
        self.plan["before"]["route"]["fingerprint"] = "f" * 64
        with self.assertRaisesRegex(SwitchConflict, "fingerprints"):
            self.build_target()
        self.plan = deepcopy(self.pins)
        for key, value in (("logging", {}), ("admin", {"listen": "0.0.0.0:2019"})):
            with self.subTest(key=key):
                documents = deepcopy(self.documents)
                documents["successorB"][key] = value
                self.plan["after"]["route"]["fingerprint"] = content_hash(documents["successorB"])
                with self.assertRaisesRegex(SwitchConflict, "private admin and non-Web"):
                    self.build_target(documents=documents)

    def test_rejects_changed_generation_policy_even_with_matching_plan_digest(self):
        documents = deepcopy(self.documents)
        _generation_handler(documents["successorB"])["routes"].pop(1)
        self.plan["after"]["route"]["fingerprint"] = content_hash(documents["successorB"])
        with self.assertRaisesRegex(SwitchConflict, "private admin and non-Web"):
            self.build_target(documents=documents)

    def test_ambiguous_write_reconciles_only_with_exact_durable_config(self):
        self.admin.mode = "autosave-missing"
        with self.assertRaises(SwitchUnknown):
            self.run_rollout(initialize=True)
        with self.assertRaises(SwitchHeld):
            self.run_rollout()
        self.assertEqual(len(self.admin.writes), 1)
        self.admin.persisted = self.documents["successorB"]
        self.assertEqual(self.run_rollout()["state"], "accepted")
        self.assertEqual(len(self.admin.writes), 1)

    def test_lost_patch_ack_or_temporary_read_failure_never_replays_write(self):
        for mode in ("lost-ack", "GET-timeout"):
            with self.subTest(mode=mode):
                self.admin.mode = mode
                self.admin.writes.clear()
                self.admin.live = self.admin.persisted = self.documents["successorA"]
                self.state = Path(self.temp.name) / mode
                with self.assertRaises(SwitchUnknown):
                    self.run_rollout(initialize=True)
                self.assertEqual(self.run_rollout()["state"], "accepted")
                self.assertEqual(len(self.admin.writes), 1)

    def test_unsupported_live_document_and_false_health_identity_hold(self):
        self.admin.live = self.admin.persisted = {"unexpected": True}
        with self.assertRaises(SwitchHeld):
            self.target.inspect(self.pins)
        wrong = {"generation": self.pins["before"]["route"]["generation"],
                 "runtimeId": self.pins["after"]["runtime"]["runtimeId"], "healthy": True}
        target = self.build_target(probe_health=lambda _slot, **_options: wrong)
        with self.assertRaisesRegex(SwitchConflict, "exact observed Web runtime"):
            target.observe_health(self.pins["before"], proxied=True)
        self.assertFalse(self.admin.writes)

    def test_exact_protected_backend_and_both_runtime_configs_required_before_write(self):
        for key, mutation in (
            ("backendFingerprint", "d" * 64),
            ("beforeRuntime", {**self.pins["before"]["runtime"], "configSha256": "d" * 64}),
            ("afterRuntime", {**self.pins["after"]["runtime"], "configSha256": "d" * 64}),
        ):
            with self.subTest(key=key):
                original, self.observed[key] = self.observed[key], mutation
                with self.assertRaises(SwitchConflict):
                    self.target.compare_and_swap_route(self.pins["before"]["route"], self.pins["after"]["route"])
                self.observed[key] = original
        self.assertFalse(self.admin.writes)

    def test_confirmed_unhealthy_candidate_allows_only_exact_reverse_cas(self):
        self.candidate_healthy = False
        self.assertEqual(self.run_rollout(initialize=True)["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.documents["successorB"], self.documents["successorA"]])
        self.assertEqual(self.admin.live, self.admin.persisted)

    def test_candidate_stopping_after_write_preserves_exact_reverse_eligibility(self):
        write = self.admin.compare_and_swap

        def stop_candidate(expected, desired):
            result = write(expected, desired)
            if desired == self.documents["successorB"]:
                self.observed["afterRuntime"]["running"] = False
            return result

        self.admin.compare_and_swap = stop_candidate
        self.assertEqual(self.run_rollout(initialize=True)["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.documents["successorB"], self.documents["successorA"]])

    def test_definite_rejection_and_candidate_restart_before_forward_are_no_write(self):
        self.observed["afterRuntime"]["restartCount"] += 1
        with self.assertRaises(DefiniteRejected):
            self.target.compare_and_swap_route(self.pins["before"]["route"], self.pins["after"]["route"])
        self.observed["afterRuntime"]["restartCount"] -= 1
        self.admin.mode = "reject"
        self.assertEqual(self.run_rollout(initialize=True)["state"], "rejected")
        self.assertFalse(self.admin.writes)


if __name__ == "__main__":
    unittest.main()
