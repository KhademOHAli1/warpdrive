import copy
import hashlib
import json
import unittest
from unittest.mock import patch

import release_newsletter as newsletter
import release_mail
import release_artifacts
import release_publication
import release_security
from release_support import GateError, scope_hash
from tracking_model import issue_body

REVISION = "a" * 40
REVIEWED = "b" * 40


def fixture():
    policy = {
        "schema_version": 1, "repository": "o/r", "release_track": "newsletter",
        "version": "1.6.1", "mode": "source_qualified_artifact_publication",
        "qualification_path": newsletter.QUALIFICATION_PATH,
        "plan_directory": newsletter.PLAN_DIRECTORY,
        "pr_integration_baseline": newsletter.PR_BASELINE,
        "unreleased_context_baseline": newsletter.CONTEXT_BASELINE,
        "required_source_paths": ["src/newsletter.ts"],
        "required_workflows": {newsletter.CODEQL_WORKFLOW: sorted(newsletter.CODEQL_JOBS)},
    }
    items = {
        canonical: {"id": canonical, "module": "integrations", "kind": "deliverable",
                    "acceptance": ["Verify the complete bounded source scope"], "source_tasks": []}
        for canonical in newsletter.SCOPES
    }
    mapping = {canonical: {"number": number} for canonical, number in newsletter.SCOPES.items()}
    source = b"verified newsletter source\n"
    record = {
        "schema_version": 1, "qualification_type": "newsletter_source_and_isolated_runtime",
        "result": "qualified", "version": "1.6.1", "reviewed_revision": REVIEWED,
        "reviewer_agent": {"runtime": "codex", "session_id": "10000000-0000-4000-8000-000000000001",
                           "task_id": "/root/source_review"},
        "acceptance_claimed": False, "user_journey_accepted": False,
        "provider_installation_accepted": False,
        "deployment_performed": False, "live_provider_status": "pending",
        "summary": "Source and isolated synthetic delivery were reviewed",
        "limitations": "Live provider and installation acceptance remain pending",
        "checks": [{"name": "Exact Main qualification", "result": "passed",
                    "url": "https://github.com/o/r/actions/runs/1"}],
        "scopes": [{"canonical_id": canonical, "issue": number,
                    "scope_sha256": scope_hash(items[canonical]),
                    "criteria": [{"id": "AC1", "result": "qualified",
                                  "evidence": ["https://github.com/o/r/actions/runs/1"]}]}
                   for canonical, number in newsletter.SCOPES.items()],
        "source_pins": [{"path": "src/newsletter.ts", "sha256": hashlib.sha256(source).hexdigest()}],
    }
    raw = json.dumps(record).encode()
    plan = {
        "schema_version": 1, "release_track": "newsletter", "version": "1.6.1",
        "primary_issue": 1013, "canonical_id": newsletter.PRIMARY, "issues": [1011, 1013],
        "qualification": {"path": newsletter.QUALIFICATION_PATH,
                          "sha256": hashlib.sha256(raw).hexdigest()},
    }

    def read_blob(revision, path):
        if path == "docs/delivery/roadmap.json":
            return json.dumps({"items": list(items.values())}).encode()
        if path == newsletter.QUALIFICATION_PATH:
            return raw
        if path == "src/newsletter.ts":
            return source
        raise AssertionError((revision, path))
    return policy, items, mapping, plan, record, read_blob


class NewsletterQualificationTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.items, self.mapping, self.plan, self.record, self.read = fixture()

    def validate(self, record=None, read=None, ancestor=True):
        return newsletter.validate_qualification(
            self.record if record is None else record, self.items, REVISION, self.policy,
            self.read if read is None else read, lambda old, new: ancestor,
        )

    def test_fixed_source_qualified_proposal_and_exact_report_scope(self):
        newsletter.validate_newsletter_proposal({"version": "1.6.1"}, self.plan, self.plan,
                                                 self.items, self.mapping, self.policy)
        rows = self.validate()
        self.assertEqual([row["number"] for row in rows], [1011, 1013])
        self.assertTrue(all(row["acceptance_claimed"] is False for row in rows))

    def test_source_claims_cannot_turn_into_human_or_provider_acceptance(self):
        for field in newsletter.FALSE_CLAIMS:
            for value in (True, None):
                record = dict(self.record, **{field: value})
                with self.subTest(field=field, value=value), self.assertRaises(GateError):
                    self.validate(record)
        record = dict(self.record, result="accepted")
        with self.assertRaises(GateError):
            self.validate(record)
        for change in ({"deployment_performed": True}, {"deployment_performed": None},
                       {"live_provider_status": "accepted"}, {"live_provider_status": None}):
            with self.subTest(change=change), self.assertRaises(GateError):
                self.validate(dict(self.record, **change))

    def test_review_must_cover_every_clause_and_unchanged_current_and_reviewed_blobs(self):
        for mutate in (
            lambda record: record["scopes"][0].update(scope_sha256="0" * 64),
            lambda record: record["scopes"][0].update(criteria=[]),
            lambda record: record["source_pins"].clear(),
        ):
            record = copy.deepcopy(self.record)
            mutate(record)
            with self.assertRaises(GateError):
                self.validate(record)
        with self.assertRaises(GateError):
            self.validate(ancestor=False)
        def changed(revision, path):
            if revision == REVISION and path == "src/newsletter.ts":
                return b"changed source"
            return self.read(revision, path)
        with self.assertRaisesRegex(GateError, "blob changed"):
            self.validate(read=changed)

    def test_new_version_scope_or_moved_history_boundary_is_rejected(self):
        for change in ({"version": "1.6.2"}, {"issues": [1013]}, {"milestone": 3},
                       {"user_journey_accepted": True}):
            plan = dict(self.plan, **change)
            with self.subTest(change=change), self.assertRaises(GateError):
                newsletter.validate_newsletter_proposal({"version": plan["version"]}, plan, plan,
                                                         self.items, self.mapping, self.policy)
        policy = dict(self.policy, unreleased_context_baseline=REVISION)
        with self.assertRaises(GateError):
            newsletter.validate_policy(policy)

    def test_live_issue_scope_is_verified_without_accepting_or_closing_it(self):
        scopes = self.validate()
        issues = {number: {"number": number, "body": issue_body(self.items[canonical], "o/r"),
                           "title": canonical, "html_url": f"https://github.com/o/r/issues/{number}",
                           "state": "open", "state_reason": None}
                  for canonical, number in newsletter.SCOPES.items()}
        class API:
            def request(self, path):
                return issues[int(path.rsplit("/", 1)[1])]
        rows = newsletter.live_qualified_issues(API(), "o/r", self.items, scopes)
        self.assertTrue(all(row["source_state"] == "open" for row in rows))
        issues[1013]["body"] = issues[1013]["body"].replace("complete bounded source", "reduced source")
        with self.assertRaisesRegex(GateError, "specification differs"):
            newsletter.live_qualified_issues(API(), "o/r", self.items, scopes)


class NewsletterReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.items, self.mapping, self.plan, self.record, self.read = fixture()
        self.raw = json.dumps(self.record).encode()
        self.commits = []
        self.issues = {
            number: {"number": number, "body": issue_body(self.items[canonical], "o/r"),
                     "title": canonical, "html_url": f"https://github.com/o/r/issues/{number}",
                     "state": "open", "state_reason": None}
            for canonical, number in newsletter.SCOPES.items()
        }
        issues = self.issues
        class API:
            def __init__(self):
                self.calls = []
            def request(self, path, method="GET", payload=None):
                self.calls.append((path, method))
                if path.endswith("/git/ref/heads/main"):
                    return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": REVISION}}
                return issues[int(path.rsplit("/", 1)[1])]
            def pages(self, path, key=None):
                if path.endswith(("/tags", "/releases")):
                    return []
                raise AssertionError(path)
        self.api = API()
        self.core = {"repository": "o/r", "traceability_baseline": REVIEWED,
                     "required_workflows": {"full-ci.yml": ["CRM full checks"]}}
        patch.object(newsletter, "trusted_newsletter_policy", return_value=self.policy).start()
        patch.object(newsletter, "manifest_items", return_value=self.items).start()
        patch.object(newsletter, "load_candidate_json", side_effect=self.candidate).start()
        patch.object(newsletter, "run", side_effect=self.git).start()
        patch.object(release_mail, "run", return_value="").start()
        self.ci = patch.object(newsletter, "verify_ci", return_value=[]).start()
        self.addCleanup(patch.stopall)

    def candidate(self, revision, path):
        if path == "package.json":
            return {"version": "1.6.1"}
        if path == "docs/delivery/issue-map.json":
            return {"issues": self.mapping}
        return self.plan

    def git(self, *args, **kwargs):
        if args[:2] == ("git", "show"):
            revision, path = args[2].split(":", 1)
            if path == newsletter.QUALIFICATION_PATH:
                return self.raw
            return self.read(revision, path)
        return ""

    def gate(self, commit_references=None):
        return newsletter.newsletter_release_gate(
            self.api, dict(self.plan, revision=REVISION), self.core, lambda revision: None,
            commit_references or (lambda *args: self.commits),
        )

    def test_source_gate_preserves_open_issues_and_adds_all_four_codeql_jobs(self):
        proof = self.gate()
        self.assertEqual(proof["release_track"], "newsletter")
        self.assertFalse(proof["close_milestone"])
        self.assertTrue(all(item["source_state"] == "open" for item in proof["issues"]))
        self.assertFalse(proof["stages"]["acceptance_claimed"])
        requirements = self.ci.call_args.args[3]["required_workflows"]
        self.assertEqual(set(requirements[newsletter.CODEQL_WORKFLOW]), newsletter.CODEQL_JOBS)
        self.assertEqual(requirements["full-ci.yml"], ["CRM full checks"])

    def test_record_digest_or_moved_main_blocks_before_publication(self):
        self.raw += b" "
        with self.assertRaisesRegex(GateError, "record differs"):
            self.gate()
        self.raw = json.dumps(self.record).encode()
        self.api.request = lambda *args, **kwargs: {
            "ref": "refs/heads/main", "object": {"type": "commit", "sha": REVIEWED}}
        with self.assertRaisesRegex(GateError, "current main tip"):
            self.gate()

    def test_repeated_issue_reads_share_one_snapshot_and_next_gate_reads_fresh_state(self):
        def references(api, repository, revision, base, plan):
            for number in (1011, 1013, 1011, 1013):
                api.request(f"repos/{repository}/issues/{number}")
            return []
        self.gate(references)
        for number in (1011, 1013):
            self.assertEqual(self.api.calls.count((f"repos/o/r/issues/{number}", "GET")), 1)
        self.issues[1013]["state"] = "closed"
        proof = self.gate(references)
        for number in (1011, 1013):
            self.assertEqual(self.api.calls.count((f"repos/o/r/issues/{number}", "GET")), 2)
        self.assertEqual(proof["issues"][1]["source_state"], "closed")

    def test_notes_report_qualification_and_pending_provider_work(self):
        proof = self.gate()
        notes = release_artifacts.notes(proof)
        self.assertIn("Qualified newsletter scope", notes)
        self.assertIn(self.record["limitations"], notes)
        self.assertNotIn("Accepted deliveries", notes)
        self.assertNotIn("acceptance]", notes)
        summary = release_artifacts.publication_notes(proof, "x" * 120001)
        self.assertIn("Full release notes", summary)
        self.assertLess(len(summary.encode()), 120000)

    def test_mixed_commit_keeps_unrelated_source_explicitly_unreleased(self):
        other = {"id": "integration/other", "module": "integrations", "kind": "deliverable",
                 "acceptance": ["Unrelated scope"], "source_tasks": []}
        self.items[other["id"]] = other
        self.issues[999] = {"number": 999, "body": issue_body(other, "o/r"),
                            "title": "Unrelated scope", "html_url": "https://github.com/o/r/issues/999",
                            "state": "open"}
        self.commits = [{"sha": "c" * 40, "issues": [1011, 999], "contributes_to": [],
                         "subject": "Mixed source", "url": "https://github.com/o/r/commit/" + "c" * 40}]
        with patch.object(release_mail, "run", side_effect=lambda *args, **kwargs:
                          "src/other.ts" if "--name-only" in args else ""):
            proof = self.gate()
        self.assertEqual(proof["commits"][0]["qualified_issues"], [1011])
        self.assertEqual(proof["commits"][0]["unreleased_issues"], [999])
        self.assertEqual(proof["commits"][0]["scope_status"],
                         "mixed_qualified_source_and_unreleased_context")
        self.assertTrue(proof["commits"][0]["fresh_production_context"])
        self.assertFalse(proof["unreleased_context"][0]["acceptance_claimed"])
        self.assertNotIn("released_issues", proof["commits"][0])

    def test_verified_source_publication_has_no_issue_or_milestone_writes(self):
        proof = self.gate()
        class Published:
            def __init__(self):
                self.calls = []
            def request(self, path, method="GET", payload=None):
                self.calls.append((path, method))
                if "/releases/" in path:
                    return {"draft": False, "prerelease": False, "tag_name": "v1.6.1",
                            "html_url": "https://github.com/o/r/releases/tag/v1.6.1"}
                if "/git/ref/tags/" in path:
                    return {"object": {"type": "commit", "sha": REVISION}}
                raise AssertionError(path)
        api = Published()
        self.assertEqual(release_publication.record_publication(api, proof, 9),
                         "https://github.com/o/r/releases/tag/v1.6.1")
        self.assertTrue(all(method == "GET" for _, method in api.calls))
        self.assertTrue(all("/issues/" not in path and "/milestones/" not in path
                            for path, _ in api.calls))


