import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)

ITEM = {"id": "DEL-1", "kind": "task", "acceptance": ["Complete journey and failure recovery"], "source_tasks": [{"source": "test", "id": "A-1"}]}
REVISION = "a" * 40
ISSUE = {"number": 7, "body": "<!-- warpdrive:delivery-id:DEL-1 -->", "state": "closed", "state_reason": "completed", "title": "Delivery", "html_url": "https://github.com/o/r/issues/7"}

def attestation(**overrides):
    value = {"schema_version": 1, "verdict": "accepted", "revision": REVISION, "canonical_id": "DEL-1", "acceptance_sha256": r.scope_hash(ITEM), "checks": [{"name": "full scope journey", "result": "passed", "url": "https://github.com/o/r/actions/runs/5"}], "user_journey": "Create and recover after failure", "limitations": "No provider or installed acceptance claimed"}
    value.update(overrides)
    return {"body": "```warpdrive-acceptance\n" + json.dumps(value) + "\n```", "user": {"login": "reviewer", "type": "User"}, "html_url": "https://github.com/o/r/issues/7#issuecomment-5"}

class FakeAPI:
    def __init__(self, comments=None, permission="write", blockers=None, children=None):
        self.comments = [attestation()] if comments is None else comments
        self.permission = permission
        self.blockers = blockers or []
        self.children = children or []
        self.calls = []
    def request(self, path, method="GET", payload=None):
        self.calls.append((path, method, payload))
        if path.endswith("/permission"):
            return {"permission": self.permission}
        if path.endswith("/issues/7"):
            return ISSUE
        raise AssertionError(path)
    def pages(self, path, key=None):
        if path.endswith("/comments"):
            return self.comments
        if path.endswith("/sub_issues"):
            return self.children
        if path.endswith("/dependencies/blocked_by"):
            return self.blockers
        raise AssertionError(path)

