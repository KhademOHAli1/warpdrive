"""Dispatch only readback for the exact unresolved installed Web phase."""

from contextlib import contextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from installed_web_acknowledgement import read_functional_acknowledgement
from web_switch import SwitchConflict


MODULE = "installed_web_acknowledgement"


class InstalledWebAcknowledgementTests(unittest.TestCase):
    def setUp(self):
        self.locked = False

        @contextmanager
        def lock(original, state):
            self.assertEqual((original, state), ("fixture-original", "fixture-state"))
            self.locked = True
            try:
                yield
            finally:
                self.locked = False

        self.enterContext(patch(f"{MODULE}.installed_web_readback_locks", side_effect=lock))
        self.plan = {"fixture": "accepted-plan"}
        self.controller = SimpleNamespace(plan=Mock(return_value=self.plan))
        self.install = SimpleNamespace(state="fixture-state", controller=Mock(return_value=self.controller))
        self.authority = Mock(return_value=True)
        self.options = {"original": "fixture-original", "loaded": {}, "release": {}, "alias": "fixture",
                        "revision": "a" * 40, "publication_sha256": "b" * 64, "verify_release": self.authority}

    def test_stage_does_not_construct_or_run_a_controller(self):
        def read_stage(*args, **options):
            self.assertTrue(self.locked)
            return {"state": "private-ready"}

        with patch(f"{MODULE}.read_stage_acknowledgement", side_effect=read_stage):
            self.assertEqual(read_functional_acknowledgement(self.install, action="stage", **self.options),
                             {"state": "private-ready"})
        self.install.controller.assert_not_called()
        self.assertFalse(self.locked)

    def test_route_readback_never_uses_the_mutation_entrypoint(self):
        def read_route(install, controller, phase):
            self.assertTrue(self.locked)
            self.assertIs(install, self.install)
            self.assertIs(controller, self.controller)
            self.assertEqual(phase, "rollback")
            return {"state": "accepted"}

        with patch(f"{MODULE}.read_accepted_web_rollout", side_effect=read_route):
            self.assertEqual(read_functional_acknowledgement(self.install, action="rollback", **self.options),
                             {"state": "accepted"})

    def test_seal_authority_is_checked_before_and_after_the_read(self):
        def read_seal(install, **options):
            self.assertTrue(self.locked)
            self.assertEqual(options["observe_installed"](), {"state": "observed"})
            return {"state": "sealed"}

        with patch(f"{MODULE}.read_seal_acknowledgement", side_effect=read_seal), \
                patch(f"{MODULE}.observe_functional_seal", return_value={"state": "observed"}):
            self.authority.side_effect = (True, False)
            with self.assertRaisesRegex(SwitchConflict, "release authority changed"):
                read_functional_acknowledgement(self.install, action="seal", expected_plan_sha256="c" * 64, **self.options)
        self.assertEqual(self.authority.call_count, 2)
        self.assertFalse(self.locked)

    def test_missing_seal_plan_or_mutating_action_is_refused(self):
        for action in ("seal", "transfer", "release"):
            with self.subTest(action=action), self.assertRaisesRegex(SwitchConflict, "unresolved functional Web phase"):
                read_functional_acknowledgement(self.install, action=action, **self.options)
        self.install.controller.assert_not_called()
