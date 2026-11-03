"""Adversarial delegated-agent completion fixtures; no network, services or app jobs."""
import hashlib
import json
import unittest
from unittest.mock import patch

import release_gates as gates
from release_test import ISSUE, REVISION, attestation


ITEM = {
    "id": "technical/example", "kind": "deliverable",
    "acceptance": ["Specify the complete contract", "Cover rejected cases"],
    "source_tasks": [{"source": "fixture", "id": "EX-1"}],
}
REVIEWED = "b" * 40
SESSION = "01a19251-a472-7cd1-86cd-8dc245dd5b84"
ACCEPTOR = {"runtime": "codex", "session_id": SESSION, "task_id": "/root"}
REVIEWER = dict(ACCEPTOR, task_id="/root/independent_review")
ACTOR = {"id": 123, "login": "maintainer"}
SOURCE = b"reviewed implementation\n"
SOURCE_PATH = "src/feature.ts"
REVIEW_PATH = "docs/delivery/technical-reviews/example.json"
EVIDENCE = "https://github.com/o/r/blob/" + REVIEWED + "/" + SOURCE_PATH


def policy():
    return {
        "schema_version": 1, "repository": "o/r",
        "mode": "delegated_agent_technical_only",
        "delegated_actors": [ACTOR], "human_only_ids": [],
        "required_workflows": {"12345": ["Analyze (python)"]}, "codeql_workflow_id": "12345",
        "items": {ITEM["id"]: {
            "classification": "bounded_technical",
            "acceptance_sha256": gates.scope_hash(ITEM),
            "rationale": "Bounded source contract; no user-journey acceptance.",
            "required_source_paths": [SOURCE_PATH],
        }},
    }


def review():
    return {
        "schema_version": 1, "review_type": "independent_source_review",
        "result": "accepted", "canonical_id": ITEM["id"],
        "acceptance_sha256": gates.scope_hash(ITEM),
        "reviewed_revision": REVIEWED, "reviewer_agent": REVIEWER,
        "summary": "Reviewed both clauses and all relevant source.",
        "limitations": "No live provider, user-journey or release acceptance.",
        "criteria": [{"id": f"AC{n}", "result": "passed", "evidence": [EVIDENCE]} for n in (1, 2)],
        "source_pins": [{"path": SOURCE_PATH, "sha256": hashlib.sha256(SOURCE).hexdigest()}],
    }


class API:
    def __init__(self, comment):
        self.comment = comment
        self.permission = "write"
        self.ci_status = "completed"
        self.ci_conclusion = "success"
        self.ci_revision = REVISION
        self.ci_branch = "main"
        self.ci_event = "push"
        self.jobs = ["CRM checks", "Analyze (python)"]
        self.newer_failed = False
        self.workflow_events = {}
        self.dynamic_identity = {"workflow_id": 12345, "path": "dynamic/github-code-scanning/codeql"}
        self.calls = []

    def request(self, path, method="GET", payload=None):
        self.calls.append((path, method, payload))
        if path.endswith("/permission"):
            return {"permission": self.permission}
        if path.endswith("/issues/7"):
            return dict(ISSUE, body=f"<!-- warpdrive:delivery-id:{ITEM['id']} -->")
        raise AssertionError(path)

    def pages(self, path, key=None):
        self.calls.append((path, "GET", None))
        if path.endswith("/comments"):
            return [self.comment]
        if path.endswith("/sub_issues") or path.endswith("/dependencies/blocked_by"):
            return []
        if key == "workflow_runs":
            result = [{"id": 5, "head_sha": self.ci_revision, "head_branch": self.ci_branch,
                       "event": self.ci_event, "run_number": 1, "run_attempt": 1,
                       "status": self.ci_status, "conclusion": self.ci_conclusion,
                       "html_url": "https://github.com/o/r/actions/runs/5"}]
            workflow = path.split("/workflows/", 1)[1].split("/runs", 1)[0]
            result[0]["event"] = self.workflow_events.get(workflow, self.ci_event)
            result[0].update(self.dynamic_identity)
            if self.newer_failed:
                result.append(dict(result[0], id=6, run_number=2, conclusion="failure"))
            return result
        if key == "jobs":
            return [{"name": name, "conclusion": "success"} for name in self.jobs]
        raise AssertionError(path)


class DelegatedAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.policy = policy()
        self.candidate_policy = None
        self.release_policy = {"repository": "o/r", "required_workflows": {"ci.yml": ["CRM checks"]}, "initial_journey_ids": {}}
        self.review = review()
        self.source = SOURCE
        self.ancestor = True
        self.att = {
            "schema_version": 2, "acceptance_mode": "delegated_agent", "verdict": "accepted",
            "revision": REVISION, "canonical_id": ITEM["id"], "acceptance_sha256": gates.scope_hash(ITEM),
            "transport_actor": ACTOR, "accepting_agent": ACCEPTOR,
            "independent_review": {"path": REVIEW_PATH, "sha256": "0" * 64},
            "checks": [{"name": "Complete bounded source contract", "result": "passed", "url": EVIDENCE}],
            "scope_summary": "Both original contract clauses are complete.",
            "limitations": "Source-only acceptance; no user-journey, release or installed proof.",
        }
        self.comment = {"body": "", "user": dict(ACTOR, type="User"), "html_url": "https://github.com/o/r/issues/7#issuecomment-9"}
        self.api = API(self.comment)
        self.patchers = [patch.object(gates, "run", side_effect=self.git), patch.object(gates, "load_candidate_json", side_effect=self.load)]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def load(self, revision, path):
        if path == gates.TECHNICAL_POLICY:
            return self.candidate_policy if revision == REVISION and self.candidate_policy is not None else self.policy
        if path == gates.RELEASE_POLICY:
            return self.release_policy
        raise AssertionError((revision, path))

    def raw_review(self):
        return json.dumps(self.review, sort_keys=True).encode()

    def git(self, *args, binary=False):
        if args == ("git", "rev-parse", "HEAD"):
            return "c" * 40 + "\n"
        if args[:3] == ("git", "merge-base", "--is-ancestor"):
            if not self.ancestor:
                raise gates.GateError("Reviewed source is not an ancestor")
            return ""
        if args[:2] == ("git", "show"):
            cut, path = args[2].split(":", 1)
            if path == REVIEW_PATH:
                return self.raw_review()
            if path == SOURCE_PATH:
                return self.source if cut == REVISION else SOURCE
            raise gates.GateError("Missing source evidence")
        raise AssertionError(args)

    def prepare(self, repin=True):
        if repin:
            self.att["independent_review"]["sha256"] = hashlib.sha256(self.raw_review()).hexdigest()
        self.comment["body"] = "```warpdrive-acceptance\n" + json.dumps(self.att) + "\n```"

    def accept(self, item=ITEM, allow_agent=True, repin=True):
        self.prepare(repin)
        return gates.acceptance(self.api, "o/r", ISSUE, item, REVISION, allow_agent=allow_agent)

    def assert_rejected(self, **kwargs):
        with self.assertRaises(gates.GateError):
            self.accept(**kwargs)

    def test_exact_scope_pinned_independent_review_and_real_ci_pass(self):
        proof = self.accept()
        self.assertEqual(proof["mode"], "delegated_agent")
        self.assertEqual(proof["transport_actor"], ACTOR)
        self.assertEqual(proof["independent_review"]["reviewer_agent"], REVIEWER)
        self.assertEqual(len(proof["ci"]), 2)
        self.assertIn("not separately authenticated", proof["provenance_limit"])
        self.assertTrue(all(method == "GET" for _, method, _ in self.api.calls))

    def test_historical_acceptance_survives_later_identical_policy_opt_ins(self):
        self.candidate_policy = json.loads(json.dumps(self.policy))
        self.policy["items"]["technical/later"] = dict(self.policy["items"][ITEM["id"]])
        self.assertEqual(self.accept()["mode"], "delegated_agent")
        historical = gates.trusted_policy(REVISION, gates.TECHNICAL_POLICY, "o/r")
        self.assertNotIn("technical/later", historical["items"])

    def test_historical_policy_cannot_introduce_or_change_eligibility(self):
        mutations = (
            lambda p: p["items"].update({"technical/unknown": dict(p["items"][ITEM["id"]])}),
            lambda p: p["items"][ITEM["id"]].update(required_source_paths=[]),
            lambda p: p["items"][ITEM["id"]].update(acceptance_sha256="0" * 64),
            lambda p: p["items"][ITEM["id"]].update(classification="journey"),
            lambda p: p["items"][ITEM["id"]].update(rationale="Different authorization"),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.policy = policy()
                self.candidate_policy = json.loads(json.dumps(self.policy))
                mutation(self.candidate_policy)
                self.assert_rejected()

    def test_historical_subset_cannot_borrow_a_later_item_opt_in(self):
        self.candidate_policy = json.loads(json.dumps(self.policy))
        self.candidate_policy["items"] = {}
        self.assert_rejected()

    def test_historical_item_json_types_are_not_python_equal_values(self):
        self.policy["items"][ITEM["id"]]["qualification_revision"] = 1
        self.candidate_policy = json.loads(json.dumps(self.policy))
        self.candidate_policy["items"][ITEM["id"]]["qualification_revision"] = True
        self.assert_rejected()

    def test_historical_policy_preserves_every_global_safeguard(self):
        for key, value in (("repository", "other/repo"), ("mode", "human"),
                           ("human_only_ids", [ITEM["id"]]), ("delegated_actors", []),
                           ("required_workflows", {}), ("codeql_workflow_id", "999"),
                           ("schema_version", True), ("unexpected_global", True)):
            with self.subTest(key=key):
                self.policy = policy()
                self.candidate_policy = json.loads(json.dumps(self.policy))
                self.policy["items"]["technical/later"] = dict(self.policy["items"][ITEM["id"]])
                self.candidate_policy[key] = value
                self.assert_rejected()

    def test_historical_global_json_types_are_not_python_equal_values(self):
        self.policy["authorization_revision"] = 1
        self.candidate_policy = json.loads(json.dumps(self.policy))
        self.policy["items"]["technical/later"] = dict(self.policy["items"][ITEM["id"]])
        self.candidate_policy["authorization_revision"] = True
        self.assert_rejected()

    def test_technical_policy_requires_well_formed_item_maps(self):
        for broken in (None, [], "invalid"):
            for side in ("candidate", "trusted", "both"):
                with self.subTest(broken=broken, side=side):
                    self.policy = policy()
                    self.candidate_policy = json.loads(json.dumps(self.policy))
                    if side in ("candidate", "both"):
                        self.candidate_policy["items"] = broken
                    if side in ("trusted", "both"):
                        self.policy["items"] = broken
                    with self.assertRaises(gates.GateError):
                        gates.trusted_policy(REVISION, gates.TECHNICAL_POLICY, "o/r")

    def test_release_policy_does_not_gain_historical_subset_compatibility(self):
        historical = dict(self.release_policy, items={"old": {"scope": "original"}})
        current = dict(self.release_policy, items={"old": {"scope": "original"}, "new": {}})
        with patch.object(gates, "load_candidate_json", side_effect=lambda revision, path: historical if revision == REVISION else current):
            with self.assertRaises(gates.GateError):
                gates.trusted_policy(REVISION, gates.RELEASE_POLICY, "o/r")

    def test_default_and_release_context_do_not_admit_agent_proof(self):
        self.assert_rejected(allow_agent=False)

    def test_scope_must_be_explicitly_opted_in_at_current_digest(self):
        for mutation in (lambda p: p["items"].clear(),
                         lambda p: p["items"][ITEM["id"]].update(acceptance_sha256="0" * 64),
                         lambda p: p["items"][ITEM["id"]].update(classification="journey")):
            with self.subTest(mutation=mutation):
                self.policy = policy()
                mutation(self.policy)
                self.assert_rejected()

    def test_missing_malformed_or_rolled_back_policy_rejected(self):
        for broken in ({}, [], dict(policy(), schema_version=True), dict(policy(), required_workflows={})):
            with self.subTest(broken=broken):
                self.policy = broken
                self.assert_rejected()
        self.policy = policy()
        self.candidate_policy = dict(policy(), human_only_ids=[ITEM["id"]])
        self.assert_rejected()

    def test_current_human_only_journey_and_parent_cannot_downgrade(self):
        self.policy["human_only_ids"] = [ITEM["id"]]
        self.assert_rejected()
        self.policy["human_only_ids"] = []
        self.release_policy["initial_journey_ids"] = {"journey": ITEM["id"]}
        self.assert_rejected()
        self.release_policy["initial_journey_ids"] = {}
        self.assert_rejected(item=dict(ITEM, kind="programme"))

    def test_real_transport_identity_and_live_write_permission_required(self):
        for key, value in (("id", 999), ("id", True), ("login", "impostor"), ("type", "Bot")):
            with self.subTest(key=key, value=value):
                self.comment["user"] = dict(ACTOR, type="User")
                self.comment["user"][key] = value
                self.assert_rejected()
        self.comment["user"] = dict(ACTOR, type="User")
        self.api.permission = "read"
        self.assert_rejected()

    def test_actor_declaration_and_numeric_id_type_cannot_spoof_transport(self):
        for actor in ({"id": 999, "login": ACTOR["login"]}, {"id": 123.0, "login": ACTOR["login"]}, {"id": 123, "login": "other"}):
            with self.subTest(actor=actor):
                self.att["transport_actor"] = actor
                self.assert_rejected()

    def test_self_review_and_fabricated_or_missing_runtime_shape_rejected(self):
        self.review["reviewer_agent"] = ACCEPTOR
        self.assert_rejected()
        for invalid in ({}, dict(REVIEWER, session_id="made-up"), dict(REVIEWER, runtime="human"), dict(REVIEWER, task_id="reviewer")):
            with self.subTest(invalid=invalid):
                self.review["reviewer_agent"] = invalid
                self.assert_rejected()

    def test_artifact_digest_scope_status_and_complete_clause_coverage_required(self):
        self.prepare()
        self.att["independent_review"]["sha256"] = "0" * 64
        self.assert_rejected(repin=False)
        for key, value in (("canonical_id", "other"), ("acceptance_sha256", "0" * 64), ("result", "partial"),
                           ("result", "changes_requested"), ("schema_version", True), ("limitations", ""),
                           ("criteria", [review()["criteria"][0]]),
                           ("criteria", [review()["criteria"][0], review()["criteria"][0]])):
            with self.subTest(key=key, value=value):
                self.review = review()
                self.review[key] = value
                self.assert_rejected()

    def test_nonancestor_or_changed_reviewed_source_rejected(self):
        self.ancestor = False
        self.assert_rejected()
        self.ancestor = True
        self.source = b"later implementation drift\n"
        self.assert_rejected()

    def test_review_does_not_need_self_referential_final_commit_sha(self):
        proof = self.accept()
        self.assertNotEqual(proof["revision"], proof["independent_review"]["reviewed_revision"])

    def test_required_source_pins_cannot_be_missing_repeated_or_escaped(self):
        for pins in ([], [review()["source_pins"][0]] * 2,
                     [{"path": "../outside", "sha256": "0" * 64}],
                     [{"path": REVIEW_PATH, "sha256": "0" * 64}]):
            with self.subTest(pins=pins):
                self.review["source_pins"] = pins
                self.assert_rejected()
        self.review = review()
        self.policy["items"][ITEM["id"]]["required_source_paths"] += ["src/omitted.ts"]
        self.assert_rejected()

    def test_latest_exact_main_ci_and_every_base_and_codeql_job_required(self):
        for key, value in (("ci_status", "in_progress"), ("ci_conclusion", "failure"),
                           ("ci_revision", REVIEWED), ("ci_branch", "feature"),
                           ("ci_event", "pull_request"), ("newer_failed", True),
                           ("jobs", ["CRM checks"]), ("jobs", ["Analyze (python)"])):
            with self.subTest(key=key, value=value):
                self.api = API(self.comment)
                setattr(self.api, key, value)
                self.assert_rejected()

    def test_dynamic_event_only_admitted_for_declared_managed_codeql_workflow(self):
        self.api.workflow_events = {"12345": "dynamic"}
        self.assertEqual(len(self.accept()["ci"]), 2)
        with self.assertRaises(gates.GateError):
            gates.verify_ci(self.api, "o/r", REVISION, {"required_workflows": {"12345": ["Analyze (python)"]}})
        self.api.workflow_events = {"ci.yml": "dynamic"}
        self.assert_rejected()
        self.api.workflow_events = {"12345": "dynamic"}
        for identity in ({"workflow_id": 999, "path": "dynamic/github-code-scanning/codeql"},
                         {"workflow_id": 12345, "path": ".github/workflows/other.yml"}):
            with self.subTest(identity=identity):
                self.api.dynamic_identity = identity
                self.assert_rejected()
        self.api.dynamic_identity = {"workflow_id": 12345, "path": "dynamic/github-code-scanning/codeql"}
        self.api.newer_failed = True
        self.assert_rejected()

    def test_agent_fields_cannot_be_relabelled_as_legacy_human_acceptance(self):
        self.att["schema_version"] = 1
        self.att["user_journey"] = "Claimed journey"
        self.assert_rejected()
        del self.att["acceptance_mode"]
        self.assert_rejected()

    def test_existing_actual_human_schema_works_without_agent_policy(self):
        comment = attestation(canonical_id=ITEM["id"], acceptance_sha256=gates.scope_hash(ITEM))
        self.api.comment = comment
        with patch.object(gates, "trusted_policy", side_effect=AssertionError("Human path must not load agent policy")):
            self.assertEqual(gates.acceptance(self.api, "o/r", ISSUE, ITEM, REVISION)["mode"], "human")

    def test_agent_memo_cannot_satisfy_human_context_or_other_revision(self):
        self.prepare()
        memo = {}
        first = gates.verify_issue(self.api, "o/r", 7, REVISION, {ITEM["id"]: ITEM}, memo=memo, allow_agent=True)
        self.assertEqual(first["acceptance"]["mode"], "delegated_agent")
        with self.assertRaises(gates.GateError):
            gates.verify_issue(self.api, "o/r", 7, REVISION, {ITEM["id"]: ITEM}, memo=memo)
        with self.assertRaises(gates.GateError):
            gates.verify_issue(self.api, "o/r", 7, REVIEWED, {ITEM["id"]: ITEM}, memo=memo, allow_agent=True)

    def test_recursive_dependencies_require_actual_acceptance_not_closed_state(self):
        self.prepare()
        dependency = dict(ITEM, id="technical/dependency")
        item = dict(ITEM, dependencies=[dependency["id"]])
        dependency_issue = dict(ISSUE, number=8, body="<!-- warpdrive:delivery-id:technical/dependency -->")
        class GraphAPI(API):
            def request(self, path, method="GET", payload=None):
                if path.endswith("/issues/8"):
                    return dependency_issue
                return super().request(path, method, payload)
            def pages(self, path, key=None):
                if path.endswith("/issues/7/dependencies/blocked_by"):
                    return [dependency_issue]
                if "/issues/8/" in path:
                    return []
                return super().pages(path, key)
        with self.assertRaises(gates.GateError):
            gates.verify_issue(GraphAPI(self.comment), "o/r", 7, REVISION, {ITEM["id"]: item, dependency["id"]: dependency}, allow_agent=True)
        # The canonical prerequisite is mandatory even if the native edge was deleted.
        with self.assertRaises(gates.GateError):
            gates.verify_issue(self.api, "o/r", 7, REVISION, {ITEM["id"]: item, dependency["id"]: dependency}, allow_agent=True)

    def test_native_parent_traversal_keeps_human_context_for_every_child(self):
        self.prepare()
        child = dict(ITEM, id="technical/child", parent=ITEM["id"])
        child_issue = dict(ISSUE, number=8, body="<!-- warpdrive:delivery-id:technical/child -->")
        human_child = attestation(canonical_id=child["id"], acceptance_sha256=gates.scope_hash(child))
        class GraphAPI(API):
            def request(self, path, method="GET", payload=None):
                return child_issue if path.endswith("/issues/8") else super().request(path, method, payload)
            def pages(self, path, key=None):
                if path.endswith("/issues/7/sub_issues"):
                    return [child_issue]
                if path.endswith("/issues/8/comments"):
                    return [human_child]
                return super().pages(path, key)
        with patch.object(gates, "acceptance", wraps=gates.acceptance) as checked:
            with self.assertRaises(gates.GateError):
                gates.verify_issue(GraphAPI(self.comment), "o/r", 7, REVISION, {ITEM["id"]: ITEM, child["id"]: child}, allow_parent=True, allow_agent=True)
        self.assertEqual(len(checked.call_args_list), 2)
        self.assertTrue(all(call.kwargs["allow_agent"] is False for call in checked.call_args_list))


if __name__ == "__main__":
    unittest.main()
