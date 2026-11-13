from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from web_release_inputs import STYLE_FILE
from web_release_rehearsal import (OWNED_MARKER, RehearsalError, _fixture_css, _fixture_delta, _registered,
                                    _sdk_delta, cleanup, git, prepare)


class RehearsalOwnershipTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        base = Path(directory.name).resolve()
        self.root, self.scratch = base / "repository", base / "scratch"
        self.root.mkdir()
        git(self.root, "init", "--quiet")
        git(self.root, "commit", "--allow-empty", "--quiet", "-m", "baseline")
        self.revision = git(self.root, "rev-parse", "HEAD")

    def test_cleanup_removes_only_the_owned_registered_worktree(self):
        self.scratch.mkdir(mode=0o700)
        source = self.scratch / "source"
        git(self.root, "worktree", "add", "--detach", str(source), self.revision)
        with self.assertRaisesRegex(RehearsalError, "marker"):
            cleanup(self.root, self.scratch)
        self.assertTrue(_registered(self.root, source))
        (self.scratch / ".warpdrive-web-rehearsal").write_bytes(OWNED_MARKER)
        cleanup(self.root, self.scratch)
        self.assertFalse(source.exists())
        self.assertFalse(_registered(self.root, source))
        cleanup(self.root, self.scratch)

    def test_requires_actual_same_run_origin_before_opening_scratch(self):
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "false"}, clear=False):
            with self.assertRaisesRegex(RehearsalError, "same-run"):
                prepare(self.root, self.scratch, self.root / "bundle", self.revision, "0" * 64)
        self.assertFalse(self.scratch.exists())

    def test_current_and_historical_gap_pairs_preserve_all_other_bytes(self):
        other = b".unrelated {\n  gap: 24px;\n}\n"
        for old, new in ((24, 22), (20, 18)):
            original = f".header {{\n  display: grid;\n  gap: {old}px;\n}}\n".encode() + other
            changed, gaps = _fixture_css(original)
            self.assertEqual(gaps, [old, new])
            self.assertEqual(changed, original.replace(f"gap: {old}px".encode(), f"gap: {new}px".encode(), 1))
        with self.assertRaisesRegex(RehearsalError, "Unreviewed TopBar"):
            _fixture_css(b".header {\n  gap: 19px;\n}\n")

    def test_git_delta_refuses_unrelated_source_and_incorrect_gap(self):
        style = self.root / STYLE_FILE
        style.parent.mkdir(parents=True)
        original = b".header {\n  gap: 20px;\n}\n"
        style.write_bytes(original)
        git(self.root, "add", "--", STYLE_FILE)
        git(self.root, "commit", "--quiet", "-m", "baseline style")
        baseline = git(self.root, "rev-parse", "HEAD")
        style.write_bytes(_fixture_css(original)[0])
        git(self.root, "commit", "--quiet", "-am", "reviewed style")
        changed = git(self.root, "rev-parse", "HEAD")
        self.assertEqual(_fixture_delta(self.root, baseline, changed), [20, 18])
        style.write_bytes(original.replace(b"20px", b"17px"))
        git(self.root, "commit", "--amend", "--no-edit", "-a")
        with self.assertRaisesRegex(RehearsalError, "exactly its reviewed TopBar declaration"):
            _fixture_delta(self.root, baseline, git(self.root, "rev-parse", "HEAD"))
        style.write_bytes(_fixture_css(original)[0])
        (self.root / "unrelated").write_text("not part of the fixture")
        git(self.root, "add", "--all")
        git(self.root, "commit", "--amend", "--no-edit")
        with self.assertRaisesRegex(RehearsalError, "exactly its reviewed CSS file"):
            _fixture_delta(self.root, baseline, git(self.root, "rev-parse", "HEAD"))

    def test_sdk_css_proof_rejects_a_changed_backend_or_other_web_inputs(self):
        web = {"profile": "fixture", "context": {}, "pinnedInputs": {}, "helperEntries": [], "helperGraphInputs": [],
               "sdkImports": {}, "staticWebInputCount": 4, "inputSha256": "old"}
        baseline = {"schemaVersion": 1, "web": web, "backendInputs": {"worker": "unchanged"}}
        current = {**baseline, "web": {**web, "inputSha256": "new"}}
        with patch("web_release_rehearsal.validate_web_sdk_full_receipt"):
            self.assertEqual(_sdk_delta(baseline, current, self.revision)["buildComponents"], ["web"])
            with self.assertRaisesRegex(RehearsalError, "changed retained backend inputs"):
                _sdk_delta(baseline, {**current, "backendInputs": {"worker": "changed"}}, self.revision)
            with self.assertRaisesRegex(RehearsalError, "changed other Web inputs"):
                _sdk_delta(baseline, {**current, "web": {**current["web"], "sdkImports": {"changed": []}}}, self.revision)

    def test_sdk_css_proof_retains_versioned_bindings(self):
        web = {"profile": "fixture", "sdkBindings": {"src/components/ui/Switch.tsx": []},
               "importPolicySha256": "policy", "inputSha256": "old", "gitInventorySha256": "old"}
        baseline = {"schemaVersion": 2, "web": web, "backendInputs": {"worker": "unchanged"}}
        current = {**baseline, "web": {**web, "inputSha256": "new", "gitInventorySha256": "new"}}
        with patch("web_release_rehearsal.validate_web_sdk_full_receipt"):
            self.assertEqual(_sdk_delta(baseline, current, self.revision)["buildComponents"], ["web"])
            with self.assertRaisesRegex(RehearsalError, "changed other Web inputs"):
                _sdk_delta(baseline, {**current, "schemaVersion": 1}, self.revision)
            with self.assertRaisesRegex(RehearsalError, "changed other Web inputs"):
                _sdk_delta(baseline, {**current, "web": {**current["web"], "sdkBindings": {}}}, self.revision)
