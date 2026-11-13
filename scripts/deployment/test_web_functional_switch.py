from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, content_hash
import web_functional_switch as switch


class FunctionalSwitchDriverTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.facts = {"reviewed": "synthetic prebuild evidence"}
        receipt = root / "input.json"
        receipt.write_bytes(canonical(self.facts))
        self.args = SimpleNamespace(new_web_revision="a" * 40, harness_revision="a" * 40,
            baseline_revision="b" * 40, successor_web_revision="c" * 40, tooling_revision="d" * 40,
            browser=True, sdk_keyboard_help=True, topbar_gaps=None, bundle_dir=root / "core",
            new_web_image_id="sha256:" + "1" * 64, baseline_manifest_sha256="2" * 64,
            installed_lineage_sha256="3" * 64, profile_sha256="4" * 64,
            expected_input_sha256=content_hash(self.facts), output_dir=root / "browser",
            bundle_output=root / "bundle", input_path=receipt)
        self.origin = {"event": "workflow_dispatch"}
        self.prepare = self.enterContext(patch.object(switch, "prepare", return_value={
            "inputSha256": self.args.expected_input_sha256,
        }))
        self.enterContext(patch.object(switch, "origin_for", return_value=self.origin))
        self.enterContext(patch.object(switch, "functional_successor_mode", return_value=True))
        self.enterContext(patch.object(switch, "load_bundle", return_value={"core": "admitted"}))
        self.composite = {"web": "historical", "backend": "original"}
        self.enterContext(patch.object(switch, "functional_successor_baseline", return_value=self.composite))
        self.browser = self.enterContext(patch.object(switch, "run_native_mixed", return_value=True))
        self.bundle = self.enterContext(patch.object(switch, "create_functional_bundle", return_value={"tested": True}))
        self.docker = self.enterContext(patch.object(switch, "Docker"))

    def test_trusted_driver_passes_same_mode_and_pins_to_native_browser_and_bundle(self):
        self.assertEqual(switch.qualify(self.args), {"tested": True})
        self.prepare.assert_called_once_with(self.args)
        self.assertIs(self.args.verify, True)
        self.assertIs(self.args.switch_successor, True)
        self.browser.assert_called_once_with(self.args, sdk_scenario=switch.CRM_SWITCH)
        self.bundle.assert_called_once_with(self.args.bundle_output, input_path=self.args.input_path,
            mixed_path=self.args.output_dir / "report.json", composite=self.composite,
            revision=self.args.new_web_revision, origin=self.origin, image_id=self.args.new_web_image_id,
            expected_input_sha256=self.args.expected_input_sha256, installed_lineage_sha256=self.args.installed_lineage_sha256,
            sdk_scenario=switch.CRM_SWITCH, expected_tooling_revision=self.args.tooling_revision,
            expected_profile_sha256=self.args.profile_sha256, docker=self.docker.return_value)

    def test_changed_prebuild_pin_stops_before_browser(self):
        self.args.expected_input_sha256 = "5" * 64
        with self.assertRaisesRegex(CandidateError, "prebuild admission"):
            switch.qualify(self.args)
        self.browser.assert_not_called()
        self.bundle.assert_not_called()

    def test_native_failure_or_changed_receipt_cannot_reach_bundle(self):
        self.browser.return_value = False
        with self.assertRaisesRegex(CandidateError, "browser qualification failed"):
            switch.qualify(self.args)
        self.browser.side_effect = lambda *_args, **_kwargs: self.args.input_path.write_bytes(b"{}")
        with self.assertRaisesRegex(CandidateError, "changed during browser"):
            switch.qualify(self.args)
        self.bundle.assert_not_called()
