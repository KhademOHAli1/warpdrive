import copy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import tracking
from tracking_api import Gh
from test_tracking import FakeGh, roadmap
import test_tracking as fixtures


class PendingGh(FakeGh):
    def __init__(self, interrupt=False, timeout=False):
        super().__init__()
        self.interrupt = interrupt
        self.timeout = timeout
        self.hidden_numbers = set()

    def list(self, path):
        rows = super().list(path)
        if "/issues?state=all" in path:
            return [issue for issue in rows if issue["number"] not in self.hidden_numbers]
        return rows

    def request(self, method, path, body=None):
        result = super().request(method, path, body)
        if method == "POST" and path.endswith("/issues"):
            if self.interrupt or self.timeout:
                self.hidden_numbers.add(result["number"])
            if self.interrupt:
                self.interrupt = False
                raise KeyboardInterrupt("Process interrupted after server accepted creation")
            if self.timeout:
                self.timeout = False
                with patch("tracking_api.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 90)):
                    return Gh(pause=0).request(method, path, body)
        return result


class PendingTests(unittest.TestCase):
    setUp = fixtures.TrackingTests.setUp

    def checkpoint(self):
        return json.loads(Path(self.args.checkpoint).read_text())

    def test_timeout_boundary_reports_tracking_error_without_retry(self):
        with patch("tracking_api.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 90)) as command:
            with self.assertRaisesRegex(tracking.TrackingError, "timed out"):
                Gh(pause=0).request("POST", "repos/owner/repo/issues", {"title": "example"})
            self.assertEqual(command.call_count, 1)

    def test_crash_after_server_creation_retains_intent_and_stale_resume_blocks_all_writes(self):
        gh = PendingGh(interrupt=True)
        self.args.phase = "records"
        with self.assertRaises(KeyboardInterrupt):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertIn("PROG", self.checkpoint().get("pending_creates", {}))
        self.assertEqual(len(gh.issues), 1)
        # Pending reconciliation must precede even missing-label writes.
        gh.labels.clear()
        gh.writes.clear()
        with self.assertRaisesRegex(tracking.TrackingError, "Unresolved pending create"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])
        self.assertEqual(len(gh.issues), 1)

    def test_real_timeout_after_server_acceptance_does_not_duplicate_unknown_issue(self):
        gh = PendingGh(timeout=True)
        self.args.phase = "records"
        with self.assertRaises(tracking.TrackingError):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertIn("PROG", self.checkpoint().get("pending_creates", {}))
        self.assertEqual(len(gh.issues), 1)
        gh.writes.clear()
        with self.assertRaisesRegex(tracking.TrackingError, "Unresolved pending create"):
            tracking.run_import(roadmap(), gh, self.args)
        self.assertEqual(gh.writes, [])

    def test_pending_resolves_when_list_catches_up_preserving_operator_updates(self):
        gh = PendingGh(interrupt=True)
        self.args.phase = "records"
        with self.assertRaises(KeyboardInterrupt):
            tracking.run_import(roadmap(), gh, self.args)
        gh.issues[0]["body"] += "\nOperator history after interruption.\n"
        gh.issues[0].update(state="closed", labels=["operator-label"])
        original = copy.deepcopy(gh.issues[0])
        gh.hidden_numbers.clear()
        result = tracking.run_import(roadmap(), gh, self.args)
        self.assertTrue(result["complete"])
        self.assertEqual(gh.issues[0], original)
        self.assertEqual(len(gh.issues), 3)
        self.assertEqual(self.checkpoint().get("pending_creates"), {})
        self.assertEqual(self.checkpoint()["issues"]["PROG"]["number"], 1)
