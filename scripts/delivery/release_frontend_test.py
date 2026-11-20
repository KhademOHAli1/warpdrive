"""Offline fixtures only: no actual qualification, GitHub writes or deployment."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release
import release_artifacts
import release_frontend as frontend
import release_mail
from release_publication import record_publication
from release_support import GateError, version_tuple

REVISION, REVIEWED = "a" * 40, "b" * 40
REPO = "KhademOHAli1/warpdrive"


def fixtures(version=frontend.VERSION):
    scope = frontend.frontend_scope(version)
    policy = json.loads((Path(__file__).resolve().parents[2] / frontend.POLICY_PATH).read_text())
    policy.update(version=version, qualification_path=scope["qualification_path"],
                  required_source_paths=sorted(scope["source_paths"]),
                  contributions=scope["contributions"], original_integrated_revisions=sorted(scope["heads"]))
    blobs = {path: b"offline source fixture\n" for path in scope["source_paths"]}
    blobs[frontend.FOOTER_PATH] = f'const FRONTEND_VERSION = "{version}";\n'.encode()
    blobs[frontend.PACKAGE_PATH] = json.dumps({"version": version}).encode()
    record = {
        "schema_version": 1, "qualification_type": "frontend_source_and_isolated_runtime",
        "result": "qualified", "version": version, "reviewed_revision": REVIEWED,
        "reviewer_agent": {"runtime": "codex", "session_id": "10000000-0000-4000-8000-000000000001",
                           "task_id": "/root/offline_fixture"},
        **{field: False for field in frontend.FALSE_CLAIMS},
        "summary": "Offline unit fixture, not an actual frontend qualification.",
        "limitations": "Fixtures exercise release gates only; no runtime or publication evidence.",
        "checks": [{"name": name, "result": "passed", "url": "https://example.invalid/offline-fixture"}
                   for name in sorted(scope["checks"])],
        "source_pins": [{"path": path, "sha256": hashlib.sha256(raw).hexdigest()}
                        for path, raw in sorted(blobs.items())],
    }
    raw = json.dumps(record).encode()
    plan = {"schema_version": 1, "release_track": "frontend", "version": version,
            "qualification": {"path": scope["qualification_path"], "sha256": hashlib.sha256(raw).hexdigest()},
            "required_integrated_revisions": sorted(scope["heads"])}
    return policy, blobs, record, raw, plan


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.blobs, self.record, self.raw, self.plan = fixtures()

    def qualify(self, record=None, read=None, ancestor=True):
        return frontend.validate_qualification(
            self.record if record is None else record, REVISION, self.policy,
            read or (lambda revision, path: self.blobs[path]), lambda old, new: ancestor,
        )

    def test_completed_fixture_uses_canonical_stable_version(self):
        frontend.validate_proposal(self.plan, self.plan, self.policy)
        self.qualify()
        self.assertEqual(version_tuple(frontend.VERSION), (1, 7, 2))
        with self.assertRaises(GateError):
            version_tuple("1.7.1.5")
        self.assertEqual(version_tuple("1.7.1"), (1, 7, 1))
        for version, expected in ((frontend.HEADLESS_VERSION, (1, 8, 1)),
                                  (frontend.INBOX_VERSION, (1, 8, 2))):
            with self.subTest(version=version):
                policy, blobs, record, _, plan = fixtures(version)
                frontend.validate_proposal(plan, plan, policy)
                frontend.validate_qualification(record, REVISION, policy,
                                                lambda revision, path: blobs[path], lambda old, new: True)
                self.assertEqual(version_tuple(version), expected)

    def test_active_policy_matches_a_supported_scope_and_names_existing_sources(self):
        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / frontend.POLICY_PATH).read_text())
        scope = frontend.validate_policy(policy)
        self.assertTrue(all((root / path).is_file() for path in scope["source_paths"]))

    def test_incomplete_templates_fail_closed(self):
        plan = copy.deepcopy(self.plan)
        plan["qualification"]["sha256"] = None
        record = dict(self.record, result="pending", reviewed_revision=None)
        with self.assertRaises(GateError):
            frontend.validate_proposal(plan, plan, self.policy)
        with self.assertRaises(GateError):
            self.qualify(record)

    def test_policy_cannot_reduce_checks_scope_or_move_history(self):
        for change in ({"version": "1.7.1.6"}, {"required_source_paths": []},
                       {"required_workflows": {frontend.CODEQL_WORKFLOW: ["Analyze (python)"]}},
                       {"pr_integration_baseline": REVISION}, {"unreleased_context_baseline": REVISION},
                       {"contributions": {"integration/UX-010": 999}}, {"original_integrated_revisions": []}):
            with self.subTest(change=change), self.assertRaises(GateError):
                frontend.validate_policy(dict(self.policy, **change))

    def test_candidate_frontend_policy_must_match_trusted_main(self):
        with patch.object(frontend, "run", return_value=REVISION), \
                patch.object(frontend, "load_candidate_json", return_value=self.policy):
            self.assertEqual(frontend.trusted_frontend_policy(REVISION, REPO), self.policy)
        altered = dict(self.policy, required_source_paths=[])
        with patch.object(frontend, "run", return_value=REVISION), \
                patch.object(frontend, "load_candidate_json", side_effect=[self.policy, altered]), \
                self.assertRaisesRegex(GateError, "trusted Main"):
            frontend.trusted_frontend_policy(REVISION, REPO)

    def test_additional_honest_branch_pins_are_allowed_without_omitting_originals(self):
        plan = dict(self.plan, required_integrated_revisions=self.plan["required_integrated_revisions"] + ["1" * 40])
        frontend.validate_proposal(plan, plan, self.policy)
        plan["required_integrated_revisions"] = plan["required_integrated_revisions"][1:]
        with self.assertRaisesRegex(GateError, "original requested"):
            frontend.validate_proposal(plan, plan, self.policy)

    def test_report_cannot_claim_acceptance_or_deployment(self):
        for field in frontend.FALSE_CLAIMS:
            for value in (True, None):
                with self.subTest(field=field, value=value), self.assertRaises(GateError):
                    self.qualify(dict(self.record, **{field: value}))
        for change in ({"result": "accepted"}, {"reviewed_revision": None}, {"reviewer_agent": {}},
                       {"summary": ""}, {"limitations": ""}):
            with self.subTest(change=change), self.assertRaises(GateError):
                self.qualify(dict(self.record, **change))

    def test_all_runtime_checks_need_actual_passed_evidence(self):
        for transform in (lambda rows: rows[:-1], lambda rows: rows + rows[:1],
                          lambda rows: [dict(row, result="pending") for row in rows],
                          lambda rows: [dict(row, url=None) for row in rows]):
            with self.subTest(transform=transform), self.assertRaises(GateError):
                self.qualify(dict(self.record, checks=transform(self.record["checks"])))

    def test_source_pins_must_cover_unchanged_reviewed_and_selected_blobs(self):
        for mutate in (lambda value: value["source_pins"].pop(),
                       lambda value: value["source_pins"].append(value["source_pins"][0]),
                       lambda value: value["source_pins"][0].update(sha256="0" * 64),
                       lambda value: value["source_pins"][0].update(path="../unsafe")):
            record = copy.deepcopy(self.record)
            mutate(record)
            with self.subTest(mutate=mutate), self.assertRaises(GateError):
                self.qualify(record)
        with self.assertRaises(GateError):
            self.qualify(ancestor=False)
        for changed_revision in (REVIEWED, REVISION):
            def read(revision, path):
                return b"changed" if revision == changed_revision else self.blobs[path]
            with self.subTest(revision=changed_revision), self.assertRaisesRegex(GateError, "blob changed"):
                self.qualify(read=read)

    def test_footer_counter_must_match_even_with_matching_hashes(self):
        self.blobs[frontend.FOOTER_PATH] = b'const FRONTEND_VERSION = "1.7.1.4";\n'
        for pin in self.record["source_pins"]:
            pin["sha256"] = hashlib.sha256(self.blobs[pin["path"]]).hexdigest()
        with self.assertRaisesRegex(GateError, "footer"):
            self.qualify()

    def test_plan_cannot_accept_broad_issues_or_publish_another_version(self):
        for change in ({"version": "1.7.1.6"}, {"milestone": 1}, {"issues": [119]},
                       {"required_integrated_revisions": []},
                       {"required_integrated_revisions": ["a" * 40] * 4}):
            plan = dict(self.plan, **change)
            with self.subTest(change=change), self.assertRaises(GateError):
                frontend.validate_proposal(plan, plan, self.policy)
        with self.assertRaisesRegex(GateError, "per-version"):
            frontend.validate_proposal(self.plan, dict(self.plan, version="1.7.1.4"), self.policy)


class GateAPI:
    def __init__(self, contributions=None):
        self.contributions = frontend.CONTRIBUTIONS if contributions is None else contributions
        self.main = REVISION
        self.tags, self.releases, self.calls = [], [], []
    def request(self, path, method="GET", payload=None):
        self.calls.append((path, method, payload))
        if path.endswith("/git/ref/heads/main"):
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.main}}
        if "/issues/" in path:
            number = int(path.rsplit("/", 1)[1])
            canonical = next(key for key, value in self.contributions.items() if value == number)
            return {"number": number, "body": f"<!-- warpdrive:delivery-id:{canonical} -->",
                    "title": canonical, "html_url": f"https://github.com/{REPO}/issues/{number}", "state": "open"}
        raise AssertionError((path, method))
    def pages(self, path, key=None):
        if path.endswith("/tags"):
            return self.tags
        if path.endswith("/releases"):
            return self.releases
        raise AssertionError(path)


class FrontendGateTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.blobs, self.record, self.raw, self.plan = fixtures()
        self.plan["revision"] = REVISION
        self.items = {canonical: {"id": canonical, "kind": "task", "acceptance": ["Broad existing scope"]}
                      for canonical in frontend.CONTRIBUTIONS}
        self.core = {"repository": REPO, "traceability_baseline": REVIEWED,
                     "required_workflows": {"full-ci.yml": ["CRM full checks", "Marketing site full checks", "Documentation site full checks"],
                                            "full-quality.yml": ["Full browser smoke checks"]}}
        self.api = GateAPI()
        self.git_calls, self.missing_head, self.recent = [], None, ""
        self.require_revision = unittest.mock.Mock()
        self.references = unittest.mock.Mock(return_value=[])
        self.ci = patch.object(frontend, "verify_ci", return_value=[]).start()
        patch.object(frontend, "trusted_frontend_policy", return_value=self.policy).start()
        patch.object(frontend, "manifest_items", return_value=self.items).start()
        patch.object(frontend, "load_candidate_json", side_effect=self.candidate).start()
        patch.object(frontend, "run", side_effect=self.git).start()
        patch.object(release_mail, "run", return_value="").start()
        self.addCleanup(patch.stopall)

    def candidate(self, revision, path):
        if path == "package.json":
            return json.loads(self.blobs[frontend.PACKAGE_PATH])
        if path == "docs/delivery/issue-map.json":
            return {"issues": {key: {"number": number} for key, number in self.policy["contributions"].items()}}
        return {key: value for key, value in self.plan.items() if key != "revision"}

    def git(self, *args, **kwargs):
        self.git_calls.append(args)
        if args[:2] == ("git", "show"):
            revision, path = args[2].split(":", 1)
            return self.raw if path == self.policy["qualification_path"] else self.blobs[path]
        if args[:2] == ("git", "rev-list"):
            return self.recent
        if args[:3] == ("git", "merge-base", "--is-ancestor") and args[3] == self.missing_head:
            raise GateError("Missing branch ancestry")
        return ""

    def gate(self, allow=False):
        return frontend.frontend_release_gate(self.api, self.plan, self.core,
                                              self.require_revision, self.references, allow_published=allow)

    def test_exact_main_ci_and_scoped_ancestries_without_issue_completion(self):
        for version in (frontend.VERSION, frontend.HEADLESS_VERSION, frontend.INBOX_VERSION):
            policy, self.blobs, self.record, self.raw, self.plan = fixtures(version)
            self.policy.clear()
            self.policy.update(policy)
            self.plan["revision"] = REVISION
            self.items.clear()
            self.items.update({canonical: {"id": canonical, "kind": "task", "acceptance": ["Broad existing scope"]}
                               for canonical in policy["contributions"]})
            self.api.contributions = policy["contributions"]
            self.require_revision.reset_mock()
            evidence = self.gate()
            self.require_revision.assert_called_once_with(REVISION)
            required = self.ci.call_args.args[3]["required_workflows"]
            self.assertEqual(required["full-ci.yml"], self.core["required_workflows"]["full-ci.yml"])
            self.assertEqual(required["full-quality.yml"], ["Full browser smoke checks"])
            self.assertEqual(set(required[frontend.CODEQL_WORKFLOW]), frontend.CODEQL_JOBS)
            self.assertEqual(self.ci.call_args.kwargs["dynamic_codeql_workflow"], frontend.CODEQL_WORKFLOW)
            for head in self.plan["required_integrated_revisions"]:
                self.assertIn(("git", "merge-base", "--is-ancestor", head, REVISION), self.git_calls)
            self.assertEqual(evidence["product_version"], version)
            self.assertEqual(evidence["version"], version)
            self.assertEqual(evidence["issues"], [])
            self.assertFalse(evidence["close_milestone"])
            self.assertTrue(all(row["source_state"] == "open" and row["acceptance_claimed"] is False
                                for row in evidence["contributions"]))
            self.assertTrue(all(method == "GET" for _, method, _ in self.api.calls))

    def test_product_package_must_match_the_selected_stable_release(self):
        original = self.candidate
        for version, reason in (("1.7.1", "committed package version"),
                                ("1.7.1.5", "MAJOR.MINOR.PATCH")):
            def candidate(revision, path):
                return {"version": version} if path == "package.json" else original(revision, path)
            with self.subTest(version=version), \
                    patch.object(frontend, "load_candidate_json", side_effect=candidate), \
                    self.assertRaisesRegex(GateError, reason):
                self.gate()

    def test_stale_main_missing_ci_missing_branch_and_changed_report_hold(self):
        self.api.main = REVIEWED
        with self.assertRaisesRegex(GateError, "current main tip"):
            self.gate()
        self.api.main = REVISION
        self.ci.side_effect = GateError("Latest exact-main full CI failed")
        with self.assertRaisesRegex(GateError, "full CI failed"):
            self.gate()
        self.ci.side_effect = None
        self.missing_head = self.plan["required_integrated_revisions"][0]
        with self.assertRaisesRegex(GateError, "ancestry"):
            self.gate()
        self.missing_head = None
        self.raw += b" "
        with self.assertRaisesRegex(GateError, "plan pin"):
            self.gate()

    def test_reserved_versions_wrong_tags_and_existing_publications_hold(self):
        self.api.tags = [{"name": "v1.7.3", "commit": {"sha": REVIEWED}}]
        with self.assertRaisesRegex(GateError, "stable tag/release"):
            self.gate()
        self.api.tags = [{"name": "v1.7.2", "commit": {"sha": REVIEWED}}]
        with self.assertRaisesRegex(GateError, "another revision"):
            self.gate()
        self.api.tags = []
        self.api.releases = [{"tag_name": "v1.7.2", "draft": False, "prerelease": False}]
        with self.assertRaisesRegex(GateError, "already published"):
            self.gate()
        self.gate(allow=True)

    def test_stable_release_reservations_are_not_confused_with_display_counters(self):
        self.api.tags = [{"name": "v1.7.1", "commit": {"sha": REVIEWED}},
                         {"name": "v1.7.1.5", "commit": {"sha": REVIEWED}}]
        self.gate()
        self.api.tags.append({"name": "1.7.2", "commit": {"sha": REVIEWED}})
        with self.assertRaisesRegex(GateError, "stable tag/release"):
            self.gate()
        self.api.tags.pop()
        self.api.releases = [{"tag_name": "v1.7.3", "draft": True, "prerelease": False}]
        with self.assertRaisesRegex(GateError, "stable tag/release"):
            self.gate()

    def test_drafts_do_not_truncate_ledger_and_new_commits_need_merged_prs(self):
        self.api.tags = [{"name": "v1.7.0", "commit": {"sha": REVIEWED}},
                         {"name": "v1.7.1", "commit": {"sha": "c" * 40}}]
        self.api.releases = [{"tag_name": "v1.7.0", "draft": False, "prerelease": False},
                             {"tag_name": "v1.7.1", "draft": True, "prerelease": False}]
        self.gate()
        self.assertEqual(self.references.call_args.args[3], REVIEWED)
        commit = {"sha": "d" * 40, "issues": [119], "subject": "Fixture", "url": "https://example.invalid/commit",
                  "contributes_to": [], "pull_requests": []}
        self.references.return_value = [commit]
        self.recent = commit["sha"]
        with self.assertRaisesRegex(GateError, "merged PR"):
            self.gate()
        commit["pull_requests"] = [{"number": 1}]
        evidence = self.gate()
        self.assertEqual(evidence["commits"][0]["released_issues"], [])
        self.assertEqual(evidence["commits"][0]["unreleased_issues"], [119])


class PublicationAPI(GateAPI):
    def __init__(self):
        super().__init__()
        self.release = {"id": 9, "draft": True, "prerelease": False, "tag_name": "v1.7.2", "assets": [],
                        "html_url": f"https://github.com/{REPO}/releases/tag/v1.7.2"}
        self.tags = [{"name": "v1.7.2", "commit": {"sha": REVISION}}]
        self.releases = [self.release]
        self.languages = ["javascript-typescript", "actions", "python", "go"]
        self.alerts, self.writes, self.latest_id = [], [], 9
    def request(self, path, method="GET", payload=None):
        if method != "GET":
            self.writes.append((path, method, payload))
        if "/code-scanning/analyses?" in path:
            return [{"id": i, "commit_sha": REVISION, "category": "/language:" + language,
                     "tool": {"name": "CodeQL"}, "error": ""} for i, language in enumerate(self.languages, 1)]
        if "/code-scanning/alerts?" in path:
            return self.alerts
        if path.endswith("/git/ref/tags/v1.7.2"):
            return {"object": {"type": "commit", "sha": REVISION}}
        if path.endswith("/releases/latest"):
            return dict(self.release, id=self.latest_id)
        if path.endswith("/releases/9"):
            if payload:
                self.release.update(payload)
            return self.release
        return super().request(path, method, payload)


def publication_evidence():
    _, _, record, _, plan = fixtures()
    return {"repository": REPO, "release_track": "frontend", "version": "1.7.2",
            "product_version": "1.7.2", "revision": REVISION, "qualification": {"record": record},
            "contributions": [], "issues": [], "commits": [], "ci": [], "unreleased_context": [],
            "required_integrated_revisions": plan["required_integrated_revisions"]}


class PublicationTests(unittest.TestCase):
    def publish(self, api, mode="publish", evidence=None):
        evidence = evidence or publication_evidence()
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "run"), \
                patch.object(release, "verify_uploaded_assets"), \
                patch.object(release, "trusted_release_policy", return_value={}), \
                patch.object(release, "release_gate", return_value=evidence):
            return release.publish(api, {}, evidence, directory, mode)

    def test_frontend_dispatch_is_separate_from_core_semver_gate(self):
        with patch.object(release, "frontend_release_gate", return_value={"fixture": True}) as gate:
            self.assertEqual(release.release_gate(None, {"release_track": "frontend"}, {}), {"fixture": True})
        gate.assert_called_once()

    def test_publisher_requires_go_and_blocks_live_findings_before_any_write(self):
        for change in ("missing-go", "high", "critical", "error"):
            api = PublicationAPI()
            if change == "missing-go":
                api.languages.remove("go")
            else:
                api.alerts = [{"state": "open", "tool": {"name": "CodeQL"},
                               "rule": {"severity": "error" if change == "error" else "warning",
                                        "security_severity_level": None if change == "error" else change}}]
            with self.subTest(change=change), self.assertRaises(GateError):
                self.publish(api)
            self.assertEqual(api.writes, [])

    def test_frontend_publish_marks_latest_and_has_no_issue_or_milestone_writes(self):
        api = PublicationAPI()
        self.assertEqual(self.publish(api), api.release["html_url"])
        self.assertTrue(any(payload.get("make_latest") == "true" for _, _, payload in api.writes))
        self.assertEqual(api.release["name"], "Warpdrive frontend 1.7.2")
        self.assertFalse(any("/issues" in path or "/milestones" in path for path, _, _ in api.writes))
        previous = len(api.writes)
        self.publish(api)
        self.assertEqual(len(api.writes), previous)
        api.latest_id = 10
        with self.assertRaisesRegex(GateError, "latest stable"):
            record_publication(api, publication_evidence(), 9)

    def test_notes_and_checksum_assets_preserve_source_only_boundaries(self):
        evidence = publication_evidence()
        text = release_artifacts.notes(evidence)
        self.assertIn("frontend 1.7.2", text)
        self.assertIn("package version `1.7.2`", text)
        self.assertNotIn("four-part frontend release", text)
        self.assertNotIn("Accepted deliveries", text)
        summary = release_artifacts.publication_notes(evidence, "x" * 120001)
        self.assertLessEqual(len(summary.encode()), release_artifacts.PUBLICATION_BODY_MAX_BYTES)
        self.assertIn("unaccepted source context", summary)
        with tempfile.TemporaryDirectory() as directory, patch.object(release_artifacts, "run", return_value=b"offline git archive fixture"):
            out = release_artifacts.artifacts(evidence, directory)
            before = {path.name: path.read_bytes() for path in out.iterdir()}
            release_artifacts.artifacts(evidence, directory)
            self.assertEqual(before, {path.name: path.read_bytes() for path in out.iterdir()})
            assets = [{"name": path.name, "size": path.stat().st_size,
                       "digest": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()} for path in out.iterdir()]
            release_artifacts.verify_uploaded_assets(directory, assets)
            assets[0]["digest"] = "sha256:" + "0" * 64
            with self.assertRaises(GateError):
                release_artifacts.verify_uploaded_assets(directory, assets)
        evidence["qualification"]["record"]["summary"] = "é" * 120001
        with self.assertRaisesRegex(GateError, "summary exceeds"):
            release_artifacts.publication_notes(evidence)


if __name__ == "__main__":
    unittest.main()
