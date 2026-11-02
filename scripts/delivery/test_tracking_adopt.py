import copy
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from tracking_adopt import adopt_existing
from tracking_model import TrackingError, START, END


class IntakeApi:
    def __init__(self):
        self.issue = {"number": 123, "id": 456, "node_id": "I_456", "html_url": "https://github.com/o/r/issues/123", "title": "[Bug]: Reminder recovery", "body": "## Reproduction\nOriginal intake, operator notes and evidence.", "state": "open", "labels": [{"name": "type:bug"}], "assignees": [{"login": "operator"}], "milestone": {"number": 5}}
        self.others = []
        self.writes = []
        self.gets = 0
        self.concurrent_edit = False

    def list(self, path):
        return [copy.deepcopy(self.issue), *copy.deepcopy(self.others)]

    def request(self, method, path, body=None):
        if method == "GET":
            self.gets += 1
            if self.concurrent_edit and self.gets == 2:
                self.issue["body"] += "\nA concurrent human edit"
            return copy.deepcopy(self.issue)
        self.writes.append((method, path, copy.deepcopy(body)))
        if path.endswith('/labels'):
            self.issue["labels"] += [{"name": x} for x in body["labels"]]
            return copy.deepcopy(self.issue["labels"])
        self.issue.update(copy.deepcopy(body))
        return copy.deepcopy(self.issue)


class AdoptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.api = IntakeApi()
        self.manifest = {"schema_version": 1, "repository": "o/r", "sources": [], "items": [{"id": "bug/reminder-recovery", "kind": "deliverable", "title": "Recover reminder after retry", "module": "calendar", "source_tasks": [], "acceptance": ["A persisted reminder survives failure and retry exactly within its supported scope."], "dependencies": [], "owner": "owner", "observed_status": "planned"}]}
        self.args = SimpleNamespace(canonical_id="bug/reminder-recovery", issue=123, apply=True, checkpoint=str(Path(self.tmp.name) / "state.json"), mapping=str(Path(self.tmp.name) / "map.json"))

    def test_adoption_preserves_original_intake_and_live_fields(self):
        original = copy.deepcopy(self.api.issue)
        result = adopt_existing(self.manifest, self.api, self.args)
        self.assertTrue(result["adopted"])
        self.assertIn(original["body"], self.api.issue["body"])
        self.assertIn("<!-- warpdrive:delivery-id:bug/reminder-recovery -->", self.api.issue["body"])
        for key in ("title", "state", "assignees", "milestone"):
            self.assertEqual(self.api.issue[key], original[key])
        self.assertIn("type:bug", [x["name"] for x in self.api.issue["labels"]])
        self.assertFalse(any(path.endswith('/issues') and method == "POST" for method, path, _ in self.api.writes))
        self.assertEqual(json.loads(Path(self.args.mapping).read_text())["issues"][self.args.canonical_id]["number"], 123)

    def test_dry_run_has_no_writes_or_output(self):
        self.args.apply = False
        result = adopt_existing(self.manifest, self.api, self.args)
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(self.api.writes, [])
        self.assertFalse(Path(self.args.checkpoint).exists())

    def test_second_adoption_does_not_duplicate_body_or_write(self):
        adopt_existing(self.manifest, self.api, self.args)
        body = self.api.issue["body"]
        self.api.writes.clear()
        adopt_existing(self.manifest, self.api, self.args)
        self.assertEqual(self.api.issue["body"], body)
        self.assertEqual(body.count(START), 1)
        self.assertEqual(body.count(END), 1)
        self.assertEqual(self.api.writes, [])

    def test_duplicate_registered_identity_fails_without_writes(self):
        self.api.others = [{"number": 124, "id": 457, "node_id": "I_457", "body": "<!-- warpdrive:delivery-id:bug/reminder-recovery -->"}]
        with self.assertRaises(TrackingError):
            adopt_existing(self.manifest, self.api, self.args)
        self.assertEqual(self.api.writes, [])

    def test_concurrent_intake_edit_is_preserved_and_stops_apply(self):
        self.api.concurrent_edit = True
        with self.assertRaises(TrackingError):
            adopt_existing(self.manifest, self.api, self.args)
        self.assertIn("concurrent human edit", self.api.issue["body"])
        self.assertEqual(self.api.writes, [])

    def test_pending_ambiguous_create_blocks_adoption(self):
        Path(self.args.checkpoint).write_text(json.dumps({"repository": "o/r", "pending_creates": {self.args.canonical_id: {"canonical_id": self.args.canonical_id}}}))
        with self.assertRaises(TrackingError):
            adopt_existing(self.manifest, self.api, self.args)
        self.assertEqual(self.api.writes, [])


    def test_conflicting_saved_mapping_fails_without_mutation(self):
        Path(self.args.mapping).write_text(json.dumps({"repository": "o/r", "issues": {self.args.canonical_id: {"number": 124, "id": 999, "node_id": "I_999"}}}))
        with self.assertRaises(TrackingError):
            adopt_existing(self.manifest, self.api, self.args)
        self.assertEqual(self.api.writes, [])

    def test_pr_and_other_marker_cannot_be_adopted(self):
        for field, value in (("pull_request", {}), ("body", "<!-- warpdrive:delivery-id:other/id -->")):
            with self.subTest(field=field):
                self.api = IntakeApi()
                self.api.issue[field] = value
                with self.assertRaises(TrackingError):
                    adopt_existing(self.manifest, self.api, self.args)
                self.assertEqual(self.api.writes, [])

    def test_adoption_uses_the_same_frozen_specification_link_as_import(self):
        self.manifest["sources"] = [{"id": "spec", "count": 1, "source_head": "a" * 40}]
        self.manifest["items"][0]["source_tasks"] = [{"source": "spec", "id": "BUG-1", "path": "docs/approved.md"}]
        adopt_existing(self.manifest, self.api, self.args)
        self.assertIn("/blob/" + "a" * 40 + "/docs/approved.md", self.api.issue["body"])
