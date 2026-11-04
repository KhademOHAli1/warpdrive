import copy
import json
import unittest
from unittest.mock import patch

import release
import release_mail as mail
from release_support import GateError

REVISION = "a" * 40
BOOTSTRAP = "b" * 40
POLICY = {
    "schema_version": 1, "repository": "o/r", "release_track": "mail",
    "assignment": "completion_order", "patch_series": "1.5",
    "programme_version": "1.6.0", "programme_id": "programme/mail",
    "journey_id": "ops/journey-mailbox-recovery", "plan_directory": mail.PLAN_DIRECTORY,
    "pr_integration_baseline": "d" * 40,
    "unreleased_context_baseline": "e" * 40,
    "codeql_workflow_id": "403980173",
    "required_workflows": {"403980173": ["Analyze (javascript-typescript)", "Analyze (actions)", "Analyze (python)"]},
}
CORE = {"repository": "o/r", "traceability_baseline": BOOTSTRAP,
        "required_workflows": {"ci.yml": ["CRM checks"]}}
ITEM = {"id": "mail/A", "module": "mail", "kind": "deliverable",
        "acceptance": ["Complete original scope"], "source_tasks": []}
PARENT = dict(ITEM, id="programme/mail", kind="programme")


def issue(number, identity):
    return {"number": number, "body": f"<!-- warpdrive:delivery-id:{identity} -->",
            "state": "closed", "state_reason": "completed", "title": identity,
            "html_url": f"https://github.com/o/r/issues/{number}"}


def plan(**updates):
    value = {"schema_version": 1, "release_track": "mail", "mail_mode": "incremental",
             "version": "1.5.1", "primary_issue": 7, "canonical_id": "mail/A",
             "milestone": 1, "issues": [7], "journeys": {}}
    value.update(updates)
    return value


class API:
    def __init__(self, issues=None, tags=None, releases=None, all_issues=None):
        self.issues = [issue(7, "mail/A")] if issues is None else issues
        self.all_issues = self.issues if all_issues is None else all_issues
        self.tags, self.releases = tags or [], releases or []

    def request(self, path, method="GET", payload=None):
        if method == "GET" and "/issues/" in path:
            number = int(path.rsplit("/", 1)[1])
            return next(i for i in self.all_issues if i["number"] == number)
        raise AssertionError((path, method))

    def pages(self, path, key=None):
        if "/milestones?" in path:
            return [{"number": 1, "title": "MAIL patch", "html_url": "https://github.com/o/r/milestone/1"}]
        if "/issues?state=all" in path:
            return self.all_issues
        if "/issues?" in path:
            return self.issues
        if path.endswith("/tags"):
            return self.tags
        if path.endswith("/releases"):
            return self.releases
        raise AssertionError(path)


