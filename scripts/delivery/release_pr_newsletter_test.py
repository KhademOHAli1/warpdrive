"""Exercise newsletter proposal routing through the offline PR entrypoint."""
import contextlib
import copy
import hashlib
import io
import json
import sys
import unittest
from unittest.mock import patch

import release_pr
from release_newsletter import PLAN_DIRECTORY, POLICY_PATH, QUALIFICATION_PATH
from release_newsletter_test import REVISION, REVIEWED, fixture
from release_support import GateError

BASE = "c" * 40
ACTIVE_PLAN = "docs/delivery/releases/next.json"
ARCHIVE = f"{PLAN_DIRECTORY}/1.6.1.json"


class NewsletterRepositoryFixture:
    def __init__(self):
        self.policy, self.items, self.mapping, self.plan, self.record, self.qualified_blob = fixture()
        self.calls = []
        self.ancestor = True
        current = {
            "package.json": self.encode({"version": "1.6.1"}),
            ACTIVE_PLAN: self.encode(self.plan),
            ARCHIVE: self.encode(self.plan),
            POLICY_PATH: self.encode(self.policy),
            QUALIFICATION_PATH: self.qualified_blob(REVISION, QUALIFICATION_PATH),
            "src/newsletter.ts": self.qualified_blob(REVISION, "src/newsletter.ts"),
            "docs/delivery/roadmap.json": self.qualified_blob(REVISION, "docs/delivery/roadmap.json"),
            "docs/delivery/issue-map.json": self.encode({"issues": self.mapping}),
            "docs/delivery/technical-acceptance-policy.json": self.encode(
                {"items": {}, "human_only_ids": []}),
            "docs/delivery/release-policy.json": self.encode({"initial_journey_ids": {}}),
        }
        self.trees = {REVISION: current, BASE: dict(current)}
        self.trees[BASE][ACTIVE_PLAN] = self.encode({"version": "1.5.1", "release_track": "mail"})
        self.trees[BASE]["package.json"] = self.encode({"version": "1.5.1"})
        self.reviewed_overrides = {}

    @staticmethod
    def encode(value):
        return json.dumps(value).encode()

    def put_plan(self, plan):
        self.plan = plan
        self.trees[REVISION][ACTIVE_PLAN] = self.encode(plan)
        self.trees[REVISION][ARCHIVE] = self.encode(plan)

    def put_record(self, record):
        raw = self.encode(record)
        self.trees[REVISION][QUALIFICATION_PATH] = raw
        plan = copy.deepcopy(self.plan)
        plan["qualification"]["sha256"] = hashlib.sha256(raw).hexdigest()
        self.put_plan(plan)

    def read(self, revision, path):
        return json.loads(self.trees[revision][path])

    def run(self, *args, binary=False):
        self.calls.append(args)
        if args == ("git", "rev-parse", "HEAD"):
            return REVISION + "\n"
        if args == ("git", "diff", "--name-only", BASE, REVISION, "--"):
            old, new = self.trees[BASE], self.trees[REVISION]
            return "\n".join(sorted(path for path in old.keys() | new.keys()
                                    if old.get(path) != new.get(path)))
        if args == ("git", "ls-tree", "-r", "--name-only", REVISION, "--",
                    "docs/delivery/technical-reviews"):
            return ""
        if args[:2] == ("git", "show"):
            revision, path = args[2].split(":", 1)
            if revision == REVIEWED:
                blob = self.reviewed_overrides.get(path, self.qualified_blob(revision, path))
            else:
                blob = self.trees[revision][path]
            return blob if binary else blob.decode()
        if args == ("git", "merge-base", "--is-ancestor", REVIEWED, REVISION):
            if not self.ancestor:
                raise GateError("Not an ancestor")
            return ""
        raise AssertionError(f"Unexpected operation {args!r}")


