import copy
import hashlib
import unittest

from release_pr import validate_plan, validate_review
from release_support import GateError, scope_hash


class ReleaseProposalTests(unittest.TestCase):
    def setUp(self):
        self.item = {"id": "integration/MAIL-001", "module": "mail", "kind": "deliverable",
                     "acceptance": ["Whole inventory"], "source_tasks": []}
        self.plan = {"schema_version": 1, "release_track": "mail", "mail_mode": "incremental",
                     "version": "1.5.1", "canonical_id": self.item["id"], "primary_issue": 272,
                     "issues": [272], "milestone": 2}
        self.package = {"version": "1.5.1"}
        self.items = {self.item["id"]: self.item}
        self.mapping = {self.item["id"]: {"number": 272}}
        self.policy = {"programme_version": "1.6.0", "programme_id": "programme/mail"}

    def check(self, **changes):
        plan = dict(self.plan, **changes)
        validate_plan(self.package, plan, plan, self.items, self.mapping, self.policy)

    def test_valid_open_issue_proposal_needs_no_acceptance_or_github(self):
        self.check()

    def test_version_archive_identity_and_scope_must_match(self):
        for changes in [{"version": "1.5.2"}, {"primary_issue": 273},
                        {"issues": [272, 272]}, {"issues": [272, 999]},
                        {"canonical_id": "unknown"}, {"mail_mode": "programme"}]:
            with self.subTest(changes=changes), self.assertRaises(GateError):
                self.check(**changes)
        with self.assertRaises(GateError):
            validate_plan(self.package, self.plan, {}, self.items, self.mapping, self.policy)

    def test_reserved_version_cannot_use_core_track(self):
        with self.assertRaises(GateError):
            self.check(release_track="core")

    def test_unknown_track_is_rejected_even_for_a_nonreserved_version(self):
        self.package["version"] = "1.7.0"
        with self.assertRaisesRegex(GateError, "Unknown release track"):
            self.check(version="1.7.0", release_track="maill")

    def test_second_mail_deliverable_is_not_support_scope(self):
        self.items["mail/B"] = dict(self.item, id="mail/B")
        self.mapping["mail/B"] = {"number": 273}
        with self.assertRaises(GateError):
            self.check(issues=[272, 273])


class SourceReviewTests(unittest.TestCase):
    def setUp(self):
        self.item = {"id": "integration/MAIL-001", "kind": "deliverable",
                     "acceptance": ["All seven areas"], "source_tasks": []}
        self.candidate, self.reviewed = "a" * 40, "b" * 40
        self.sources = {"docs/mail/inventory.md": b"inventory", "src/mail.ts": b"current implementation"}
        self.review = {
            "schema_version": 1, "review_type": "independent_source_review", "result": "accepted",
            "canonical_id": self.item["id"], "acceptance_sha256": scope_hash(self.item),
            "summary": "All areas reviewed", "limitations": "No live provider acceptance",
            "reviewer_agent": {"runtime": "codex", "session_id": "01a1a273-9418-7090-a0eb-1b72fb8a6655",
                               "task_id": "/root/source_reviewer"},
            "reviewed_revision": self.reviewed,
            "criteria": [{"id": "AC1", "result": "passed", "evidence": ["https://example.invalid/source"]}],
            "source_pins": [{"path": path, "sha256": hashlib.sha256(blob).hexdigest()}
                            for path, blob in self.sources.items()],
        }
        self.eligibility = {"classification": "bounded_technical", "acceptance_sha256": scope_hash(self.item),
                            "rationale": "Source inventory only", "required_source_paths": ["docs/mail/inventory.md"]}

    def check(self, review=None, read=None, ancestor=None):
        validate_review(review or self.review, self.item, self.eligibility, self.candidate,
                        read or (lambda cut, path: self.sources[path]),
                        ancestor or (lambda previous, current: True))

    def test_all_source_pins_are_checked_at_both_revisions(self):
        calls = []
        def read(cut, path):
            calls.append((cut, path))
            return self.sources[path]
        self.check(read=read)
        self.assertEqual(set(calls), {(cut, path) for cut in [self.reviewed, self.candidate]
                                     for path in self.sources})

    def test_drift_in_extra_pin_or_reviewed_cut_is_rejected(self):
        for changed_cut in [self.reviewed, self.candidate]:
            with self.subTest(cut=changed_cut), self.assertRaises(GateError):
                self.check(read=lambda cut, path: b"drift" if cut == changed_cut and path == "src/mail.ts"
                           else self.sources[path])

    def test_missing_clause_required_pin_duplicate_or_ancestor_rejected(self):
        for key, value in [("criteria", []), ("acceptance_sha256", "0" * 64),
                           ("source_pins", self.review["source_pins"][1:]),
                           ("source_pins", self.review["source_pins"] * 2)]:
            review = copy.deepcopy(self.review)
            review[key] = value
            with self.subTest(key=key), self.assertRaises(GateError):
                self.check(review)
        with self.assertRaises(GateError):
            self.check(ancestor=lambda previous, current: False)

    def test_technical_opt_in_must_match_the_exact_scope(self):
        for key, value in [("classification", "human"), ("acceptance_sha256", "0" * 64),
                           ("rationale", ""), ("required_source_paths", []),
                           ("required_source_paths", ["docs/mail/inventory.md"] * 2)]:
            original = self.eligibility
            self.eligibility = dict(original, **{key: value})
            with self.subTest(key=key), self.assertRaises(GateError):
                self.check()
            self.eligibility = original

    def test_protected_human_scope_and_parent_cannot_use_technical_review(self):
        with self.assertRaises(GateError):
            validate_review(self.review, self.item, self.eligibility, self.candidate,
                            lambda cut, path: self.sources[path], lambda old, new: True,
                            human_only=[self.item["id"]])
        self.item["kind"] = "programme"
        with self.assertRaises(GateError):
            self.check()


if __name__ == "__main__":
    unittest.main()