class AcceptanceTests(unittest.TestCase):
    def test_authentication_full_scope_and_exact_revision(self):
        self.assertEqual(r.acceptance(FakeAPI(), "o/r", ISSUE, ITEM, REVISION)["reviewer"], "reviewer")
        for change in ({"revision": "b" * 40}, {"acceptance_sha256": "0" * 64}, {"checks": []}, {"checks": [{"name": "x", "result": "failed", "url": "https://example.com"}]}, {"limitations": ""}):
            with self.subTest(change=change), self.assertRaises(r.GateError):
                r.acceptance(FakeAPI(comments=[attestation(**change)]), "o/r", ISSUE, ITEM, REVISION)
        with self.assertRaises(r.GateError):
            r.acceptance(FakeAPI(permission="read"), "o/r", ISSUE, ITEM, REVISION)
        bot = attestation()
        bot["user"]["type"] = "Bot"
        with self.assertRaises(r.GateError):
            r.acceptance(FakeAPI(comments=[bot]), "o/r", ISSUE, ITEM, REVISION)
    def test_bad_evidence_types_fail_closed(self):
        for checks in ("passed", {"name": "x"}, [{"name": "x", "result": "passed", "url": None}]):
            with self.subTest(checks=checks), self.assertRaises(r.GateError):
                r.acceptance(FakeAPI(comments=[attestation(checks=checks)]), "o/r", ISSUE, ITEM, REVISION)
    def test_nonobject_acceptance_json_is_ignored(self):
        comment = dict(attestation(), body='```warpdrive-acceptance\n[]\n```')
        with self.assertRaises(r.GateError):
            r.acceptance(FakeAPI(comments=[comment]), "o/r", ISSUE, ITEM, REVISION)
    def test_scope_changes_invalidate_historical_acceptance(self):
        new_item = dict(ITEM, acceptance=ITEM["acceptance"] + ["Verify retry"])
        with self.assertRaises(r.GateError):
            r.acceptance(FakeAPI(), "o/r", ISSUE, new_item, REVISION)
    def test_open_blocking_dependencies_prevent_completion(self):
        with self.assertRaises(r.GateError):
            r.verify_issue(FakeAPI(blockers=[{"state": "open"}]), "o/r", 7, REVISION, {"DEL-1": ITEM})
    def test_parent_completion_recursively_verifies_full_children(self):
        parent = dict(ITEM, kind="programme")
        child = dict(ITEM, id="DEL-2", parent="DEL-1")
        child_issue = dict(ISSUE, number=8, body="<!-- warpdrive:delivery-id:DEL-2 -->")
        child_comments = [attestation(canonical_id="DEL-2", acceptance_sha256=r.scope_hash(child))]
        class API(FakeAPI):
            def request(self, path, method="GET", payload=None):
                if path.endswith("/issues/8"):
                    return child_issue
                return super().request(path, method, payload)
            def pages(self, path, key=None):
                if "/issues/8/comments" in path:
                    return child_comments
                if path.endswith("/issues/7/sub_issues"):
                    return self.children
                if path.endswith("/sub_issues"):
                    return []
                return super().pages(path, key)
        api = API(children=[child_issue])
        self.assertEqual(r.verify_issue(api, "o/r", 7, REVISION, {"DEL-1": parent, "DEL-2": child}, allow_parent=True)["id"], "DEL-1")
        child_comments.clear()
        with self.assertRaises(r.GateError):
            r.verify_issue(api, "o/r", 7, REVISION, {"DEL-1": parent, "DEL-2": child}, allow_parent=True)
        child_comments.append(attestation(canonical_id="DEL-2", acceptance_sha256=r.scope_hash(child)))
        child_issue["state"] = "open"
        with self.assertRaises(r.GateError):
            r.verify_issue(api, "o/r", 7, REVISION, {"DEL-1": parent, "DEL-2": child}, allow_parent=True)
        api.children = []
        with self.assertRaises(r.GateError):
            r.verify_issue(api, "o/r", 7, REVISION, {"DEL-1": parent, "DEL-2": child}, allow_parent=True)
    def test_canonical_blocker_cannot_disappear_or_pass_on_closed_state_alone(self):
        blocked = dict(ITEM, dependencies=["DEL-2"])
        dependency = dict(ITEM, id="DEL-2")
        with self.assertRaises(r.GateError):
            r.verify_issue(FakeAPI(), "o/r", 7, REVISION, {"DEL-1": blocked, "DEL-2": dependency})
        blocker_issue = dict(ISSUE, number=8, body="<!-- warpdrive:delivery-id:DEL-2 -->")
        class API(FakeAPI):
            def request(self, path, method="GET", payload=None):
                return blocker_issue if path.endswith("/issues/8") else super().request(path, method, payload)
            def pages(self, path, key=None):
                if "/issues/8/" in path:
                    return []
                return super().pages(path, key)
        with self.assertRaises(r.GateError):
            r.verify_issue(API(blockers=[blocker_issue]), "o/r", 7, REVISION, {"DEL-1": blocked, "DEL-2": dependency})
    def test_labels_and_closed_state_alone_do_not_pass(self):
        with self.assertRaises(r.GateError):
            r.verify_issue(FakeAPI(comments=[]), "o/r", 7, REVISION, {"DEL-1": ITEM})
    def test_evidence_url_credentials_and_plain_http_rejected(self):
        self.assertFalse(r.https_evidence("https://user:password@example.com/secret"))
        self.assertFalse(r.https_evidence("http://example.com"))

class CITests(unittest.TestCase):
    def test_exact_sha_latest_run_and_all_jobs_required(self):
        class API:
            def pages(self, path, key):
                if key == "workflow_runs":
                    return [{"id": 5, "head_sha": REVISION, "head_branch": "main", "event": "push", "run_number": 3, "status": "completed", "conclusion": "success", "html_url": "https://github.com/o/r/actions/runs/5"}]
                return [{"name": "CRM checks", "conclusion": "success"}]
        api = API()
        self.assertEqual(len(r.verify_ci(api, "o/r", REVISION, {"required_workflows": {"ci.yml": ["CRM checks"]}})), 1)
        for revision, jobs in (("b" * 40, ["CRM checks"]), (REVISION, ["CRM checks", "docs"])):
            with self.assertRaises(r.GateError):
                r.verify_ci(api, "o/r", revision, {"required_workflows": {"ci.yml": jobs}})
        class NewerFailed(API):
            def pages(self, path, key):
                values = super().pages(path, key)
                if key == "workflow_runs":
                    values += [dict(values[0], id=6, run_number=4, conclusion="failure")]
                return values
        with self.assertRaises(r.GateError):
            r.verify_ci(NewerFailed(), "o/r", REVISION, {"required_workflows": {"ci.yml": ["CRM checks"]}})

class TraceabilityTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(r, "manifest_items", return_value={"DEL-1": ITEM})
        patcher.start()
        self.addCleanup(patcher.stop)
        candidate = patch.object(r, "load_candidate_json", side_effect=lambda revision, path: json.loads((r.ROOT / path).read_text()))
        candidate.start()
        self.addCleanup(candidate.stop)
    def test_direct_commit_reference_and_explicit_mapping(self):
        class API:
            def request(self, path):
                return ISSUE
            def pages(self, path):
                return []
        def git(*args, **kwargs):
            if args[1] == "merge-base": return ""
            if args[1] == "rev-list": return REVISION
            return "Fix recovery\n\nDelivery-Issues: #7\n"
        with patch.object(r, "run", git):
            self.assertEqual(r.commit_references(API(), "o/r", REVISION, "b" * 40)[0]["issues"], [7])
        def no_ref(*args, **kwargs):
            return "No reference" if args[1] == "show" else git(*args, **kwargs)
        with patch.object(r, "run", no_ref):
            with self.assertRaises(r.GateError):
                r.commit_references(API(), "o/r", REVISION, "b" * 40)
            self.assertEqual(r.commit_references(API(), "o/r", REVISION, "b" * 40, {REVISION: [7]})[0]["issues"], [7])
    def test_unregistered_identity_cannot_satisfy_delivery(self):
        class API:
            def request(self, path):
                return dict(ISSUE, body="<!-- warpdrive:delivery-id:UNREGISTERED -->")
            def pages(self, path):
                return []
        with patch.object(r, "manifest_items", return_value={"DEL-1": ITEM}), patch.object(r, "run", side_effect=["", REVISION, "Fix #7"]), self.assertRaises(r.GateError):
            r.commit_references(API(), "o/r", REVISION, "b" * 40)
    def test_explicit_bounded_scope_preserves_broad_contributions(self):
        class API:
            def request(self, path):
                return dict(ISSUE, number=8, body="<!-- warpdrive:delivery-id:DEL-2 -->", state="open") if path.endswith("/8") else ISSUE
            def pages(self, path):
                return []
        links = {"schema_version": 1, "commit_issues": {}, "delivery_scope": {REVISION: {"delivery_issues": [7], "contributes_to": [8]}}}
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "docs/delivery/commit-links.json"
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(links))
            with patch.object(r, "ROOT", Path(root)), patch.object(r, "manifest_items", return_value={"DEL-1": ITEM, "DEL-2": dict(ITEM, id="DEL-2")}), patch.object(r, "run", side_effect=["", REVISION, "Implement bounded increment refs #8"]):
                row = r.commit_references(API(), "o/r", REVISION, "b" * 40)[0]
                self.assertEqual(row["issues"], [7])
                self.assertEqual(row["contributes_to"], [8])
                self.assertEqual(row["original_issues"], [8])
            links["delivery_scope"][REVISION]["contributes_to"] = []
            target.write_text(json.dumps(links))
            with patch.object(r, "ROOT", Path(root)), patch.object(r, "manifest_items", return_value={"DEL-1": ITEM, "DEL-2": dict(ITEM, id="DEL-2")}), patch.object(r, "run", side_effect=["", REVISION, "Implement bounded increment refs #8"]), self.assertRaises(r.GateError):
                r.commit_references(API(), "o/r", REVISION, "b" * 40)
    def test_associated_pull_requests_appear_in_traceability(self):
        class API:
            def request(self, path):
                return ISSUE
            def pages(self, path):
                return [{"number": 8, "title": "Recovery PR", "html_url": "https://github.com/o/r/pull/8", "merged_at": "2026-11-02T00:00:00Z"}]
        with patch.object(r, "run", side_effect=["", REVISION, "Fix recovery refs #7"]):
            self.assertEqual(r.commit_references(API(), "o/r", REVISION, "b" * 40)[0]["pull_requests"][0]["number"], 8)
    def test_noncanonical_or_pr_reference_cannot_satisfy_delivery(self):
        class API:
            def request(self, path):
                return dict(ISSUE, pull_request={"url": "https://github.com/o/r/pull/7"})
        with patch.object(r, "run", side_effect=["", REVISION, "Fix #7"]), self.assertRaises(r.GateError):
            r.commit_references(API(), "o/r", REVISION, "b" * 40)

class ReleasePlanTests(unittest.TestCase):
    def run_gate(self, plan):
        class API:
            def pages(self, path, key=None):
                if "/milestones?" in path:
                    return [{"number": 1, "title": "Initial", "html_url": "https://example.com/milestone"}]
                if "/issues?" in path:
                    return [ISSUE]
                return []
        policy = {"repository": "o/r", "initial_milestone": "Initial", "initial_journeys": ["deal-stages"], "initial_journey_ids": {"deal-stages": "ops/journey-deal-stages"}, "traceability_baseline": "b" * 40}
        with patch.object(r, "require_revision"), patch.object(r, "manifest_items", return_value={"DEL-1": ITEM}), patch.object(r, "verify_ci", return_value=[]), patch.object(r, "verify_issue", return_value={"number": 7, "id": "DEL-1"}), patch.object(r, "commit_references", return_value=[]), patch.object(r, "load_json", return_value={"version": "1.4.0"}):
            return r.release_gate(API(), plan, policy)
    def test_duplicate_issue_selection_is_rejected(self):
        with self.assertRaises(r.GateError):
            self.run_gate({"schema_version": 1, "revision": REVISION, "version": "1.4.1", "milestone": 1, "issues": [7, 7], "journeys": {"deal-stages": [7]}})
    def test_arbitrary_task_cannot_be_claimed_as_initial_journey(self):
        with self.assertRaises(r.GateError):
            self.run_gate({"schema_version": 1, "revision": REVISION, "version": "1.4.1", "milestone": 1, "issues": [7], "journeys": {"deal-stages": [7]}})

