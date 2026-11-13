"""Exercise exact multi-revision source boundaries with private Git fixtures."""

from copy import deepcopy
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import component_inputs as inputs
from test_component_inputs import fixture as component_fixture
from web_release_inputs import ENGINE_ROOT, RUNTIME_FILES, _tree
import web_functional_successor_source as source


class SwitchSuccessorSourceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.receipt = component_fixture(self.root)
        self.projected = {**self.receipt, "components": {name: self.receipt["components"][name] for name in source.RETAINED}}
        self.git("init", "--quiet")
        for path in RUNTIME_FILES:
            self.put(path, path)
        self.put(f"{ENGINE_ROOT}/Dockerfile", "engine runtime")
        self.put(source.SWITCH, "existing Switch")
        self.put(source.KEYBOARD_HELP, "existing SDK keyboard help")
        self.active = self.commit()
        self.switch_bytes = b"reviewed Switch SDK candidate"
        self.fresh = {
            "schemaVersion": 2, "backendInputs": deepcopy(self.projected),
            "web": {"inputSha256": "a" * 64, "importPolicySha256": "b" * 64, "helperGraphInputs": [],
                    "sdkImports": {source.KEYBOARD_HELP: ["@ui-sdk/react/dialog"], source.SWITCH: [source.SWITCH_ENTRY]},
                    "sdkBindings": {source.SWITCH: [
                        {"specifier": source.SWITCH_ENTRY, "exported": name, "local": name}
                        for name in source.SWITCH_EXPORTS
                    ]}},
        }

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=self.root,
                                       timeout=10).decode().strip()

    def put(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode() if isinstance(data, str) else data)

    def commit(self):
        self.git("add", "--all")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet",
                 "--no-gpg-sign", "-m", "isolated successor fixture")
        return self.git("rev-parse", "HEAD")

    def stage(self, *, extra_tooling=None, edit_profile=None, extra_candidate=None):
        before = _tree(self.root, self.active)
        for path in source.VERIFY_FILES:
            self.put(path, f"reviewed source for {path}")
        if extra_tooling:
            extra_tooling()
        middle = _tree(self.root, self.commit())
        changes = [{"path": path, "beforeBlob": before.get(path, (None, None, None))[2], "afterBlob": middle[path][2]}
                   for path in sorted(middle) if before.get(path) != middle[path]]
        self.profile = {
            "schemaVersion": 2, "activeWebRevision": self.active,
            "toolingChanges": [row for row in changes if source._reviewed_tooling_path(row["path"])],
            "carriedWebChanges": [row for row in changes if not source._reviewed_tooling_path(row["path"])],
            "switch": {"path": source.SWITCH, "beforeBlob": before[source.SWITCH][2],
                       "afterBlob": source._blob_id(self.switch_bytes)},
        }
        if edit_profile:
            edit_profile(self.profile)
        self.put(source.PROFILE_PATH, inputs.canonical(self.profile))
        self.tooling = self.commit()
        self.put(source.SWITCH, self.switch_bytes)
        if extra_candidate:
            extra_candidate()
        self.candidate = self.commit()

    def verify(self, **overrides):
        return source.verify_web_functional_successor_source(self.root, **({
            "active_revision": self.active, "tooling_revision": self.tooling, "candidate_revision": self.candidate,
            "profile_sha256": inputs.content_hash(self.profile), "original_backend_receipt": self.receipt,
            "original_backend_sha256": inputs.content_hash(self.receipt),
        } | overrides))

    def test_two_reviewed_hops_preserve_retained_inputs_and_keyboard_help(self):
        self.stage()
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=self.fresh) as scan:
            proof = self.verify()
        scan.assert_called_once_with(self.root, expected_revision=self.candidate, **{
            "base_image": self.projected["context"]["baseImage"], "platform": self.projected["context"]["platform"],
            "build_args": self.projected["context"]["buildArgs"],
        })
        self.assertEqual(proof["schemaVersion"], 2)
        self.assertEqual(proof["changed"], [self.profile["switch"]])
        self.assertEqual(proof["toolingChanges"], self.profile["toolingChanges"])
        self.assertEqual(proof["carriedWebChanges"], [])
        self.assertFalse(proof["deploymentAuthorized"])

    def test_reviewed_carried_web_changes_pass_and_protected_helpers_hold(self):
        path = "src/components/Review.tsx"
        self.stage(extra_tooling=lambda: self.put(path, "reviewed UI"))
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=self.fresh):
            self.assertEqual(self.verify()["carriedWebChanges"], self.profile["carriedWebChanges"])
        self.fresh["web"]["helperGraphInputs"].append(path)
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=self.fresh):
            with self.assertRaisesRegex(inputs.InputError, "protected executable input"):
                self.verify()

    def test_profile_cannot_hide_application_deltas_as_tooling(self):
        def misclassify(profile):
            profile["toolingChanges"].extend(profile["carriedWebChanges"])
            profile["carriedWebChanges"] = []

        self.stage(extra_tooling=lambda: self.put("src/unrelated.tsx", "unreleased UI"), edit_profile=misclassify)
        with patch.object(source, "discover_web_sdk_full_receipt") as scan:
            with self.assertRaisesRegex(inputs.InputError, "differs from its reviewed blob pins"):
                self.verify()
            scan.assert_not_called()

    def test_only_the_exact_browser_rollout_entry_can_enter_the_tooling_hop(self):
        rollout = "scripts/browser-web-rollout.mjs"
        self.stage(extra_tooling=lambda: self.put(rollout, "reviewed browser witness integration"))
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=self.fresh):
            self.assertIn(rollout, {row["path"] for row in self.verify()["toolingChanges"]})
        self.git("reset", "--hard", self.active)
        self.stage(extra_tooling=lambda: self.put("scripts/browser-web-other.mjs", "unreviewed script"))
        with patch.object(source, "discover_web_sdk_full_receipt") as scan:
            with self.assertRaisesRegex(inputs.InputError, "unreviewed runtime boundary"):
                self.verify()
            scan.assert_not_called()

    def test_missing_tooling_delta_pin_and_wrong_candidate_blob_are_rejected(self):
        self.stage(edit_profile=lambda profile: profile["toolingChanges"].pop())
        with self.assertRaisesRegex(inputs.InputError, "Every active-to-tooling change"):
            self.verify()
        self.git("reset", "--hard", self.active)
        self.stage(edit_profile=lambda profile: profile["switch"].update(afterBlob="f" * 40))
        with self.assertRaisesRegex(inputs.InputError, "Switch blob pair"):
            self.verify()

    def test_candidate_cannot_change_pilot_profile_or_other_ui(self):
        for path in (source.KEYBOARD_HELP, source.PROFILE_PATH, "src/unrelated.tsx"):
            with self.subTest(path=path):
                self.git("reset", "--hard", self.active)
                self.stage(extra_candidate=lambda: self.put(path, "second candidate file"))
                with self.assertRaisesRegex(inputs.InputError, "must change only the canonical Switch"):
                    self.verify()

    def test_switch_symlink_and_hidden_worktree_substitution_are_rejected(self):
        def replace_leaf():
            path = self.root / source.SWITCH
            path.unlink()
            path.symlink_to("../../../unreviewed")

        self.stage(extra_candidate=replace_leaf)
        with self.assertRaisesRegex(inputs.InputError, "nonexecutable regular source"):
            self.verify()
        self.git("reset", "--hard", self.active)
        self.stage()
        self.git("update-index", "--assume-unchanged", source.IMPORT_SCANNER)
        self.put(source.IMPORT_SCANNER, "hidden replacement")
        with self.assertRaisesRegex(inputs.InputError, "differs from protected tooling bytes"):
            self.verify()

    def test_backend_blob_changes_fail_before_any_fresh_code_runs(self):
        path = "scripts/deployment/component_inputs.mjs"
        self.assertIn(path, inputs.POLICY_SOURCES)
        self.stage(extra_tooling=lambda: self.put(path, "mutated backend scanner"))
        with patch.object(source, "discover_web_sdk_full_receipt") as scan:
            with self.assertRaisesRegex(inputs.InputError, "input file"):
                self.verify()
            scan.assert_not_called()

    def test_old_or_substituted_backend_facts_and_extra_sdk_imports_fail(self):
        self.stage()
        with self.assertRaisesRegex(inputs.InputError, "Original backend receipt"):
            self.verify(original_backend_sha256="0" * 64)
        backend_change = deepcopy(self.fresh)
        backend_change["backendInputs"]["components"]["worker"]["graphInputs"].append(source.SWITCH)
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=backend_change):
            with self.assertRaisesRegex(inputs.InputError, "Fresh backend input inventory differs"):
                self.verify()
        extra_sdk = deepcopy(self.fresh)
        extra_sdk["web"]["sdkImports"]["src/unrelated.tsx"] = ["@ui-sdk/react/menu"]
        with patch.object(source, "discover_web_sdk_full_receipt", return_value=extra_sdk):
            with self.assertRaisesRegex(inputs.InputError, "retained keyboard pilot"):
                self.verify()

    def test_changes_during_discovery_are_detected(self):
        self.stage()

        def scan(*args, **kwargs):
            self.put(source.SWITCH, "changed during discovery")
            return self.fresh

        with patch.object(source, "discover_web_sdk_full_receipt", side_effect=scan):
            with self.assertRaisesRegex(inputs.InputError, "Working Switch source differs"):
                self.verify()
