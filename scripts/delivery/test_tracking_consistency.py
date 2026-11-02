import copy
import json
from pathlib import Path
import unittest

import tracking
from test_tracking import FakeGh, roadmap
import test_tracking as fixtures


class LaggingGh(FakeGh):
    def __init__(self):
        super().__init__()
        self.hidden_numbers = set()
        self.hide_newest = False

    def list(self, path):
        rows = super().list(path)
        if "/issues?state=all" in path:
            hidden = self.hidden_numbers | ({self.issues[-1]["number"]} if self.hide_newest and self.issues else set())
            return [issue for issue in rows if issue["number"] not in hidden]
        return rows

    def request(self, method, path, body=None):
        if method == "GET" and not any(issue["number"] == int(path.rsplit("/", 1)[1]) for issue in self.issues):
            raise tracking.TrackingError("HTTP 404: Not Found")
        return super().request(method, path, body)


class ConsistencyTests(unittest.TestCase):
    setUp = fixtures.TrackingTests.setUp
    def test_final_verification_recovers_lagging_list_via_exact_direct_get(self):
        gh = LaggingGh()
        gh.hide_newest = True
        self.args.phase = "records"
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertTrue(result["complete"])
        self.assertEqual(len(gh.issues), 3)
        self.assertEqual(len(json.loads(Path(self.args.mapping).read_text())["issues"]), 3)

    def test_resume_missing_known_records_never_recreates_and_keeps_live_updates(self):
        gh = LaggingGh()
        self.args.phase = "records"
        tracking.run_import(roadmap(), gh, self.args)
        gh.issues[1].update(state="closed", assignees=[{"login": "real-owner"}], milestone={"number": 99})
        gh.issues[1]["body"] += "\nAccepted operator history.\n"
        gh.hidden_numbers = {1, 2, 3}
        preserved = copy.deepcopy(gh.issues)
        gh.writes.clear()
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])
        self.assertEqual(gh.issues, preserved)
        self.assertEqual(result["counts"]["existing"], 3)
        self.assertEqual(result["counts"]["unrelated"], 0)
        self.assertEqual(result["mapped_items"], 3)

    def test_known_issue_404_fails_closed_before_any_mutation(self):
        gh = LaggingGh()
        self.args.phase = "records"
        tracking.run_import(roadmap(), gh, self.args)
        gh.issues = [issue for issue in gh.issues if issue["number"] != 2]
        gh.writes.clear()
        with self.assertRaisesRegex(tracking.TrackingError, "known issue.*no automatic recreation"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])

    def test_direct_get_must_match_marker_database_id_and_node_id(self):
        for field, value in (("id", 888), ("node_id", "OTHER"), ("body", "<!-- warpdrive:delivery-id:OTHER -->")):
            with self.subTest(field=field):
                gh = LaggingGh()
                self.args.phase = "records"
                # Each case starts from its own valid saved checkpoint.
                Path(self.args.checkpoint).unlink(missing_ok=True)
                tracking.run_import(roadmap(), gh, self.args)
                gh.hidden_numbers = {2}
                gh.issues[1][field] = value
                gh.writes.clear()
                with self.assertRaisesRegex(tracking.TrackingError, "identity mismatch"):
                    tracking.run_import(roadmap(), gh, self.args)
                self.assertEqual(gh.writes, [])
