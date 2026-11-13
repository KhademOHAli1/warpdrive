"""Exercise real file replacement with independently supplied live observations."""

from dataclasses import replace
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_traefik_web_handoff import OLD, handoff, installed_overlay
from traefik_web_handoff_state import (
    HandoffConflict, HandoffHeld, HandoffObservation, JOURNAL_FILE, ROUTE_FILE,
    apply_traefik_web_handoff, verify_accepted_traefik_web_handoff,
)


BEFORE = HandoffObservation("before", "before", True, True, True)
AFTER = HandoffObservation("after", "after", True, True, True)
FAILED_AFTER = replace(AFTER, public_healthy=False)


class TraefikWebHandoffStateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        directory = Path(temp.name).resolve()
        self.watched = directory / "watched"
        self.state = directory / "state"
        self.watched.mkdir(mode=0o700)
        self.state.mkdir(mode=0o700)
        self.route = self.watched / ROUTE_FILE
        self.journal = self.state / JOURNAL_FILE
        self.plan = handoff(json.dumps(installed_overlay(OLD), indent=2).encode() + b"\n")
        # The installed operator's initial watched file shares its source inode.
        self.source = directory / "sealed-source"
        self.source.write_bytes(self.plan.before_document)
        self.source.chmod(0o644)
        self.route.hardlink_to(self.source)

    def apply(self, observe, **options):
        return apply_traefik_web_handoff(self.plan, watched_dir=self.watched, state_dir=self.state,
                                        observe=observe, **options)

    def journal_state(self):
        return json.loads(self.journal.read_bytes())["state"]

    def live_matching_file(self):
        return BEFORE if self.route.read_bytes() == self.plan.before_document else AFTER

    def test_intent_precedes_atomic_replace_and_repeat_only_observes(self):
        replace_file = os.replace
        route_writes = []

        def witness(source, target, **kwargs):
            if target == ROUTE_FILE:
                self.assertEqual(self.journal_state(), "switch-intent")
                self.assertEqual(self.route.read_bytes(), self.plan.before_document)
                self.assertTrue(source.endswith(".tmp"))
                self.assertEqual(kwargs["src_dir_fd"], kwargs["dst_dir_fd"])
                route_writes.append(target)
            return replace_file(source, target, **kwargs)

        with patch("traefik_web_handoff_state.os.replace", side_effect=witness):
            result = self.apply(self.live_matching_file)
            self.assertEqual(self.apply(self.live_matching_file), result)
        self.assertEqual(route_writes, [ROUTE_FILE])
        self.assertEqual(result["state"], "accepted")
        self.assertEqual(result["activeSha256"], self.plan.after_sha256)
        self.assertEqual(self.source.read_bytes(), self.plan.before_document)
        self.assertEqual(self.route.read_bytes(), self.plan.after_document)
        self.assertEqual(self.journal.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.route.stat().st_mode & 0o777, 0o644)
        self.assertEqual(sorted(path.name for path in self.watched.iterdir()), [ROUTE_FILE])

    def test_file_write_is_not_live_activation_and_mixed_hops_hold(self):
        for proof in (BEFORE, replace(AFTER, unsafe_hop="before"), replace(AFTER, websocket_healthy=None)):
            with self.subTest(proof=proof), self.assertRaises(HandoffHeld):
                self.apply(lambda: BEFORE if self.route.read_bytes() == self.plan.before_document else proof)
            self.assertEqual(self.journal_state(), "switch-acknowledged")
            self.assertEqual(self.route.read_bytes(), self.plan.after_document)
        self.assertEqual(self.apply(lambda: AFTER)["state"], "accepted")

    def test_readback_requires_both_accepted_journal_and_exact_route(self):
        def readback():
            verify_accepted_traefik_web_handoff(self.plan, watched_dir=self.watched, state_dir=self.state)

        with self.assertRaises(HandoffConflict):
            readback()
        with self.assertRaises(HandoffHeld):
            self.apply(lambda: BEFORE)
        with self.assertRaises(HandoffConflict):
            readback()
        self.apply(lambda: AFTER)
        with patch("traefik_web_handoff_state.os.replace", side_effect=AssertionError("unexpected write")):
            readback()
        self.route.write_bytes(self.plan.before_document)
        with self.assertRaises(HandoffConflict):
            readback()

    def test_lost_ack_reconciles_exact_desired_state_without_replacing(self):
        replace_file = os.replace

        def lost_ack(source, target, **kwargs):
            replace_file(source, target, **kwargs)
            if target == ROUTE_FILE:
                raise OSError("injected loss after atomic replacement")

        with patch("traefik_web_handoff_state.os.replace", side_effect=lost_ack), self.assertRaises(OSError):
            self.apply(self.live_matching_file)
        self.assertEqual(self.journal_state(), "switch-intent")
        with patch("traefik_web_handoff_state.os.replace", wraps=replace_file) as observed:
            with self.assertRaises(HandoffHeld):
                self.apply(lambda: FAILED_AFTER, retained_before_healthy=lambda: True)
            self.assertEqual(self.apply(lambda: AFTER)["state"], "accepted")
        self.assertEqual([call.args[1] for call in observed.call_args_list], [JOURNAL_FILE])

    def test_intent_with_original_file_never_replays(self):
        replace_file = os.replace

        def lost_ack(source, target, **kwargs):
            if target == ROUTE_FILE:
                raise OSError("injected loss before atomic replacement")
            return replace_file(source, target, **kwargs)

        with patch("traefik_web_handoff_state.os.replace", side_effect=lost_ack), self.assertRaises(OSError):
            self.apply(self.live_matching_file)
        self.assertEqual(self.journal_state(), "switch-intent")
        with patch("traefik_web_handoff_state.os.replace", side_effect=AssertionError("unexpected write")):
            with self.assertRaises(HandoffHeld):
                self.apply(lambda: BEFORE)
        self.assertEqual(self.route.read_bytes(), self.plan.before_document)

    def test_confirmed_successor_failure_restores_exact_preimage(self):
        def observe():
            return BEFORE if self.route.read_bytes() == self.plan.before_document else FAILED_AFTER

        with self.assertRaises(HandoffHeld):
            self.apply(observe, retained_before_healthy=lambda: False)
        self.assertEqual(self.journal_state(), "switch-acknowledged")
        result = self.apply(observe, retained_before_healthy=lambda: True)
        self.assertEqual(result["state"], "rolled-back")
        self.assertEqual(result["activeSha256"], self.plan.before_sha256)
        self.assertEqual(self.route.read_bytes(), self.plan.before_document)
        with patch("traefik_web_handoff_state.os.replace", side_effect=AssertionError("unexpected write")):
            self.assertEqual(self.apply(lambda: BEFORE), result)

    def test_lost_rollback_ack_reconciles_once(self):
        replace_file = os.replace

        def lose_rollback_ack(source, target, **kwargs):
            replace_file(source, target, **kwargs)
            if target == ROUTE_FILE and self.journal_state() == "rollback-intent":
                raise OSError("injected rollback acknowledgement loss")

        def observe():
            return BEFORE if self.route.read_bytes() == self.plan.before_document else FAILED_AFTER

        with patch("traefik_web_handoff_state.os.replace", side_effect=lose_rollback_ack), self.assertRaises(OSError):
            self.apply(observe, retained_before_healthy=lambda: True)
        self.assertEqual(self.journal_state(), "rollback-intent")
        with patch("traefik_web_handoff_state.os.replace", wraps=replace_file) as observed:
            with self.assertRaises(HandoffHeld):
                self.apply(lambda: AFTER)
            self.assertEqual(self.apply(lambda: BEFORE)["state"], "rolled-back")
        self.assertEqual([call.args[1] for call in observed.call_args_list], [JOURNAL_FILE])

    def test_peer_drift_and_unknown_health_prohibit_compensation(self):
        for proof in (replace(FAILED_AFTER, peers_unchanged=False), replace(FAILED_AFTER, websocket_healthy=False),
                      replace(FAILED_AFTER, public_healthy=None)):
            with self.subTest(proof=proof), self.assertRaises(HandoffHeld):
                self.apply(lambda: BEFORE if self.route.read_bytes() == self.plan.before_document else proof,
                           retained_before_healthy=lambda: self.fail("rollback precondition was missing"))
        self.assertEqual(self.route.read_bytes(), self.plan.after_document)

    def test_refuses_drift_in_preimage_during_live_observation(self):
        def observe():
            self.route.write_bytes(self.plan.before_document + b"\n")
            return BEFORE

        with self.assertRaisesRegex(HandoffConflict, "changed during"):
            self.apply(observe)
        self.assertFalse(self.journal.exists())

    def test_refuses_a_forged_plan_and_unowned_file_shapes(self):
        with self.assertRaisesRegex(HandoffConflict, "compiled two-URL"):
            apply_traefik_web_handoff(replace(self.plan, after_sha256="c" * 64), watched_dir=self.watched,
                                      state_dir=self.state, observe=lambda: BEFORE)
        self.state.chmod(0o755)
        with self.assertRaisesRegex(HandoffConflict, "Owner-only"):
            self.apply(lambda: BEFORE)
        self.state.chmod(0o700)
        self.route.unlink()
        self.route.symlink_to(self.source)
        with self.assertRaises(OSError):
            self.apply(lambda: BEFORE)
        self.assertFalse(self.journal.exists())

    def test_second_writer_is_locked_out_and_corrupt_journal_fails_closed(self):
        def observe():
            with self.assertRaisesRegex(HandoffConflict, "owns the handoff directory"):
                self.apply(lambda: BEFORE)
            return self.live_matching_file()

        self.assertEqual(self.apply(observe)["state"], "accepted")
        self.journal.write_bytes(self.journal.read_bytes().rstrip(b"\n"))
        with self.assertRaisesRegex(HandoffConflict, "differs from the admitted"):
            self.apply(lambda: AFTER)


if __name__ == "__main__":
    unittest.main()
