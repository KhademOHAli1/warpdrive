import argparse
import copy
import json
import tempfile
import unittest
from pathlib import Path

import tracking
from tracking_model import labels_for


def roadmap():
    return {
        "schema_version": 1,
        "repository": "owner/repo",
        "sources": [{"id": "plan", "count": 2}],
        "items": [
            {"id": "PROG", "title": "Programme", "kind": "programme", "module": "sales", "source_tasks": []},
            {"id": "A", "title": "First delivery", "kind": "deliverable", "module": "sales", "parent": "PROG", "source_tasks": [{"source": "plan", "id": "A", "path": "docs/plan.md"}], "acceptance": ["First works"]},
            {"id": "B", "title": "Second delivery", "kind": "deliverable", "module": "sales", "parent": "PROG", "source_tasks": [{"source": "plan", "id": "B", "path": "docs/plan.md"}], "acceptance": ["Second works"], "dependencies": ["A"]},
        ],
    }


class FakeGh:
    """A remote-boundary fake, not a database fake."""
    def __init__(self):
        self.issues = []
        self.labels = []
        self.milestones = []
        self.children = {}
        self.dependencies = {}
        self.writes = []
        self.lose_create_response = False
        self.drop_relationship = False

    def list(self, path):
        if path.endswith("/labels"):
            return copy.deepcopy(self.labels)
        if "/milestones" in path:
            return copy.deepcopy(self.milestones)
        if path.endswith("/sub_issues"):
            return copy.deepcopy(self.children.get(path, []))
        if path.endswith("/dependencies/blocked_by"):
            return copy.deepcopy(self.dependencies.get(path, []))
        return copy.deepcopy(self.issues)

    def request(self, method, path, body=None):
        if method == "GET":
            return copy.deepcopy(next(issue for issue in self.issues if issue["number"] == int(path.rsplit("/", 1)[1])))
        self.writes.append((method, path, copy.deepcopy(body)))
        if path.endswith("/labels"):
            self.labels.append(body)
            return body
        if path.endswith("/milestones"):
            milestone = dict(body, number=len(self.milestones) + 1)
            self.milestones.append(milestone)
            return milestone
        if path.endswith("/sub_issues"):
            issue = next(issue for issue in self.issues if issue["id"] == body["sub_issue_id"])
            if not self.drop_relationship:
                self.children.setdefault(path, []).append(issue)
            return issue
        if path.endswith("/dependencies/blocked_by"):
            issue = next(issue for issue in self.issues if issue["id"] == body["issue_id"])
            self.dependencies.setdefault(path, []).append(issue)
            return issue
        if method == "PATCH":
            issue = next(issue for issue in self.issues if issue["number"] == int(path.rsplit("/", 1)[1]))
            issue.update(body)
            return copy.deepcopy(issue)
        issue = dict(body, number=len(self.issues) + 1, id=len(self.issues) + 100, node_id=f"I{len(self.issues) + 1}", html_url=f"https://github.com/owner/repo/issues/{len(self.issues) + 1}", state="open")
        self.issues.append(issue)
        if self.lose_create_response:
            self.lose_create_response = False
            raise tracking.TrackingError("Lost response after accepted create")
        return copy.deepcopy(issue)


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.args = argparse.Namespace(apply=True, checkpoint=str(Path(self.temp.name) / "checkpoint.json"), mapping=str(Path(self.temp.name) / "mapping.json"), max_create=None, refresh_spec=False, skip_relationships=False, project_config=None, phase="all")

    def test_csv_quoted_multiline_and_unequal_rows(self):
        self.assertEqual(tracking.load_csv('id,acceptance\r\nA,"comma, and\nnewline"\r\n')[0]["acceptance"], "comma, and\nnewline")
        with self.assertRaises(tracking.TrackingError):
            tracking.load_csv("id,name\nA,B,C\n")

    def test_source_mapping_complete_and_many_sources_one_canonical(self):
        manifest = roadmap()
        manifest["sources"].append({"id": "other", "count": 1})
        manifest["items"][1]["source_tasks"].append({"source": "other", "id": "same-delivery"})
        self.assertEqual(len(tracking.validate(manifest)), 3)
        manifest["sources"][0]["count"] = 3
        with self.assertRaisesRegex(tracking.TrackingError, "Incomplete source mapping"):
            tracking.validate(manifest)

    def test_duplicate_source_ids_and_cycles_rejected(self):
        manifest = roadmap()
        manifest["items"][2]["source_tasks"] = copy.deepcopy(manifest["items"][1]["source_tasks"])
        with self.assertRaisesRegex(tracking.TrackingError, "maps more than once"):
            tracking.validate(manifest)
        manifest = roadmap()
        manifest["items"][1]["dependencies"] = ["B"]
        with self.assertRaisesRegex(tracking.TrackingError, "Cycle"):
            tracking.validate(manifest)

    def test_duplicate_remote_marker_fails_before_mutation(self):
        gh = FakeGh()
        gh.issues = [{"number": 1, "body": "<!-- warpdrive:delivery-id:A -->"}, {"number": 2, "body": "<!-- warpdrive:delivery-id:A -->"}]
        with self.assertRaisesRegex(tracking.TrackingError, "Duplicate GitHub"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])

    def test_dry_run_never_writes_or_creates_mapping(self):
        self.args.apply = False
        gh = FakeGh()
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(result["counts"]["issues_create"], 3)
        self.assertEqual(gh.writes, [])
        self.assertFalse(Path(self.args.mapping).exists())

    def test_resume_after_lost_create_response_and_idempotent_relationships(self):
        gh = FakeGh()
        gh.lose_create_response = True
        tracking.run_import(roadmap(), gh, self.args)
        writes = len(gh.writes)
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertTrue(result["complete"])
        self.assertEqual(len(gh.issues), 3)
        self.assertEqual(len(gh.writes), writes)
        self.assertEqual(len(json.loads(Path(self.args.mapping).read_text())["sources"]), 2)

    def test_resume_bounded_creation_preserves_live_state_and_body(self):
        gh = FakeGh()
        self.args.max_create = 2
        tracking.run_import(roadmap(), gh, self.args)
        gh.issues[1].update(state="closed", milestone={"number": 8}, labels=["custom"], assignees=[{"login": "other"}])
        gh.issues[1]["body"] += "\nOperator acceptance history stays.\n"
        preserved = copy.deepcopy(gh.issues[1])
        self.args.max_create = None
        tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.issues[1], preserved)
        self.assertEqual(len(gh.issues), 3)

    def test_managed_refresh_retains_history_and_rejects_operator_spec_edit(self):
        item = roadmap()["items"][1]
        old = tracking.issue_body(item, "owner/repo") + "\noperator notes\n"
        new_item = dict(item, acceptance=["Improved criterion"])
        new_spec = tracking.managed_spec(new_item, "owner/repo")
        changed = tracking.reconcile_body(old, new_spec, tracking.digest(tracking.managed_spec(item, "owner/repo")))
        self.assertTrue(changed.endswith("\noperator notes\n"))
        with self.assertRaisesRegex(tracking.TrackingError, "edited"):
            tracking.reconcile_body(old.replace("First works", "Operator edit"), new_spec, tracking.digest(tracking.managed_spec(item, "owner/repo")))

    def test_records_phase_defers_relationship_writes(self):
        gh = FakeGh()
        self.args.phase = "records"
        tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(len(gh.issues), 3)
        self.assertEqual(gh.children, {})
        self.assertEqual(gh.dependencies, {})

    def test_markerless_exact_title_requires_reconciliation(self):
        gh = FakeGh()
        gh.issues = [{"number": 1, "id": 100, "node_id": "I1", "html_url": "https://github.com/owner/repo/issues/1", "title": "[A] First delivery", "body": "Identity marker was removed", "state": "open"}]
        with self.assertRaisesRegex(tracking.TrackingError, "Unmanaged issue"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])

    def test_relationship_write_is_verified_by_independent_read(self):
        gh = FakeGh()
        gh.drop_relationship = True
        with self.assertRaisesRegex(tracking.TrackingError, "Sub-issue verification"):
            tracking.run_import(roadmap(), gh, self.args)

    def test_apply_lock_rejects_concurrent_importer(self):
        path = Path(self.temp.name) / "import.lock"
        with tracking.operation_lock(path):
            with self.assertRaisesRegex(tracking.TrackingError, "already running"):
                with tracking.operation_lock(path):
                    self.fail("Second writer acquired the same import lock")

    def test_boundary_rejects_string_dependency_and_unknown_source(self):
        manifest = roadmap()
        manifest["items"][2]["dependencies"] = "A"
        with self.assertRaisesRegex(tracking.TrackingError, "array"):
            tracking.validate(manifest)

    def test_namespaced_slash_identity_round_trips_without_duplicates(self):
        manifest = roadmap()
        manifest["items"][0]["id"] = "programme/sales"
        for item in manifest["items"][1:]:
            item["parent"] = "programme/sales"
        tracking.validate(manifest)
        gh = FakeGh()
        tracking.run_import(manifest, gh, self.args)
        self.assertIn("programme/sales", tracking.index_issues(gh.issues))
        writes = len(gh.writes)
        tracking.run_import(manifest, gh, self.args)
        self.assertEqual(len(gh.writes), writes)

    def test_next_release_deliverable_gets_real_milestone_and_view_label(self):
        manifest = roadmap()
        manifest["milestones"] = [{"id": "next", "title": "Next usable release: Core CRM journeys", "issues": ["A"]}]
        manifest["items"][1].update(release="next", milestone="Next usable release: Core CRM journeys")
        gh = FakeGh()
        tracking.run_import(manifest, gh, self.args)
        issue = tracking.index_issues(gh.issues)["A"]
        self.assertEqual(issue.get("milestone"), 1)
        self.assertIn("release:next", issue["labels"])

    def test_source_disqualification_flags_and_remaining_gates_are_visible(self):
        item = roadmap()["items"][1]
        item["source_tasks"][0]["original"] = {"sourceMatched": False, "providerGate": True, "accepted": False, "classification": "unverified"}
        item["remaining_gates"] = ["Real provider acceptance remains open"]
        body = tracking.issue_body(item, "owner/repo")
        self.assertIn('"sourceMatched": false', body)
        self.assertIn("Real provider acceptance remains open", body)

    def test_import_labels_preserve_active_and_source_verified_only(self):
        item = roadmap()["items"][1]
        for status in ("active", "in_progress", "in-progress", "In Progress"):
            self.assertIn("import:active", labels_for(dict(item, observed_status=status)))
        self.assertIn("import:source-verified", labels_for(dict(item, observed_status="source-verified")))
        for status in ("blocked", "waiting-external", "waiting_external", "Waiting external"):
            self.assertIn("import:blocked", labels_for(dict(item, observed_status=status)))
        completed = labels_for(dict(item, observed_status="completed"))
        self.assertFalse(any("accepted" in label.lower() or "integrated" in label.lower() or "source-verified" in label for label in completed))

    def test_frozen_original_specs_link_source_head_and_imported_snapshots_main(self):
        item = roadmap()["items"][1]
        frozen = tracking.managed_spec(item, "owner/repo", {"plan": "abc123"})
        self.assertIn("/blob/abc123/docs/plan.md", frozen)
        item["source_tasks"][0]["path"] = "docs/delivery/sources/plan.json"
        imported = tracking.managed_spec(item, "owner/repo", {"plan": "abc123"})
        self.assertIn("/blob/main/docs/delivery/sources/plan.json", imported)
        manifest = roadmap()
        manifest["items"][1]["source_tasks"][0]["source"] = "typo-plan"
        with self.assertRaisesRegex(tracking.TrackingError, "Unknown source"):
            tracking.validate(manifest)


if __name__ == "__main__":
    unittest.main()
