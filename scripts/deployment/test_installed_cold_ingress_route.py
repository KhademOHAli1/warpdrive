"""Exercise the installed cold ingress witness against real handoff files and locks."""

from dataclasses import replace
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import installed_cold_ingress_route as cold
from recovery import RecoveryError
from test_traefik_web_handoff import OLD, handoff, installed_overlay
from traefik_web_handoff_state import (
    HandoffHeld, HandoffObservation, JOURNAL_FILE, ROUTE_FILE, _locked_directory,
    apply_traefik_web_handoff,
)


BEFORE = HandoffObservation("before", "before", True, True, True)
AFTER = HandoffObservation("after", "after", True, True, True)


class InstalledColdIngressRouteTests(unittest.TestCase):
    def setUp(self):
        fixture = tempfile.TemporaryDirectory()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.private = root / "private"
        self.private.mkdir(mode=0o700)
        self.watched = root / "watched"
        self.watched.mkdir(mode=0o700)
        self.operation = self.private / ("first-web-release-" + "b" * 12)
        self.operation.mkdir(mode=0o700)
        self.state = self.operation / "rollout"
        self.state.mkdir(mode=0o700)
        self.baseline = self.private / "baseline-release"
        self.baseline.mkdir(mode=0o700)
        self.route = self.watched / ROUTE_FILE
        self.journal = self.state / JOURNAL_FILE
        self.source = self.baseline / cold.SEALED_ROUTE_FILE
        self.plan = handoff(json.dumps(installed_overlay(OLD), indent=2).encode() + b"\n")
        self.source.write_bytes(self.plan.before_document)
        self.source.chmod(0o644)
        self.route.hardlink_to(self.source)
        overrides = patch.multiple(cold, INSTALLED_PRIVATE_ROOT=self.private, INSTALLED_WATCHED_DIRECTORY=self.watched)
        overrides.start()
        self.addCleanup(overrides.stop)

    def apply(self, proof=AFTER):
        return apply_traefik_web_handoff(
            self.plan, watched_dir=self.watched, state_dir=self.state,
            observe=lambda: BEFORE if self.route.read_bytes() == self.plan.before_document else proof,
        )

    def observe(self, **options):
        inputs = {
            "handoff": self.plan, "watched_dir": self.watched, "state_dir": self.state,
            "expected_route_sha256": self.plan.after_sha256,
            "expected_journal_sha256": sha256(self.journal.read_bytes()).hexdigest() if self.journal.exists() else "f" * 64,
        }
        return cold.observe_installed_cold_ingress_route(**(inputs | options))

    def install_sealed_after_alias(self):
        self.source.unlink()
        self.source.hardlink_to(self.route)

    def test_returns_only_exact_accepted_route_bytes_and_file_witness_without_writes(self):
        self.assertEqual(self.apply()["state"], "accepted")
        journal_raw = self.journal.read_bytes()
        route_info = self.route.stat()
        with patch("traefik_web_handoff_state.os.replace", side_effect=AssertionError("unexpected write")):
            raw, witness = self.observe()
            self.assertEqual(self.observe(), (raw, witness))
        self.assertEqual(raw, self.plan.after_document)
        self.assertEqual(witness["routePath"], str(self.route))
        self.assertEqual(witness["routeSha256"], self.plan.after_sha256)
        self.assertEqual(witness["routeMetadata"][:2], [route_info.st_dev, route_info.st_ino])
        self.assertEqual(witness["routeMetadata"][-1], 1)
        self.assertEqual(witness["journalPath"], str(self.journal))
        self.assertEqual(witness["journalSha256"], sha256(journal_raw).hexdigest())
        self.assertIsNone(witness["sealedRoutePath"])
        self.assertEqual({path.name for path in self.watched.iterdir()}, {ROUTE_FILE})
        self.assertEqual({path.name for path in self.state.iterdir()}, {JOURNAL_FILE})
        self.assertEqual(self.journal.read_bytes(), journal_raw)
        self.assertEqual(self.source.read_bytes(), self.plan.before_document)

    def test_missing_pending_and_rollback_journals_hold(self):
        with self.assertRaisesRegex(RecoveryError, "accepted installed ingress journal"):
            self.observe()
        with self.assertRaises(HandoffHeld):
            self.apply(replace(AFTER, websocket_healthy=None))
        with self.assertRaisesRegex(RecoveryError, "accepted installed ingress journal"):
            self.observe()
        self.apply()
        journal = json.loads(self.journal.read_bytes())
        journal["state"] = "rolled-back"
        self.journal.write_bytes(json.dumps(journal, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        with self.assertRaisesRegex(RecoveryError, "accepted installed ingress journal"):
            self.observe()

    def test_independent_digest_and_watched_directory_binding_hold(self):
        self.apply()
        with self.assertRaisesRegex(RecoveryError, "route pin"):
            self.observe(expected_route_sha256="a" * 64)
        with self.assertRaisesRegex(RecoveryError, "accepted installed ingress journal"):
            self.observe(expected_journal_sha256="a" * 64)
        journal = json.loads(self.journal.read_bytes())
        journal["watchedDirectory"][1] += 1
        self.journal.write_bytes(json.dumps(journal, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        with self.assertRaises(RecoveryError):
            self.observe()

    def test_known_second_link_requires_exact_inode_and_installed_authority(self):
        self.apply()
        with self.assertRaisesRegex(RecoveryError, "link count"):
            self.observe(sealed_route_source=self.source)
        self.install_sealed_after_alias()
        with self.assertRaisesRegex(RecoveryError, "link count"):
            self.observe()
        raw, witness = self.observe(sealed_route_source=self.source)
        self.assertEqual(raw, self.plan.after_document)
        self.assertEqual(witness["routeMetadata"][-1], 2)
        self.assertEqual(witness["sealedRoutePath"], str(self.source))

        decoy = self.operation / cold.SEALED_ROUTE_FILE
        decoy.write_bytes(raw)
        decoy.chmod(0o644)
        (self.operation / "decoy-link").hardlink_to(decoy)
        with self.assertRaisesRegex(RecoveryError, "hardlink does not match"):
            self.observe(sealed_route_source=decoy)
        foreign = self.private.parent / cold.SEALED_ROUTE_FILE
        self.source.rename(foreign)
        with self.assertRaisesRegex(RecoveryError, "sealed ingress source path"):
            self.observe(sealed_route_source=foreign)
        foreign.rename(self.source)
        (self.operation / "third-link").hardlink_to(self.route)
        with self.assertRaises(RecoveryError):
            self.observe(sealed_route_source=self.source)

    def test_exact_bootstrap_hardlink_cannot_replace_accepted_route(self):
        self.apply()
        self.route.unlink()
        self.route.hardlink_to(self.source)
        with self.assertRaisesRegex(RecoveryError, "differs from the accepted handoff"):
            self.observe(sealed_route_source=self.source)

    def test_rejects_symlinks_modes_and_overlong_route_before_readback(self):
        self.apply()
        self.route.chmod(0o600)
        with self.assertRaises(RecoveryError):
            self.observe()
        self.route.chmod(0o644)
        self.route.write_bytes(b"x" * (64 * 1024 + 1))
        with self.assertRaises(RecoveryError):
            self.observe()
        self.route.unlink()
        self.route.symlink_to(self.source)
        with self.assertRaises(RecoveryError):
            self.observe()
        self.route.unlink()
        self.route.write_bytes(self.plan.after_document)
        self.route.chmod(0o644)
        real_state = self.operation / "real-state"
        self.state.rename(real_state)
        self.state.symlink_to(real_state, target_is_directory=True)
        with self.assertRaises(RecoveryError):
            self.observe()

    def test_both_live_handoff_locks_must_be_available(self):
        self.apply()
        for path in (self.watched, self.state):
            with self.subTest(path=path), _locked_directory(path), self.assertRaises(RecoveryError):
                self.observe()
        self.assertEqual(self.observe()[0], self.plan.after_document)

    def test_unchanged_bytes_on_new_inode_hold(self):
        self.apply()
        read_route = cold._route

        def swap_after_read(fd):
            result = read_route(fd)
            if result[1][1] == original_inode:
                replacement = self.watched / "replacement"
                replacement.write_bytes(result[0])
                replacement.chmod(0o644)
                os.replace(replacement, self.route)
            return result

        original_inode = self.route.stat().st_ino
        with patch.object(cold, "_route", side_effect=swap_after_read):
            with self.assertRaisesRegex(RecoveryError, "changed during inspection"):
                self.observe()

    def test_same_inode_hardlink_source_in_replaced_directory_holds(self):
        self.apply()
        self.install_sealed_after_alias()
        verify = cold._verify_sealed_route

        def move_alias_after_first_check(source, route):
            identity = verify(source, route)
            if self.baseline.stat().st_ino == original_inode:
                old = self.baseline.with_name("old-baseline")
                self.baseline.rename(old)
                self.baseline.mkdir(mode=0o700)
                (old / source.name).rename(source)
            return identity

        original_inode = self.baseline.stat().st_ino
        with patch.object(cold, "_verify_sealed_route", side_effect=move_alias_after_first_check):
            with self.assertRaises(RecoveryError):
                self.observe(sealed_route_source=self.source)


if __name__ == "__main__":
    unittest.main()