class MailReleaseTests(unittest.TestCase):
    def setUp(self):
        self.items = {ITEM["id"]: ITEM, PARENT["id"]: PARENT}
        self.plans, self.acceptance_mode = {}, "delegated_agent"
        self.ci = patch.object(mail, "verify_ci", return_value=[]).start()
        self.git = patch.object(mail, "run", return_value="").start()
        self.verify = patch.object(mail, "verify_issue", side_effect=self.accepted).start()
        patch.object(mail, "manifest_items", side_effect=lambda revision: self.items).start()
        self.trusted = patch.object(mail, "trusted_mail_policy", return_value=copy.deepcopy(POLICY)).start()
        patch.object(mail, "load_candidate_json", side_effect=self.candidate).start()
        self.addCleanup(patch.stopall)
        self.commits = unittest.mock.Mock(return_value=[])
        self.require = unittest.mock.Mock()

    def accepted(self, api, repo, number, revision, items, **kwargs):
        selected = next(i for i in api.all_issues if i["number"] == number)
        identity = selected["body"].split("delivery-id:")[1].split(" ")[0]
        return {"number": number, "id": identity, "title": identity,
                "url": selected["html_url"], "acceptance": {"mode": self.acceptance_mode,
                "comment": selected["html_url"] + "#issuecomment-1"}}

    def candidate(self, revision, path):
        if path == "package.json":
            return {"version": self.selected["version"]}
        return self.plans.get((revision, path), {k: v for k, v in self.selected.items() if k != "revision"})

    def check(self, selected=None, api=None):
        self.selected = dict(plan() if selected is None else selected, revision=REVISION)
        return mail.mail_release_gate(api or API(), self.selected, CORE, self.require, self.commits)

    def test_one_ready_task_has_truthful_stages_and_all_exact_ci(self):
        evidence = self.check()
        self.require.assert_called_once_with(REVISION)
        self.assertTrue(self.verify.call_args.kwargs["allow_agent"])
        self.assertFalse(self.verify.call_args.kwargs["allow_parent"])
        self.assertFalse(evidence["stages"]["user_journey_accepted"])
        self.assertFalse(evidence["stages"]["mail_programme_accepted"])
        self.assertFalse(evidence["close_milestone"])
        required = self.ci.call_args.args[3]["required_workflows"]
        self.assertEqual(required["ci.yml"], ["CRM checks"])
        self.assertEqual(set(required["403980173"]), set(POLICY["required_workflows"]["403980173"]))
        self.assertEqual(self.ci.call_args.kwargs["dynamic_codeql_workflow"], "403980173")
        self.assertEqual(self.commits.call_args.args[3], BOOTSTRAP)

    def test_technical_opt_in_does_not_override_human_or_provider_rejection(self):
        self.verify.side_effect = GateError("This scope retains human acceptance")
        with self.assertRaisesRegex(GateError, "human acceptance"):
            self.check()

    def test_unselected_bootstrap_scope_is_visible_but_not_released_or_accepted(self):
        self.items["ops/unfinished"] = dict(ITEM, id="ops/unfinished", module="operations")
        context = dict(issue(999, "ops/unfinished"), state="open", state_reason=None)
        api = API(all_issues=[issue(7, "mail/A"), context])
        original = {"sha": BOOTSTRAP, "issues": [999], "original_issues": [999],
                    "subject": "Unfinished history", "url": "https://github.com/o/r/commit/" + BOOTSTRAP}
        self.commits.return_value = [original]
        self.git.side_effect = ["", BOOTSTRAP, "", ""]
        evidence = self.check(api=api)
        self.assertEqual(evidence["commits"][0]["unreleased_issues"], [999])
        self.assertEqual(evidence["commits"][0]["original_issues"], [999])
        self.assertEqual(evidence["commits"][0]["released_issues"], [])
        self.assertEqual(evidence["unreleased_context"][0]["release_status"], "not_released_by_this_publication")
        self.assertFalse(evidence["unreleased_context"][0]["acceptance_claimed"])
        self.assertEqual([call.args[2] for call in self.verify.call_args_list], [7])
        text = release.notes(evidence)
        self.assertIn("UNRELEASED context", text)
        self.assertIn("#999 ops/unfinished", text)
        self.assertIn(BOOTSTRAP[:12], text)
        self.assertEqual(self.commits.call_args.args[3], BOOTSTRAP)

    def test_fresh_unselected_production_delivery_is_not_laundered_as_history(self):
        for numbers in ([999], [7, 999]):
            with self.subTest(numbers=numbers):
                self.commits.return_value = [{"sha": REVISION, "issues": numbers}]
                self.git.side_effect = ["", "", "src/new-unaccepted-feature.ts\n"]
                with self.assertRaisesRegex(GateError, "Fresh production delivery"):
                    self.check()

    def test_unreleased_broad_contribution_is_preserved_without_accepting_parent(self):
        self.items["ops/unfinished"] = dict(ITEM, id="ops/unfinished", module="operations", kind="programme")
        context = dict(issue(999, "ops/unfinished"), state="open", state_reason=None)
        api = API(all_issues=[issue(7, "mail/A"), context])
        self.commits.return_value = [{"sha": REVISION, "issues": [7], "original_issues": [7, 999],
                                     "contributes_to": [999], "pull_requests": [{"number": 927}]}]
        evidence = self.check(api=api)
        self.assertEqual(evidence["commits"][0]["contributes_to"], [999])
        self.assertEqual(evidence["commits"][0]["unreleased_contributions"], [999])
        self.assertEqual(evidence["commits"][0]["released_issues"], [7])
        self.assertEqual([call.args[2] for call in self.verify.call_args_list], [7])

    def test_only_one_mail_leaf_and_every_milestone_issue_are_required(self):
        self.items["mail/B"] = dict(ITEM, id="mail/B")
        api = API(issues=[issue(7, "mail/A"), issue(8, "mail/B")])
        for selected in (plan(), plan(issues=[7, 8])):
            with self.subTest(selected=selected), self.assertRaises(GateError):
                self.check(selected, api)
        with self.assertRaises(GateError):
            self.check(plan(issues=[7, 7]))
        with self.assertRaises(GateError):
            self.check(plan(primary_issue=True))
        with self.assertRaises(GateError):
            self.check(plan(issues=[True]))
        with self.assertRaises(GateError):
            self.check(plan(canonical_id="mail/B"))

    def test_canonical_per_version_plan_cannot_be_replaced_by_another_file(self):
        self.plans[(REVISION, mail.PLAN_DIRECTORY + "/1.5.1.json")] = plan(primary_issue=8)
        with self.assertRaisesRegex(GateError, "per-version plan"):
            self.check()

    def test_draft_and_prerelease_reservations_choose_next_patch(self):
        self.assertEqual(mail.next_mail_patch([]), "1.5.1")
        names = ["v1.2.1", "v1.5.1", "v1.5.3"]
        self.assertEqual(mail.next_mail_patch(names), "1.5.4")
        api = API(releases=[{"tag_name": "v1.5.2", "draft": True, "prerelease": True}])
        with self.assertRaisesRegex(GateError, "next unreserved"):
            self.check(plan(version="1.5.1"), api)
        self.assertEqual(self.check(plan(version="1.5.3"), api)["version"], "1.5.3")

    def test_published_task_canonical_identity_cannot_receive_second_patch(self):
        tags = [{"name": "v1.5.1", "commit": {"sha": "c" * 40}}]
        releases = [{"tag_name": "v1.5.1", "draft": False, "prerelease": False}]
        self.plans[("c" * 40, mail.PLAN_DIRECTORY + "/1.5.1.json")] = plan(primary_issue=99)
        with self.assertRaisesRegex(GateError, "already has a published"):
            self.check(plan(version="1.5.2"), API(tags=tags, releases=releases))

    def test_missing_previous_plan_or_tag_fails_closed(self):
        releases = [{"tag_name": "v1.5.1", "draft": False, "prerelease": False}]
        with self.assertRaisesRegex(GateError, "missing its immutable tag"):
            self.check(plan(version="1.5.2"), API(releases=releases))
        tags = [{"name": "v1.5.1", "commit": {"sha": "c" * 40}}]
        self.plans[("c" * 40, mail.PLAN_DIRECTORY + "/1.5.1.json")] = {}
        with self.assertRaisesRegex(GateError, "matching committed task plan"):
            self.check(plan(version="1.5.2"), API(tags=tags, releases=releases))

    def test_version_tag_and_package_must_match_selected_revision(self):
        api = API(tags=[{"name": "v1.5.1", "commit": {"sha": "c" * 40}}])
        with self.assertRaisesRegex(GateError, "different commit"):
            self.check(api=api)

    def test_missing_codeql_analysis_cannot_pass(self):
        self.trusted.return_value["required_workflows"]["403980173"].pop()
        with self.assertRaisesRegex(GateError, "CodeQL"):
            self.check()

    def test_programme_release_requires_all_canonical_mail_scope_and_recursive_gate(self):
        selected = plan(version="1.6.0", mail_mode="programme", primary_issue=11,
                        canonical_id="programme/mail", issues=[7, 11])
        api = API(issues=[issue(7, "mail/A"), issue(11, "programme/mail")])
        evidence = self.check(selected, api)
        self.assertTrue(evidence["stages"]["mail_programme_accepted"])
        self.assertTrue(evidence["close_milestone"])
        self.assertTrue(all(call.kwargs["allow_parent"] for call in self.verify.call_args_list))
        self.items["mail/B"] = dict(ITEM, id="mail/B")
        with self.assertRaisesRegex(GateError, "every canonical MAIL item"):
            self.check(selected, api)
        for bad in (plan(version="1.6.0"), plan(version="1.5.4", mail_mode="programme")):
            with self.subTest(plan=bad), self.assertRaises(GateError):
                self.check(bad)

    def test_programme_coverage_keeps_previously_released_tasks_in_old_milestones(self):
        old_child = dict(issue(7, "mail/A"), milestone={"number": 12})
        programme = dict(issue(11, "programme/mail"), milestone={"number": 16})
        api = API(issues=[programme], all_issues=[old_child, programme])
        selected = plan(version="1.6.0", mail_mode="programme", primary_issue=11,
                        canonical_id="programme/mail", issues=[11])
        evidence = self.check(selected, api)
        self.assertEqual([i["number"] for i in evidence["issues"]], [11])
        self.assertEqual({i["number"] for i in evidence["programme_coverage"]}, {7, 11})
        self.assertEqual(old_child["milestone"]["number"], 12)
        self.assertEqual([i["number"] for i in api.issues], [11])

    def test_nonmail_support_scope_still_requires_full_acceptance(self):
        self.items["ops/support"] = dict(ITEM, id="ops/support", module="operations")
        api = API(issues=[issue(7, "mail/A"), issue(8, "ops/support")])
        self.check(plan(issues=[7, 8]), api)
        self.assertEqual([call.args[2] for call in self.verify.call_args_list], [7, 8])

    def test_new_commits_need_merged_prs_without_skipping_old_history(self):
        self.git.side_effect = ["", BOOTSTRAP, "", REVISION]
        self.commits.return_value = [{"sha": BOOTSTRAP, "issues": [7], "pull_requests": []},
                                     {"sha": REVISION, "issues": [7], "pull_requests": []}]
        with self.assertRaisesRegex(GateError, "merged pull-request"):
            self.check()
        self.git.side_effect = ["", BOOTSTRAP, "", REVISION]
        self.commits.return_value[-1]["pull_requests"] = [{"number": 927}]
        self.assertEqual(len(self.check()["commits"]), 2)
        self.assertEqual(self.commits.call_args.args[3], BOOTSTRAP)

    def test_unknown_stable_classification_is_not_ignored_for_task_reuse(self):
        releases = [{"tag_name": "v1.5.1", "draft": False}]
        with self.assertRaisesRegex(GateError, "explicit stable"):
            self.check(plan(version="1.5.2"), API(releases=releases))

    def test_second_patch_checks_only_included_new_commits_for_pr_evidence(self):
        self.items["mail/B"] = dict(ITEM, id="mail/B")
        prior = "c" * 40
        self.plans[(prior, mail.PLAN_DIRECTORY + "/1.5.1.json")] = plan()
        api = API(issues=[issue(8, "mail/B")],
                  tags=[{"name": "v1.5.1", "commit": {"sha": prior}}],
                  releases=[{"tag_name": "v1.5.1", "draft": False, "prerelease": False}])
        self.git.side_effect = ["", prior, "", prior + "\n" + REVISION]
        self.commits.return_value = [{"sha": REVISION, "issues": [8], "pull_requests": [{"number": 928}]}]
        evidence = self.check(plan(version="1.5.2", primary_issue=8,
                                   canonical_id="mail/B", issues=[8]), api)
        self.assertEqual(evidence["base_revision"], prior)
        self.assertEqual(self.commits.call_args.args[3], prior)


