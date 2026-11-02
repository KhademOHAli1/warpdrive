import unittest

import tracking
from test_tracking import FakeGh, roadmap
import test_tracking as fixtures


class BudgetTests(unittest.TestCase):
    setUp = fixtures.TrackingTests.setUp

    def test_zero_write_budget_stops_cleanly_before_metadata_mutations(self):
        gh = FakeGh()
        self.args.phase = "records"
        self.args.max_writes = 0
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])
        self.assertFalse(result["complete"])
        self.assertEqual(result.get("stopped_reason"), "write-budget")

    def test_budget_counts_metadata_and_never_saves_intent_for_unattempted_post(self):
        import json
        from pathlib import Path
        gh = FakeGh()
        self.args.phase = "records"
        self.args.max_writes = 4
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(len(gh.writes), 4)
        self.assertEqual(gh.issues, [])
        self.assertEqual(result.get("writes_used"), 4)
        self.assertEqual(json.loads(Path(self.args.checkpoint).read_text()).get("pending_creates"), {})
        self.args.max_writes = 100
        resumed = tracking.run_import(roadmap(), gh, self.args)
        self.assertTrue(resumed["complete"])
        self.assertEqual(len(gh.issues), 3)

    def test_all_phase_detects_verified_graph_deletion_before_new_metadata_writes(self):
        import json
        from pathlib import Path
        gh = FakeGh()
        tracking.run_import(roadmap(), gh, self.args)
        checkpoint = json.loads(Path(self.args.checkpoint).read_text())
        checkpoint["verified_relationships"] = {"subissues": {"PROG": ["A", "B"]}, "dependencies": {"B": ["A"]}}
        Path(self.args.checkpoint).write_text(json.dumps(checkpoint))
        gh.dependencies.clear()
        gh.labels.clear()
        gh.writes.clear()
        with self.assertRaisesRegex(tracking.TrackingError, "Previously verified"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])
