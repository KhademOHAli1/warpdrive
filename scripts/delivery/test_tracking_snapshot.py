import json
from pathlib import Path
import tempfile
import unittest

from tracking_model import TrackingError
from tracking_snapshot import snapshot

REPOSITORY = "o/r"
MANIFEST = {
    "schema_version": 1,
    "repository": REPOSITORY,
    "sources": [{"id": "approved", "count": 2}],
    "items": [
        {"id": name, "kind": "deliverable", "module": "sales", "title": name,
         "acceptance": ["Full task acceptance"],
         "source_tasks": [{"source": "approved", "id": "original-" + name}]}
        for name in ("A", "B")
    ],
}

def issue(name, number, state="open"):
    return {"id": number * 10, "node_id": f"N{number}", "number": number,
            "body": f"<!-- warpdrive:delivery-id:{name} -->", "title": name,
            "html_url": f"https://github.com/{REPOSITORY}/issues/{number}",
            "state": state, "state_reason": "completed" if state == "closed" else None,
            "labels": [], "assignees": []}

def known(value):
    return {key: value[key] for key in ("number", "id", "node_id")}

class API:
    def __init__(self, listed, direct=None):
        self.listed = listed
        self.direct = direct or {}
        self.reads = []
    def list(self, path):
        self.reads.append(path)
        return self.listed
    def request(self, method, path, body=None, **kwargs):
        self.reads.append(path)
        if method != "GET":
            raise AssertionError("Snapshots must never mutate GitHub")
        number = int(path.rsplit("/", 1)[-1])
        if number not in self.direct:
            raise TrackingError("Issue not found")
        return self.direct[number]

class SnapshotTests(unittest.TestCase):
    def write_known(self, path, issues):
        path.write_text(json.dumps({"schema_version": 1, "repository": REPOSITORY, "issues": issues}))
    def test_stale_list_recovers_from_existing_issue_map_without_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a, b = issue("A", 1), issue("B", 2, "closed")
            mapping = root / "map.json"
            self.write_known(mapping, {"A": known(a), "B": known(b)})
            api = API([a], {2: b})
            result = snapshot(MANIFEST, api, root / "snapshot.json", mapping_path=mapping)
            saved = json.loads((root / "snapshot.json").read_text())
            self.assertTrue(result["complete"])
            self.assertEqual(saved["coverage"]["known_identity_direct_reads"], 1)
            self.assertEqual(saved["execution"]["B"]["state"], "closed")
            self.assertEqual(len(saved["sources"]), 2)
            self.assertIn("repos/o/r/issues/2", api.reads)
    def test_stale_list_recovers_checkpoint_and_uses_current_github_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a, b = issue("A", 1), issue("B", 2, "closed")
            checkpoint = root / "state.json"
            self.write_known(checkpoint, {"B": dict(known(b), state="open")})
            snapshot(MANIFEST, API([a], {2: b}), root / "snapshot.json", checkpoint_path=checkpoint)
            saved = json.loads((root / "snapshot.json").read_text())
            self.assertEqual(saved["execution"]["B"]["state"], "closed")
            self.assertFalse(saved["partial"])
            self.assertIn("GitHub", saved["status_source"])
    def test_true_missing_manifest_coverage_preserves_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "snapshot.json"
            target.write_text("preserve prior verified snapshot")
            with self.assertRaisesRegex(TrackingError, "coverage"):
                snapshot(MANIFEST, API([issue("A", 1)]), target)
            self.assertEqual(target.read_text(), "preserve prior verified snapshot")
    def test_conflicting_checkpoint_and_mapping_identity_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint, mapping = root / "state.json", root / "map.json"
            self.write_known(checkpoint, {"B": known(issue("B", 2))})
            self.write_known(mapping, {"B": known(issue("B", 3))})
            with self.assertRaisesRegex(TrackingError, "identity"):
                snapshot(MANIFEST, API([issue("A", 1), issue("B", 2)]), root / "snapshot.json", checkpoint, mapping)
            self.assertFalse((root / "snapshot.json").exists())
    def test_explicit_partial_snapshot_preserves_unmapped_original_task_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "snapshot.json"
            result = snapshot(MANIFEST, API([issue("A", 1)]), target, allow_partial=True)
            saved = json.loads(target.read_text())
            self.assertFalse(result["complete"])
            self.assertTrue(saved["partial"])
            self.assertEqual(saved["coverage"]["missing_ids"], ["B"])
            self.assertEqual(saved["coverage"]["expected_items"], 2)
            self.assertEqual(saved["coverage"]["mapped_items"], 1)
            self.assertEqual(len(saved["sources"]), 2)
            unmapped = next(row for row in saved["sources"] if row["canonical_id"] == "B")
            self.assertEqual(unmapped["id"], "original-B")
            self.assertIsNone(unmapped["issue"])
    def test_changed_remote_identity_is_not_rebound_from_a_hint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mapping = root / "map.json"
            self.write_known(mapping, {"B": known(issue("B", 2))})
            with self.assertRaisesRegex(TrackingError, "identity mismatch"):
                snapshot(MANIFEST, API([issue("A", 1)], {2: issue("OTHER", 2)}), root / "snapshot.json", mapping_path=mapping)
            self.assertFalse((root / "snapshot.json").exists())

if __name__ == "__main__":
    unittest.main()