class TrustedAndCoreTests(unittest.TestCase):
    def test_mail_policy_cannot_be_supplied_only_by_candidate(self):
        with patch.object(mail, "run", return_value=REVISION), patch.object(mail, "load_candidate_json", side_effect=[POLICY, dict(POLICY, assignment="task_number")]), self.assertRaisesRegex(GateError, "trusted main policy"):
            mail.trusted_mail_policy(REVISION, "o/r")

    def test_core_cannot_publish_reserved_mail_version(self):
        for value in ("1.5.1", "1.6.0"):
            with self.subTest(version=value), self.assertRaisesRegex(GateError, "explicit MAIL"):
                release.release_gate(API(), {"version": value}, CORE)
        self.assertFalse(mail.is_mail_version("1.6.1"))

    def test_published_mail_patch_does_not_remove_first_core_journey_gate(self):
        api = API(releases=[{"tag_name": "v1.5.1", "draft": False, "prerelease": False}])
        policy = dict(CORE, initial_journeys=["deal-stages"],
                      initial_journey_ids={"deal-stages": "ops/journey-deal-stages"})
        selected = dict(plan(version="1.7.0"), release_track="core", revision=REVISION)
        with patch.object(release, "require_revision"), patch.object(release, "manifest_items", return_value={}):
            with self.assertRaisesRegex(GateError, "journey gates"):
                release.release_gate(api, selected, policy)

    def test_mail_publication_does_not_close_broad_milestone(self):
        from release_publication_test import PublicationAPI, EVIDENCE
        api = PublicationAPI()
        evidence = dict(EVIDENCE, release_track="mail", close_milestone=False)
        release.record_publication(api, evidence, 9)
        self.assertEqual(api.milestone["state"], "open")
        self.assertFalse(any("/milestones/" in path and method == "PATCH"
                             for path, method, payload in api.writes))

    def test_publication_never_labels_comments_or_closes_unreleased_context(self):
        from release_publication_test import PublicationAPI, EVIDENCE
        api = PublicationAPI()
        evidence = dict(EVIDENCE, release_track="mail", close_milestone=False,
                        unreleased_context=[{"number": 999, "release_status": "not_released_by_this_publication"}])
        release.record_publication(api, evidence, 9)
        self.assertFalse(any("/issues/999" in path for path, method, payload in api.writes))
        self.assertEqual(api.milestone["state"], "open")


if __name__ == "__main__":
    unittest.main()
