import copy
import tempfile
import unittest
from unittest.mock import patch

import release
import release_gates as gates
import release_security as security
from release_publication_test import EVIDENCE, ReleaseAPI

REVISION = "a" * 40


def analysis(language, index):
    return {"id": index, "commit_sha": REVISION, "category": f"/language:{language}",
            "tool": {"name": "CodeQL"}, "error": ""}


def alert(level=None, severity="warning"):
    return {"state": "open", "tool": {"name": "CodeQL"},
            "rule": {"security_severity_level": level, "severity": severity}}


class API:
    def __init__(self):
        self.calls = []
        self.analyses = [analysis(language, index) for index, language in enumerate(
            ("javascript-typescript", "actions", "python"), 1)]
        self.alerts = []
        self.alert_pages = None
        self.main_reads = [REVISION, REVISION]
        self.failure = None

    def request(self, path, method="GET", payload=None):
        self.calls.append(path)
        if self.failure:
            raise gates.GateError(self.failure)
        if path.endswith("/git/ref/heads/main"):
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.main_reads.pop(0)}}
        if "/code-scanning/analyses?" in path:
            return self.analyses
        if "/code-scanning/alerts?" in path:
            return self.alerts if self.alert_pages is None else self.alert_pages.pop(0)
        raise AssertionError(path)

    def pages(self, path, key=None):
        self.calls.append(path)
        if key == "workflow_runs":
            return [{"id": 5, "head_sha": REVISION, "head_branch": "main", "event": "dynamic",
                     "workflow_id": 12345, "path": "dynamic/github-code-scanning/codeql",
                     "run_number": 1, "status": "completed", "conclusion": "success",
                     "html_url": "https://github.com/o/r/actions/runs/5"}]
        if key == "jobs":
            return [{"name": "Analyze (python)", "conclusion": "success"}]
        raise AssertionError(path)


