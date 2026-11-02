import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from release_test import r, REVISION

class TrustedCandidateTests(unittest.TestCase):
    def test_workflow_executes_only_trusted_dispatch_code_and_preflights_before_token(self):
        workflow = (r.ROOT / ".github/workflows/release.yml").read_text()
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertNotIn("ref: ${{ inputs.revision }}", workflow)
        self.assertIn('preflight --revision "$RELEASE_REVISION"', workflow)
        self.assertLess(workflow.index('preflight --revision'), workflow.index("GH_TOKEN:"))
    def test_candidate_revision_is_data_and_never_requires_candidate_checkout(self):
        with patch.object(r, "run", return_value="" ) as git:
            r.require_revision(REVISION)
        self.assertEqual(git.call_args_list[-1].args, ("git", "merge-base", "--is-ancestor", REVISION, "origin/main"))
        for value in ("main", "refs/pull/1/head", "abc;echo unsafe", "a" * 39):
            with self.subTest(value=value), self.assertRaises(r.GateError), patch.object(r, "run") as git:
                r.require_revision(value)
            git.assert_not_called()
    def test_governing_json_is_read_from_selected_commit_ignoring_local_wip(self):
        import release_support
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text('{"version":"99.0.0"}')
            with patch.object(release_support, "ROOT", root), patch.object(release_support, "run", return_value='{"version":"1.4.1"}') as git:
                self.assertEqual(r.load_candidate_json(REVISION, "package.json"), {"version": "1.4.1"})
                git.assert_called_once_with("git", "show", f"{REVISION}:package.json")
            self.assertEqual((root / "package.json").read_text(), '{"version":"99.0.0"}')

class CommitDataTests(unittest.TestCase):
    def test_optional_scope_maps_do_not_turn_plan_metadata_into_commit_ids(self):
        with tempfile.TemporaryDirectory() as root:
            links = r.load_commit_links(root, {"schema_version": 1, "version": "1.4.1"}, document={"schema_version": 1})
        self.assertEqual(links, {"commit_issues": {}, "delivery_scope": {}})

class PublishedBaselineTests(unittest.TestCase):
    def test_drafts_and_abandoned_tags_never_truncate_release_history(self):
        tags = [{"name": "v1.4.1", "commit": {"sha": "b" * 40}}]
        drafts = [{"tag_name": "v1.4.1", "draft": True}]
        self.assertEqual(r.release_baseline(drafts, tags, "v1.4.2", REVISION), REVISION)
        self.assertEqual(r.release_baseline([], tags, "v1.4.2", REVISION), REVISION)
        self.assertEqual(r.release_baseline([{"tag_name": "v1.4.1", "draft": False, "prerelease": True}], tags, "v1.4.2", REVISION), REVISION)
        published = drafts + [{"tag_name": "v1.4.0", "draft": False}]
        tags += [{"name": "v1.4.0", "commit": {"sha": "c" * 40}}]
        self.assertEqual(r.release_baseline(published, tags, "v1.4.2", REVISION), "c" * 40)
    def test_first_release_gate_is_independent_of_mutable_milestone_title(self):
        from release_test import ISSUE, ITEM
        class API:
            def pages(self, path, key=None):
                if "/milestones?" in path:
                    return [{"number": 7, "title": "Renamed maintenance", "html_url": "https://example.com/m"}]
                if "/issues?" in path:
                    return [ISSUE]
                return []
        policy = {"repository": "o/r", "initial_milestone": "Original", "initial_journeys": ["deal-stages"], "initial_journey_ids": {"deal-stages": "ops/journey-deal-stages"}, "traceability_baseline": "b" * 40}
        plan = {"schema_version": 1, "revision": REVISION, "version": "1.4.1", "milestone": 7, "issues": [7], "journeys": {}}
        with patch.object(r, "require_revision"), patch.object(r, "manifest_items", return_value={"DEL-1": ITEM}), patch.object(r, "verify_ci", return_value=[]), patch.object(r, "verify_issue", return_value={"number": 7, "id": "DEL-1"}), patch.object(r, "commit_references", return_value=[]), patch.object(r, "load_json", return_value={"version": "1.4.1"}), self.assertRaisesRegex(r.GateError, "journey"):
            r.release_gate(API(), plan, policy)

if __name__ == "__main__":
    unittest.main()
