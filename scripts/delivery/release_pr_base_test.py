"""Exercise proposal classification through main without Git, services or network."""
import contextlib
import hashlib
import io
import json
import sys
import unittest
from unittest.mock import patch

import release_pr
from release_support import GateError, scope_hash


# Baseline uses the existing CLI so its RED is the source-pin domain rejection.
# After that observed RED, enable only this transport adapter for the new option.
PASS_INTEGRATION_ARGUMENT = True
REVIEWED, FORK, BEFORE, INTEGRATION, CANDIDATE, SIDE, UNRELATED = (
    character * 40 for character in "1234567"
)
SOURCE = ".github/workflows/required-quality.yml"
REVIEW = "docs/delivery/technical-reviews/tooling-ci.json"
PLAN = "docs/delivery/releases/next.json"


class RepositoryFixture:
    """A divergent feature push that synchronizes accepted canonical history."""

    def __init__(self):
        self.item = {"id": "tooling/CI-001", "kind": "maintenance",
                     "acceptance": ["Validate all declared checks"], "source_tasks": []}
        self.review = {
            "schema_version": 1, "review_type": "independent_source_review", "result": "accepted",
            "canonical_id": self.item["id"], "acceptance_sha256": scope_hash(self.item),
            "summary": "Complete technical scope reviewed", "limitations": "Source evidence only",
            "reviewer_agent": {"runtime": "codex", "session_id": "01a1a273-9418-7090-a0eb-1b72fb8a6655",
                               "task_id": "/root/independent_reviewer"},
            "reviewed_revision": REVIEWED,
            "criteria": [{"id": "AC1", "result": "passed", "evidence": ["https://example.invalid/review"]}],
            "source_pins": [{"path": SOURCE, "sha256": hashlib.sha256(b"prior checks").hexdigest()}],
        }
        self.eligibility = {"classification": "bounded_technical", "acceptance_sha256": scope_hash(self.item),
                            "rationale": "Bounded check tooling", "required_source_paths": [SOURCE]}
        self.plan = {"schema_version": 1, "release_track": "core", "version": "1.7.0",
                     "canonical_id": "tooling/RELEASE-001"}
        common = {
            SOURCE: b"prior checks",
            "package.json": self.encode({"version": "1.7.0"}),
            PLAN: self.encode(self.plan),
            "docs/delivery/roadmap.json": self.encode({"items": [self.item]}),
            "docs/delivery/issue-map.json": self.encode({"issues": {}}),
            "docs/delivery/mail-release-policy.json": self.encode({}),
            "docs/delivery/technical-acceptance-policy.json": self.encode(
                {"items": {self.item["id"]: self.eligibility}, "human_only_ids": []}),
            "docs/delivery/release-policy.json": self.encode({"initial_journey_ids": {}}),
        }
        self.trees = {cut: dict(common) for cut in (REVIEWED, FORK, BEFORE, INTEGRATION, CANDIDATE, SIDE, UNRELATED)}
        for cut in (BEFORE, CANDIDATE):
            self.trees[cut][SOURCE] = b"current checks"
        for cut in (INTEGRATION, CANDIDATE):
            self.put(cut, REVIEW, self.review)
        self.parents = {REVIEWED: [], FORK: [REVIEWED], BEFORE: [FORK], INTEGRATION: [FORK],
                        CANDIDATE: [BEFORE, INTEGRATION], SIDE: [BEFORE], UNRELATED: []}
        self.calls = []
        self.merge_base_output = None

    @staticmethod
    def encode(value):
        return json.dumps(value, sort_keys=True).encode()

    def put(self, revision, path, value):
        self.trees[revision][path] = self.encode(value)

    def ancestors(self, revision):
        if revision not in self.parents:
            raise GateError("Unknown fixture commit")
        result, pending = set(), [revision]
        while pending:
            current = pending.pop()
            if current not in result:
                result.add(current)
                pending.extend(self.parents[current])
        return result

    def run(self, *args, binary=False):
        self.calls.append(args)
        if args == ("git", "rev-parse", "HEAD"):
            return CANDIDATE + "\n"
        if args == ("git", "rev-parse", "HEAD^"):
            return BEFORE + "\n"
        if args[:3] == ("git", "diff", "--name-only"):
            base, candidate, end = args[3:]
            assert candidate == CANDIDATE and end == "--"
            old, new = self.trees[base], self.trees[candidate]
            return "\n".join(sorted(path for path in old.keys() | new.keys() if old.get(path) != new.get(path)))
        if args == ("git", "ls-tree", "-r", "--name-only", CANDIDATE, "--", "docs/delivery/technical-reviews"):
            return "\n".join(sorted(path for path in self.trees[CANDIDATE]
                                    if path.startswith("docs/delivery/technical-reviews/")))
        if args[:2] == ("git", "show"):
            revision, path = args[2].split(":", 1)
            blob = self.trees[revision][path]
            return blob if binary else blob.decode()
        if args[:3] == ("git", "merge-base", "--is-ancestor"):
            if args[3] not in self.ancestors(args[4]):
                raise GateError("Not an ancestor")
            return ""
        if args[:2] == ("git", "merge-base"):
            if self.merge_base_output is not None:
                return self.merge_base_output
            common = self.ancestors(args[-2]) & self.ancestors(args[-1])
            tips = [cut for cut in common if not any(cut != other and cut in self.ancestors(other)
                                                    for other in common)]
            if len(tips) != 1:
                raise GateError("No unique common integration history")
            return tips[0] + "\n"
        raise AssertionError(f"Unexpected Git operation: {args!r}")

    def read(self, revision, path):
        assert revision == CANDIDATE
        return json.loads(self.trees[revision][path])

    def align_pinned_source(self):
        self.trees[INTEGRATION][SOURCE] = self.trees[CANDIDATE][SOURCE] = b"prior checks"


