import copy
import unittest

from tracking_model import TrackingError
from tracking_relationships import reconcile_relationships


def fixture():
    manifest = {"repository": "owner/repo", "items": [{"id": "P"}, {"id": "A", "parent": "P"}, {"id": "B", "parent": "P", "dependencies": ["A"]}]}
    issues = {ident: {"number": index, "id": index + 100} for index, ident in enumerate(("P", "A", "B"), 1)}
    return manifest, issues


class GraphGh:
    def __init__(self):
        self.edges = {}
        self.writes = []
        self.budget = None
        self.lose_response = False

    def list(self, path):
        return [{"id": value} for value in sorted(self.edges.get(path, set()))]

    def request(self, method, path, body):
        if self.budget is not None and len(self.writes) >= self.budget:
            from tracking_budget import WriteBudgetReached
            raise WriteBudgetReached("Test graph write budget reached")
        self.writes.append((method, path, body))
        self.edges.setdefault(path, set()).add(body.get("sub_issue_id", body.get("issue_id")))
        if self.lose_response:
            self.lose_response = False
            raise TrackingError("Response lost after accepted relationship")
        return {}


class RelationshipTests(unittest.TestCase):
    def test_initial_import_and_rerun_preserve_verified_graph_and_foreign_edges(self):
        manifest, issues = fixture()
        gh, checkpoint, saves = GraphGh(), {}, []
        path = "repos/owner/repo/issues/1/sub_issues"
        gh.edges[path] = {999}
        reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: saves.append(copy.deepcopy(checkpoint)))
        self.assertEqual(checkpoint["verified_relationships"], {"subissues": {"P": ["A", "B"]}, "dependencies": {"B": ["A"]}})
        self.assertIn(999, gh.edges[path])
        self.assertEqual(saves[0]["verified_relationships"]["subissues"]["P"], ["A"])
        writes = len(gh.writes)
        reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(len(gh.writes), writes)

    def test_operator_deleted_verified_edge_blocks_all_graph_writes_until_explicit_repair(self):
        manifest, issues = fixture()
        gh = GraphGh()
        checkpoint = {"verified_relationships": {"subissues": {}, "dependencies": {"B": ["A"]}}}
        original = copy.deepcopy(checkpoint)
        with self.assertRaisesRegex(TrackingError, "Previously verified.*repair"):
            reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(gh.writes, [])
        self.assertEqual(checkpoint, original)
        reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None, repair=True)
        self.assertEqual(len(gh.writes), 3)

    def test_partial_mapping_defers_unknown_targets_without_false_verification(self):
        manifest, issues = fixture()
        del issues["A"]
        gh, checkpoint = GraphGh(), {}
        counts = reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(counts["subissues_deferred"], 1)
        self.assertEqual(counts["dependencies_deferred"], 1)
        self.assertEqual(checkpoint["verified_relationships"]["subissues"], {"P": ["B"]})
        self.assertEqual(checkpoint["verified_relationships"]["dependencies"], {})

    def test_budget_stop_persists_first_verified_edge_and_later_deletion_conflicts(self):
        from tracking_budget import WriteBudgetReached
        manifest, issues = fixture()
        gh, checkpoint = GraphGh(), {}
        gh.budget = 1
        with self.assertRaises(WriteBudgetReached):
            reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(checkpoint["verified_relationships"]["subissues"], {"P": ["A"]})
        gh.edges.clear()
        gh.budget = None
        gh.writes.clear()
        with self.assertRaisesRegex(TrackingError, "Previously verified"):
            reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(gh.writes, [])

    def test_lost_response_is_recovered_only_by_independent_reread(self):
        manifest, issues = fixture()
        gh, checkpoint = GraphGh(), {}
        gh.lose_response = True
        reconcile_relationships(manifest, gh, issues, checkpoint, True, lambda: None)
        self.assertEqual(len(gh.writes), 3)
        self.assertEqual(checkpoint["verified_relationships"]["subissues"], {"P": ["A", "B"]})

    def test_dry_run_has_no_checkpoint_or_external_mutation(self):
        manifest, issues = fixture()
        gh, checkpoint, saves = GraphGh(), {}, []
        counts = reconcile_relationships(manifest, gh, issues, checkpoint, False, lambda: saves.append(True))
        self.assertEqual(counts["subissues_add"], 2)
        self.assertEqual(counts["dependencies_add"], 1)
        self.assertEqual(gh.writes, [])
        self.assertEqual(checkpoint, {})
        self.assertEqual(saves, [])


if __name__ == "__main__":
    unittest.main()