class CLITests(unittest.TestCase):
    def test_selected_revision_is_external_to_committed_plan(self):
        import contextlib
        import io
        plan = {"schema_version": 1, "version": "1.4.1", "milestone": 1, "issues": [7]}
        with patch.object(sys, "argv", ["release.py", "check", "--plan", "plan.json", "--revision", REVISION]), patch.object(r, "trusted_release_policy", return_value={"repository": "o/r"}), patch.object(r, "load_candidate_json", return_value=plan), patch.object(r, "GitHub"), patch.object(r, "release_gate", return_value={}) as gate, contextlib.redirect_stdout(io.StringIO()):
            r.main()
            self.assertEqual(gate.call_args.args[1]["revision"], REVISION)

class WorkflowTests(unittest.TestCase):
    def test_release_is_explicit_main_only_and_pins_selected_revision(self):
        workflow = (r.ROOT / ".github/workflows/release.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertIn('"$RELEASE_MODE" --plan "$RELEASE_PLAN"', workflow)
        self.assertIn("pull-requests: read", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("uses: actions/upload-artifact@", workflow)
    def test_issue_audit_uses_trusted_main_and_no_untrusted_interpolation(self):
        workflow = (r.ROOT / ".github/workflows/delivery-acceptance.yml").read_text()
        self.assertIn("issues:", workflow)
        self.assertIn("ref: main", workflow)
        self.assertIn("issues: write", workflow)
        self.assertNotIn("github.event.issue.body", workflow)

class UploadedAssetTests(unittest.TestCase):
    def test_uploaded_assets_are_verified_by_digest_and_complete_set(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "VERSION"
            target.write_text("1.4.1\n")
            digest = "sha256:" + hashlib.sha256(target.read_bytes()).hexdigest()
            r.verify_uploaded_assets(directory, [{"name": "VERSION", "size": 6, "digest": digest}])
            for assets in ([{"name": "VERSION", "size": 6, "digest": "sha256:" + "0" * 64}], [{"name": "VERSION", "size": 6}], []):
                with self.subTest(assets=assets), self.assertRaises(r.GateError):
                    r.verify_uploaded_assets(directory, assets)

class ArtifactTests(unittest.TestCase):
    def test_artifacts_refuse_unrelated_existing_files(self):
        with tempfile.TemporaryDirectory() as destination:
            (Path(destination) / "unrelated.txt").write_text("preserve this")
            with self.assertRaises(r.GateError):
                r.artifacts({"version": "1.4.1"}, destination)
            self.assertEqual((Path(destination) / "unrelated.txt").read_text(), "preserve this")
    def test_deterministic_notes_source_version_and_checksums(self):
        evidence = {"version": "1.4.1", "revision": REVISION, "milestone": {"title": "Core", "url": "https://example.com"}, "issues": [{"number": 7, "title": "Recovery", "url": ISSUE["html_url"], "acceptance": {"comment": "https://example.com/comment"}}], "commits": [{"sha": REVISION, "url": "https://example.com/commit", "subject": "Fix recovery #7", "issues": [7]}], "ci": [{"workflow": "ci.yml", "url": "https://example.com/run", "jobs": ["CRM checks"]}]}
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second, patch("release_artifacts.run", return_value=b"deterministic git archive"):
            r.artifacts(evidence, first)
            r.artifacts(evidence, second)
            for p in Path(first).iterdir():
                self.assertEqual(p.read_bytes(), (Path(second) / p.name).read_bytes())
            for row in (Path(first) / "SHA256SUMS").read_text().splitlines():
                digest, name = row.split("  ")
                self.assertEqual(digest, hashlib.sha256((Path(first) / name).read_bytes()).hexdigest())
            self.assertIn("Fix recovery", (Path(first) / "release-notes.md").read_text())

if __name__ == "__main__":
    unittest.main()