class CodeQLResultTests(unittest.TestCase):
    def test_named_main_three_exact_commit_analyses_and_empty_alerts_require_both_ref_reads(self):
        api = API()
        proof = security.verify_release_code_scanning(api, "o/r", REVISION)
        self.assertEqual(proof["revision"], REVISION)
        self.assertEqual(proof["analysis_ids"], [1, 2, 3])
        self.assertEqual(proof["open_alerts"], 0)
        self.assertTrue(proof["main_bound_before_and_after"])
        self.assertEqual(api.main_reads, [])
        self.assertTrue(all("ref=refs%2Fheads%2Fmain" in p for p in api.calls if "/code-scanning/" in p))
        self.assertFalse(any(f"ref={REVISION}" in p for p in api.calls))

    def test_green_workflow_cannot_override_high_critical_or_error_result(self):
        for finding in (alert("high"), alert("critical"), alert(None, "error"), alert("low", "error")):
            with self.subTest(finding=finding):
                api = API()
                api.alerts = [finding]
                with self.assertRaisesRegex(gates.GateError, "blocking CodeQL"):
                    security.verify_release_code_scanning(api, "o/r", REVISION)

    def test_low_medium_and_note_are_observed_without_being_mislabeled_no_findings(self):
        api = API()
        api.alerts = [alert("low"), alert("medium"), alert(None, "note")]
        proof = security.verify_release_code_scanning(api, "o/r", REVISION)
        self.assertEqual(proof["open_alerts"], 3)
        self.assertEqual(proof["blocking_alerts"], 0)

    def test_empty_sha_response_or_missing_language_or_wrong_commit_never_proves_clean(self):
        for transform in (lambda rows: [], lambda rows: rows[:2],
                          lambda rows: [dict(r, commit_sha="b" * 40) for r in rows],
                          lambda rows: [dict(rows[0], error="failed")] + rows[1:]):
            api = API()
            api.analyses = transform(api.analyses)
            with self.assertRaisesRegex(gates.GateError, "all three"):
                security.verify_release_code_scanning(api, "o/r", REVISION)
            self.assertFalse(any("/alerts?" in p for p in api.calls))

    def test_main_moved_before_or_during_reads_blocks(self):
        for reads in (("b" * 40, REVISION), (REVISION, "b" * 40)):
            api = API()
            api.main_reads = list(reads)
            with self.assertRaisesRegex(gates.GateError, "current main tip"):
                security.verify_release_code_scanning(api, "o/r", REVISION)

    def test_api_permission_errors_or_malformed_results_fail_closed(self):
        api = API()
        api.failure = "403 security-events read unavailable"
        with self.assertRaisesRegex(gates.GateError, "403"):
            security.verify_release_code_scanning(api, "o/r", REVISION)
        for finding in ({}, dict(alert(), state="fixed"), dict(alert(), tool={"name": "Other"}),
                        alert("unknown"), alert(None, "unknown")):
            api = API()
            api.alerts = [finding]
            with self.assertRaisesRegex(gates.GateError, "malformed"):
                security.verify_release_code_scanning(api, "o/r", REVISION)

    def test_malformed_raw_empty_object_or_string_alert_page_is_not_clean_proof(self):
        for malformed in ({}, "", {"message": "not an alert collection"}, None):
            for preceding in ([], [[alert("low")] * 100]):
                with self.subTest(malformed=malformed, preceding=bool(preceding)):
                    api = API()
                    api.alert_pages = preceding + [malformed]
                    with self.assertRaisesRegex(gates.GateError, "alert response is malformed"):
                        security.verify_release_code_scanning(api, "o/r", REVISION)

    def test_all_raw_alert_pages_are_examined_and_late_blocker_is_not_dropped(self):
        api = API()
        api.alert_pages = [[alert("low")] * 100, [alert("high")]]
        with self.assertRaisesRegex(gates.GateError, "blocking CodeQL"):
            security.verify_release_code_scanning(api, "o/r", REVISION)
        self.assertEqual(api.alert_pages, [])
        self.assertTrue(any("&per_page=100&page=2" in p for p in api.calls))

    def test_historical_generic_ci_keeps_exact_workflow_gate_without_live_main_reads(self):
        api = API()
        api.main_reads = ["b" * 40]
        api.analyses = []
        proof = gates.verify_ci(api, "o/r", REVISION,
                                {"required_workflows": {"12345": ["Analyze (python)"]}},
                                dynamic_codeql_workflow="12345")
        self.assertEqual(len(proof), 1)
        self.assertEqual(api.main_reads, ["b" * 40])
        self.assertFalse(any("code-scanning" in p or "heads/main" in p for p in api.calls))

    def test_fresh_draft_blocks_before_any_write_when_selected_main_is_stale(self):
        api = ReleaseAPI()
        original = api.request
        def request(path, method="GET", payload=None):
            if path.endswith("/git/ref/heads/main"):
                return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": "b" * 40}}
            return original(path, method, payload)
        api.request = request
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(gates.GateError, "current main tip"):
            release.publish(api, {}, EVIDENCE, directory, "draft")
        self.assertEqual(api.writes, [])

    def test_new_live_blocker_is_reread_before_irreversible_publication(self):
        api = ReleaseAPI()
        original = api.request
        reads = []
        def request(path, method="GET", payload=None):
            if "/code-scanning/alerts?" in path:
                reads.append(path)
                return [] if len(reads) == 1 else [alert("high")]
            return original(path, method, payload)
        api.request = request
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "notes", return_value="notes"), patch.object(release, "run"), patch.object(release, "verify_uploaded_assets"), patch.object(release, "trusted_release_policy", return_value={}), patch.object(release, "release_gate", return_value=copy.deepcopy(EVIDENCE)), self.assertRaisesRegex(gates.GateError, "blocking CodeQL"):
            release.publish(api, {}, EVIDENCE, directory, "publish")
        self.assertEqual(len(reads), 2)
        self.assertFalse(any(payload.get("draft") is False for _, _, payload in api.writes))

    def test_published_receipt_repair_does_not_require_old_revision_to_be_current_main(self):
        api = ReleaseAPI()
        api.release["draft"] = False
        original = api.request
        def request(path, method="GET", payload=None):
            if "heads/main" in path or "code-scanning" in path:
                raise AssertionError("Historical receipt repair must not borrow a live-main gate")
            return original(path, method, payload)
        api.request = request
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "verify_uploaded_assets"), patch.object(release, "record_publication", return_value="verified-receipt") as record:
            self.assertEqual(release.publish(api, {}, EVIDENCE, directory, "publish"), "verified-receipt")
        record.assert_called_once_with(api, EVIDENCE, 9)
        self.assertEqual(api.writes, [])


if __name__ == "__main__":
    unittest.main()
