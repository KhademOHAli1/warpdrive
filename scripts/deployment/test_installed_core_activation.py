"""Verify initial Core policy admission and one-shot journaled route reconciliation."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from caddy_core_config import core_api_routes
from caddy_web_config import _generation_handler
from installed_core_activation import compile_initial_core_route, reconcile_initial_core_route, reverse_initial_core_route
from installed_web_chain import REPOSITORY, _admit_journals, _state
from installed_web_stage import write_record
from test_caddy_web_repeat import A, B, HOST, PEER, RELAY, installed_after_first_switch
from test_installed_web_target import Admin
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import DefiniteRejected, SwitchConflict, SwitchHeld, SwitchUnknown, _envelope, canonical, content_hash


class InstalledCoreActivationTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.original, self.state = root / "original", root / "state"
        self.original.mkdir(mode=0o700)
        (self.original / "production-operation.lock").touch(mode=0o600)
        self.before = installed_after_first_switch()
        self.after = deepcopy(self.before)
        self.alias = "warpdrive-core-fixture"
        _generation_handler(self.after)["routes"][1:1] = core_api_routes(self.alias, B, A)
        before, after = slot("1", "a", "a"), slot("2", "b", "b")
        after["route"]["fingerprint"] = content_hash(self.before)
        self.predecessor = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "first-reapply",
                            "targetKey": "installed", "before": before, "after": after,
                            "backendFingerprint": "a" * 64, "qualificationSha256": "b" * 64}
        self.clock = FakeClock()
        rollout_web(self.predecessor, state_dir=self.state, target=Target(self.predecessor), initialize=True,
                    clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.pointer = _record(self.predecessor, after)
        def generation(slot, web, marker):
            return {"slot": slot, "alias": web.target, "receiptSha256": marker * 64,
                    "provenance": {"repository": REPOSITORY, "revision": slot["runtime"]["sourceRevision"],
                                   "manifestSha256": marker * 64, "archiveSha256": marker * 64,
                                   "testedConfigDigest": slot["runtime"]["imageId"], "authoritySha256": marker * 64}}
        self.chain = {"targetKey": "installed", "backendFingerprint": "a" * 64, "acceptedOperationId": "first-reapply",
                      "acceptedPlanSha256": content_hash(self.predecessor), "active": generation(after, B, "b"),
                      "previous": generation(before, A, "a")}
        self.admin = Admin(self.before)
        self.live_backend, self.authority = "c" * 64, True
        self.old_backend = self.predecessor["backendFingerprint"]
        self.public_health = True
        self.public_samples = []

    def observe_public(self, document, core_active):
        self.assertEqual(self.admin.live, document)
        self.public_samples.append(core_active)
        return self.public_health

    def route_options(self):
        return {"predecessor": self.predecessor, "chain": self.chain, "expected_chain_sha256": content_hash(self.chain),
                "installed_bytes": canonical(self.before), "core_backend_fingerprint": "c" * 64,
                "core_authority_sha256": "d" * 64, "host": HOST, "traefik_ip": PEER, "relay_alias": RELAY,
                "core_alias": self.alias, "admin": self.admin, "read_durable_config": lambda: self.admin.persisted,
                "verify_authority": lambda _: self.authority, "observe_public": self.observe_public,
                "clock": self.clock.monotonic, "sleep": self.clock.sleep}

    def run_activation(self, **overrides):
        options = self.route_options() | {"observe_core": lambda: self.live_backend}
        return reconcile_initial_core_route(self.original, self.state, **(options | overrides))

    def run_reverse(self, **overrides):
        options = self.route_options() | {"observe_original_web": lambda: self.old_backend}
        return reverse_initial_core_route(self.original, self.state, **(options | overrides))

    def test_compiles_only_core_t_rpc_routes_and_rejects_unadmitted_preimage(self):
        options = {"host": HOST, "traefik_ip": PEER, "relay_alias": RELAY, "active": B, "retained": A, "core_alias": self.alias}
        actual = compile_initial_core_route(canonical(self.before), expected_sha256=content_hash(self.before), **options)
        self.assertEqual(actual, (self.before, self.after))
        for change in ({"core_alias": A.target}, {"retained": B}, {"host": "other.example.invalid"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                compile_initial_core_route(canonical(self.before), expected_sha256=content_hash(self.before), **(options | change))

    def test_lost_ack_is_read_back_once_and_blocks_ordinary_release_pending_lineage(self):
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.run_activation()
        self.assertEqual(self.admin.writes, [self.after])
        result = self.run_activation()
        self.assertEqual(self.run_activation(), result)
        self.assertEqual(result["state"], "route-verified-lineage-pending")
        self.assertEqual(self.admin.writes, [self.after])
        self.assertEqual(self.public_samples[0], False)
        self.assertGreaterEqual(len(self.public_samples), 7)
        self.assertTrue(all(self.public_samples[1:]))
        self.assertEqual(_state(self.state / "accepted-web-generation.json"), self.pointer)
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            _admit_journals(self.state / "web-rollouts", self.predecessor)

    def test_unknown_without_effect_never_retries_and_healthy_pointer_stays(self):
        attempts = []

        def fail(*args):
            attempts.append(args)
            raise TimeoutError()

        self.admin.compare_and_swap = fail
        with self.assertRaises(SwitchUnknown):
            self.run_activation()
        with self.assertRaises(SwitchHeld):
            self.run_activation()
        self.assertEqual(len(attempts), 1)
        self.assertEqual(self.admin.live, self.before)
        self.assertEqual(_state(self.state / "accepted-web-generation.json"), self.pointer)

    def test_lost_intent_publication_ack_holds_before_any_route_write(self):
        def publish_without_ack(path, value):
            write_record(path, value)
            raise OSError("intent publication acknowledgement lost")

        with patch("installed_core_activation.write_record", side_effect=publish_without_ack):
            with self.assertRaisesRegex(OSError, "acknowledgement lost"):
                self.run_activation()
        with self.assertRaises(SwitchHeld):
            self.run_activation()
        journal, = (self.state / "web-rollouts").glob("core-activation-*.json")
        self.assertEqual(journal.stat().st_nlink, 1)
        self.assertEqual(_state(journal)["state"], "switch-intent")
        self.assertEqual(self.admin.live, self.before)
        self.assertFalse(self.admin.writes)

    def test_definite_no_effect_can_be_retried_explicitly(self):
        self.admin.mode = "reject"
        with self.assertRaises(DefiniteRejected):
            self.run_activation()
        _admit_journals(self.state / "web-rollouts", self.predecessor)
        self.admin.mode = None
        self.assertEqual(self.run_activation()["routeSha256"], content_hash(self.after))
        self.assertEqual(self.admin.writes, [self.after])

    def test_unhealthy_or_changed_postimage_holds_and_does_not_fall_back(self):
        self.admin.mode = "autosave-missing"
        with self.assertRaises(SwitchHeld):
            self.run_activation()
        self.admin.persisted = self.after
        self.public_health = False
        with self.assertRaisesRegex(SwitchHeld, "retained Web health"):
            self.run_activation()
        self.public_health = True
        self.live_backend = "e" * 64
        with self.assertRaisesRegex(SwitchConflict, "activation authority differs"):
            self.run_activation()
        self.assertEqual(self.admin.writes, [self.after])

    def test_mismatched_predecessor_or_core_authority_holds_before_write(self):
        with self.assertRaisesRegex(SwitchConflict, "predecessor Web chain"):
            self.run_activation(expected_chain_sha256="f" * 64)
        self.authority = False
        with self.assertRaisesRegex(SwitchConflict, "activation authority differs"):
            self.run_activation()
        self.assertFalse(self.admin.writes)

    def test_explicit_reverse_recovers_exact_confirmed_postimage_after_lost_forward_ack(self):
        self.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            self.run_activation()
        self.live_backend = None
        self.admin.mode = None
        journal, = (self.state / "web-rollouts").glob("core-activation-*.json")
        self.assertEqual(_state(journal)["state"], "switch-intent")
        pointer = self.state / "accepted-web-generation.json"
        original = pointer.read_bytes()
        rolled_back = self.run_reverse()
        archive = self.state / (rolled_back["operationId"] + "-rolled-back.json")
        self.assertEqual(_state(archive)["state"], "rolled-back")
        self.assertEqual(rolled_back["backendFingerprint"], self.old_backend)
        self.assertEqual(rolled_back["routeSha256"], content_hash(self.before))
        self.assertEqual(self.admin.writes, [self.after, self.before])
        self.assertEqual(pointer.read_bytes(), original)
        self.assertFalse(journal.exists())
        _admit_journals(journal.parent, self.predecessor)
        self.assertEqual(self.run_reverse(), rolled_back)
        with self.assertRaisesRegex(SwitchConflict, "reversed and cannot be replayed"):
            self.run_activation()
        self.assertEqual(self.admin.writes, [self.after, self.before])

    def test_lost_reverse_ack_keeps_hold_and_retry_only_observes(self):
        operation = self.run_activation()["operationId"]
        journal = self.state / "web-rollouts" / (operation + ".json")
        self.admin.mode = "lost-ack"
        with self.assertRaisesRegex(SwitchUnknown, "reversal outcome is unknown"):
            self.run_reverse()
        self.assertEqual(self.admin.writes, [self.after, self.before])
        self.assertEqual(_state(journal)["state"], "rollback-intent")
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            _admit_journals(journal.parent, self.predecessor)
        with self.assertRaisesRegex(SwitchConflict, "Existing Core activation receipt differs"):
            self.run_activation()
        self.assertEqual(self.run_reverse()["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.after, self.before])

    def test_unknown_reverse_without_effect_never_retries(self):
        operation = self.run_activation()["operationId"]
        with patch.object(self.admin, "compare_and_swap", side_effect=TimeoutError) as switch:
            with self.assertRaises(SwitchUnknown):
                self.run_reverse()
            with self.assertRaisesRegex(SwitchHeld, "reversal route is unresolved"):
                self.run_reverse()
            switch.assert_called_once_with(self.after, self.before)
        journal = self.state / "web-rollouts" / (operation + ".json")
        self.assertEqual(_state(journal)["state"], "rollback-intent")
        self.assertFalse((self.state / (operation + "-rolled-back.json")).exists())

    def test_definite_reverse_rejection_can_be_explicitly_retried_after_no_effect_readback(self):
        operation = self.run_activation()["operationId"]
        journal = self.state / "web-rollouts" / (operation + ".json")
        self.admin.mode = "reject"
        with self.assertRaises(DefiniteRejected):
            self.run_reverse()
        self.assertEqual(_state(journal)["state"], "route-verified-lineage-pending")
        self.assertEqual(self.admin.writes, [self.after])
        self.admin.mode = None
        self.assertEqual(self.run_reverse()["state"], "rolled-back")
        self.assertEqual(self.admin.writes, [self.after, self.before])

    def test_refuses_reverse_for_missing_postimage_or_unhealthy_original_or_competing_state(self):
        operation = self.run_activation()["operationId"]
        self.admin.persisted = self.before
        with self.assertRaisesRegex(SwitchHeld, "reversal route is unresolved"):
            self.run_reverse()
        self.admin.persisted = deepcopy(self.after)
        self.admin.persisted["admin"]["config"]["persist"] = 1
        self.assertEqual(self.admin.persisted, self.after)
        with self.assertRaisesRegex(SwitchHeld, "reversal route is unresolved"):
            self.run_reverse()
        self.admin.persisted = self.after
        with self.assertRaisesRegex(SwitchHeld, "original Web backend and retained health"):
            self.run_reverse(observe_original_web=lambda: None)
        pointer = self.state / "accepted-web-generation.json"
        changed = self.pointer | {"backendFingerprint": "e" * 64}
        _write_state(pointer, changed, previous=self.pointer)
        with self.assertRaisesRegex(SwitchConflict, "requires the original accepted Web pointer"):
            self.run_reverse()
        _write_state(pointer, self.pointer, previous=changed)
        accepted = self.state / (operation + "-lineage-accepted.json")
        write_record(accepted, _envelope({"state": "accepted"}))
        with self.assertRaisesRegex(SwitchConflict, "unaccepted Core lineage"):
            self.run_reverse()
        accepted.unlink()
        another = self.state / "web-rollouts" / "another.json"
        write_record(another, _envelope({"state": "switch-intent"}))
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.run_reverse()
        self.assertEqual(self.admin.writes, [self.after])

    def test_reverse_lost_archive_ack_rechecks_restored_public_health_before_clearing(self):
        operation = self.run_activation()["operationId"]
        journal = self.state / "web-rollouts" / (operation + ".json")
        archive = self.state / (operation + "-rolled-back.json")
        self.public_health = False
        with self.assertRaisesRegex(SwitchHeld, "Restored public Web route is unresolved"):
            self.run_reverse()
        self.assertEqual(_state(journal)["state"], "rollback-intent")
        self.assertFalse(archive.exists())
        self.public_health = True

        def lose_archive_ack(path, value):
            write_record(path, value)
            raise OSError("archive acknowledgement lost")

        with patch("installed_core_activation.write_record", side_effect=lose_archive_ack):
            with self.assertRaisesRegex(OSError, "archive acknowledgement lost"):
                self.run_reverse()
        self.assertEqual(_state(journal), _state(archive))
        self.public_health = False
        with self.assertRaisesRegex(SwitchHeld, "Restored public Web route is unresolved"):
            self.run_reverse()
        self.assertTrue(journal.exists())
        self.public_health = True
        self.assertEqual(self.run_reverse()["state"], "rolled-back")
        self.assertFalse(journal.exists())
        self.assertEqual(self.admin.writes, [self.after, self.before])