class NewsletterCodeQLTests(unittest.TestCase):
    def api(self, go=True):
        class API:
            def request(self, path):
                if path.endswith("/git/ref/heads/main"):
                    return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": REVISION}}
                if "/analyses?" in path:
                    categories = sorted(newsletter.CODEQL_CATEGORIES)
                    if not go:
                        categories.remove("/language:go")
                    return [{"id": index, "commit_sha": REVISION, "category": category,
                             "tool": {"name": "CodeQL"}, "error": ""}
                            for index, category in enumerate(categories, 1)]
                if "/alerts?" in path:
                    return []
                raise AssertionError(path)
        return API()

    def test_newsletter_requires_go_metadata_and_retains_default_three(self):
        proof = release_security.verify_release_code_scanning(
            self.api(), "o/r", REVISION, categories=newsletter.CODEQL_CATEGORIES)
        self.assertEqual(set(proof["categories"]), newsletter.CODEQL_CATEGORIES)
        with self.assertRaises(GateError):
            release_security.verify_release_code_scanning(
                self.api(go=False), "o/r", REVISION, categories=newsletter.CODEQL_CATEGORIES)
        proof = release_security.verify_release_code_scanning(self.api(go=False), "o/r", REVISION)
        self.assertEqual(set(proof["categories"]), release_security.CATEGORIES)
        for categories in (set(), {"/language:go"}, {"/language:unknown"}, {}, "go", [["go"]]):
            with self.subTest(categories=categories), self.assertRaises(GateError):
                release_security.verify_release_code_scanning(self.api(), "o/r", REVISION,
                                                               categories=categories)


if __name__ == "__main__":
    unittest.main()