class NewsletterReleaseProposalTests(unittest.TestCase):
    def setUp(self):
        self.repo = NewsletterRepositoryFixture()

    def invoke(self):
        output = io.StringIO()
        with patch.object(sys, "argv", ["release_pr.py", "--base", BASE]), \
                patch.object(release_pr, "run", self.repo.run), \
                patch.object(release_pr, "load_candidate_json", self.repo.read), \
                contextlib.redirect_stdout(output):
            release_pr.main()
        return json.loads(output.getvalue())

    def test_new_newsletter_proposal_uses_shared_qualification_without_issue_acceptance(self):
        result = self.invoke()
        self.assertEqual(result["version"], "1.6.1")
        self.assertIs(result["newsletter_qualification_checked"], True)
        self.assertEqual(result["source_reviews_checked"], [])
        for revision in (REVIEWED, REVISION):
            self.assertIn(("git", "show", f"{revision}:src/newsletter.ts"), self.repo.calls)

    def test_authorized_version_and_registered_issue_scope_are_enforced(self):
        for field, value in (("version", "1.6.2"), ("issues", [1011, 1014])):
            with self.subTest(field=field):
                self.repo = NewsletterRepositoryFixture()
                plan = dict(self.repo.plan, **{field: value})
                self.repo.put_plan(plan)
                self.repo.trees[REVISION]["package.json"] = self.repo.encode(
                    {"version": plan["version"]})
                if field == "version":
                    self.repo.trees[REVISION][f"{PLAN_DIRECTORY}/{value}.json"] = self.repo.encode(plan)
                with self.assertRaises(GateError):
                    self.invoke()

    def test_active_and_archived_plans_must_match(self):
        archive = dict(self.repo.plan, issues=[1013])
        self.repo.trees[REVISION][ARCHIVE] = self.repo.encode(archive)
        with self.assertRaisesRegex(GateError, "committed per-version plan"):
            self.invoke()

    def test_report_digest_is_checked_before_qualification(self):
        plan = copy.deepcopy(self.repo.plan)
        plan["qualification"]["sha256"] = "0" * 64
        self.repo.put_plan(plan)
        with self.assertRaisesRegex(GateError, "report digest"):
            self.invoke()

    def test_product_pins_are_enforced_at_reviewed_and_candidate_revisions(self):
        for revision in (REVIEWED, REVISION):
            with self.subTest(revision=revision):
                self.repo = NewsletterRepositoryFixture()
                target = self.repo.reviewed_overrides if revision == REVIEWED else self.repo.trees[REVISION]
                target["src/newsletter.ts"] = b"unqualified source"
                with self.assertRaisesRegex(GateError, "source blob changed"):
                    self.invoke()

    def test_scope_criteria_reviewer_and_false_acceptance_flags_reach_shared_validator(self):
        mutations = (
            lambda record: record["scopes"][0].update(scope_sha256="0" * 64),
            lambda record: record["scopes"][0].update(criteria=[]),
            lambda record: record.update(reviewer_agent={}),
            lambda record: record.update(acceptance_claimed=True),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.repo = NewsletterRepositoryFixture()
                record = copy.deepcopy(self.repo.record)
                mutate(record)
                self.repo.put_record(record)
                with self.assertRaises(GateError):
                    self.invoke()
        self.repo = NewsletterRepositoryFixture()
        self.repo.ancestor = False
        with self.assertRaisesRegex(GateError, "Not an ancestor"):
            self.invoke()

    def test_unchanged_historical_plan_does_not_reage_source_qualification(self):
        self.repo.trees[BASE] = dict(self.repo.trees[REVISION])
        self.repo.trees[REVISION]["src/newsletter.ts"] = b"later unrelated source edit"
        self.assertIs(self.invoke()["newsletter_qualification_checked"], False)

    def test_package_version_change_alone_revalidates_the_report(self):
        self.repo.trees[BASE] = dict(self.repo.trees[REVISION])
        self.repo.trees[BASE]["package.json"] = self.repo.encode({"version": "1.5.1"})
        self.repo.trees[REVISION]["src/newsletter.ts"] = b"unqualified source"
        with self.assertRaisesRegex(GateError, "source blob changed"):
            self.invoke()

    def test_policy_change_alone_revalidates_required_source_pins(self):
        self.repo.trees[BASE] = dict(self.repo.trees[REVISION])
        policy = copy.deepcopy(self.repo.policy)
        policy["required_source_paths"].append("src/additional.ts")
        self.repo.trees[REVISION][POLICY_PATH] = self.repo.encode(policy)
        with self.assertRaisesRegex(GateError, "omits a required source"):
            self.invoke()


if __name__ == "__main__":
    unittest.main()