class ReleaseProposalComparisonBaseTests(unittest.TestCase):
    def setUp(self):
        self.repo = RepositoryFixture()

    def invoke(self, base=BEFORE, integration=INTEGRATION):
        argv = ["release_pr.py", "--base", base]
        if integration is not None and PASS_INTEGRATION_ARGUMENT:
            argv += ["--integration-revision=" + integration]
        output = io.StringIO()
        with patch.object(sys, "argv", argv), patch.object(release_pr, "run", self.repo.run), \
                patch.object(release_pr, "load_candidate_json", self.repo.read), contextlib.redirect_stdout(output):
            release_pr.main()
        return json.loads(output.getvalue())

    def assert_pin_rejected(self, **arguments):
        with self.assertRaisesRegex(GateError, "Reviewed source changed at " + CANDIDATE):
            self.invoke(**arguments)

    def test_ordinary_synchronization_keeps_identical_canonical_review_historical(self):
        self.assertEqual(self.repo.trees[INTEGRATION][REVIEW], self.repo.trees[CANDIDATE][REVIEW])
        self.assertEqual(self.repo.trees[BEFORE][SOURCE], self.repo.trees[CANDIDATE][SOURCE])
        self.assertEqual(self.repo.trees[INTEGRATION][SOURCE], self.repo.trees[REVIEWED][SOURCE])
        self.assertEqual(self.invoke()["source_reviews_checked"], [])

    def test_synchronization_uses_common_canonical_history_when_upstream_advances(self):
        self.repo.parents[UNRELATED] = [INTEGRATION]
        self.repo.trees[UNRELATED] = dict(self.repo.trees[INTEGRATION])
        self.repo.trees[UNRELATED][SOURCE] = b"later canonical checks"
        self.assertEqual(self.invoke(integration=UNRELATED)["source_reviews_checked"], [])
        self.assertIn(("git", "diff", "--name-only", INTEGRATION, CANDIDATE, "--"), self.repo.calls)
        self.assertNotIn(("git", "diff", "--name-only", UNRELATED, CANDIDATE, "--"), self.repo.calls)

    def test_inherited_proposal_update_does_not_reactivate_an_unchanged_historical_review(self):
        for revision in (INTEGRATION, CANDIDATE):
            self.repo.put(revision, PLAN, dict(self.repo.plan, canonical_id=self.repo.item["id"]))
        self.assertEqual(self.invoke()["source_reviews_checked"], [])

    def test_new_review_must_pin_current_candidate_sources(self):
        del self.repo.trees[INTEGRATION][REVIEW]
        self.assert_pin_rejected()

    def test_edited_review_must_pin_current_candidate_sources(self):
        self.repo.put(CANDIDATE, REVIEW, dict(self.repo.review, summary="Revised review"))
        self.assert_pin_rejected()

    def test_reformatted_review_is_still_a_new_change(self):
        self.repo.trees[CANDIDATE][REVIEW] = json.dumps(self.repo.review, indent=2).encode()
        self.assert_pin_rejected()

    def test_matching_unmerged_side_parent_cannot_exempt_a_new_review(self):
        del self.repo.trees[INTEGRATION][REVIEW]
        self.repo.parents[CANDIDATE] = [BEFORE, SIDE]
        self.repo.trees[SIDE] = dict(self.repo.trees[CANDIDATE])
        self.assert_pin_rejected()

    def test_changed_active_proposal_revalidates_unchanged_historical_review(self):
        self.repo.put(CANDIDATE, PLAN, dict(self.repo.plan, canonical_id=self.repo.item["id"]))
        self.assert_pin_rejected()

    def test_active_proposal_without_review_is_rejected(self):
        del self.repo.trees[CANDIDATE][REVIEW]
        self.repo.put(CANDIDATE, PLAN, dict(self.repo.plan, canonical_id=self.repo.item["id"]))
        with self.assertRaisesRegex(GateError, "needs its full-scope independent source review"):
            self.invoke()

    def test_canonical_push_preserves_event_before_and_validates_new_reviews(self):
        self.assert_pin_rejected(integration=None)
        self.assertIn(("git", "diff", "--name-only", BEFORE, CANDIDATE, "--"), self.repo.calls)

    def test_pull_request_preserves_explicit_base(self):
        self.assert_pin_rejected(base=FORK, integration=None)
        self.assertIn(("git", "diff", "--name-only", FORK, CANDIDATE, "--"), self.repo.calls)

    def test_zero_event_before_keeps_existing_parent_fallback(self):
        self.assert_pin_rejected(base="0" * 40, integration=None)
        self.assertIn(("git", "rev-parse", "HEAD^"), self.repo.calls)

    def test_new_review_with_unchanged_source_is_validated(self):
        del self.repo.trees[INTEGRATION][REVIEW]
        self.repo.align_pinned_source()
        self.assertEqual(self.invoke()["source_reviews_checked"], [self.repo.item["id"]])

    def test_edited_review_with_unchanged_source_is_validated(self):
        self.repo.align_pinned_source()
        self.repo.put(CANDIDATE, REVIEW, dict(self.repo.review, summary="Updated complete review"))
        self.assertEqual(self.invoke()["source_reviews_checked"], [self.repo.item["id"]])

    def test_new_review_without_explicit_eligibility_is_rejected(self):
        self.repo.put(CANDIDATE, "docs/delivery/technical-acceptance-policy.json",
                      {"items": {}, "human_only_ids": []})
        del self.repo.trees[INTEGRATION][REVIEW]
        with self.assertRaisesRegex(GateError, "lacks explicit technical eligibility"):
            self.invoke()

    def test_new_review_must_cover_whole_scope(self):
        self.repo.put(CANDIDATE, REVIEW, dict(self.repo.review, criteria=[]))
        with self.assertRaisesRegex(GateError, "every acceptance clause"):
            self.invoke()

    def test_protected_human_scope_cannot_use_new_technical_review(self):
        self.repo.put(CANDIDATE, "docs/delivery/release-policy.json",
                      {"initial_journey_ids": {"protected": self.repo.item["id"]}})
        self.repo.put(CANDIDATE, REVIEW, dict(self.repo.review, summary="Changed review"))
        with self.assertRaisesRegex(GateError, "retains human acceptance"):
            self.invoke()

    def test_new_review_requires_ancestor_revision(self):
        self.repo.put(CANDIDATE, REVIEW, dict(self.repo.review, reviewed_revision=UNRELATED))
        with self.assertRaisesRegex(GateError, "Not an ancestor|identify an ancestor"):
            self.invoke()

    def test_invalid_integration_revision_fails_closed(self):
        self.repo.align_pinned_source()
        for revision in ("", "short", "0" * 40, "z" * 40, "--all"):
            with self.subTest(revision=revision), self.assertRaises(GateError):
                self.invoke(integration=revision)

    def test_missing_integration_object_fails_closed(self):
        self.repo.align_pinned_source()
        with self.assertRaises(GateError):
            self.invoke(integration="8" * 40)

    def test_unrelated_integration_history_fails_closed(self):
        self.repo.align_pinned_source()
        with self.assertRaises(GateError):
            self.invoke(integration=UNRELATED)

    def test_invalid_merge_base_output_fails_closed(self):
        self.repo.align_pinned_source()
        for output in ("", "short\n", FORK + "\n" + INTEGRATION + "\n", "0" * 40 + "\n"):
            self.repo.merge_base_output = output
            with self.subTest(output=output), self.assertRaises(GateError):
                self.invoke()

    def test_invalid_existing_base_remains_rejected(self):
        with self.assertRaisesRegex(GateError, "Base revision must be a complete Git SHA"):
            self.invoke(base="short", integration=None)


if __name__ == "__main__":
    unittest.main()
