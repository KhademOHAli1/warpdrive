"""Test repeat input binding with the two reconstructed baseline artifacts."""

from copy import deepcopy
import unittest

from candidate import CandidateError
import component_inputs as inputs
from test_component_inputs import rehash
import test_web_composite_baseline as composite_fixture
from web_release_inputs import STYLE_FILE
from web_repeat_inputs import verify_web_repeat_inputs


NEXT = "b" * 40
PROFILE = "1" * 64


class WebRepeatInputsTests(unittest.TestCase):
    def setUp(self):
        fixture = composite_fixture.CompositeBaselineTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.composite = fixture.verify()
        self.active = deepcopy(self.composite["web"]["inputReceipt"])
        self.next = deepcopy(self.active)
        self.change(self.next, "web", STYLE_FILE)
        self.presentation = {"schemaVersion": 1, "kind": "warpdrive-web-presentation-source", "profileSha256": PROFILE,
                             "baselineRevision": self.composite["web"]["sourceRevision"], "currentRevision": NEXT,
                             "protectedSourceSha256": "2" * 64, "guardedWebPathsSha256": "3" * 64, "guardedWebPathCount": 32,
                             "changed": [{"path": STYLE_FILE, "kind": "style", "baselineBlob": "4" * 40, "currentBlob": "5" * 40}],
                             "deploymentAuthorized": False}

    @staticmethod
    def change(receipt, component, path, digest="0" * 64):
        next(row for row in receipt["components"][component]["inputs"] if row["path"] == path)["sha256"] = digest
        return rehash(receipt)

    def admit(self, **overrides):
        options = {"composite": self.composite, "active_inputs": self.active, "candidate_inputs": self.next,
                   "presentation": self.presentation, "expected_candidate_revision": NEXT, "expected_profile_sha256": PROFILE}
        return verify_web_repeat_inputs(**(options | overrides))

    def test_b_to_c_build_keeps_separate_a_backend_inputs_and_provenance(self):
        result = self.admit()
        self.assertEqual(result["activeWebRevision"], self.composite["web"]["sourceRevision"])
        self.assertEqual(result["originalBackendRevision"], self.composite["backend"]["sourceRevision"])
        self.assertEqual(result["candidateRevision"], NEXT)
        self.assertEqual(result["compositeSha256"], inputs.content_hash(self.composite))
        self.assertEqual(result["presentationSha256"], inputs.content_hash(self.presentation))
        self.assertEqual(result["candidateInputReceiptSha256"], inputs.content_hash(self.next))
        self.assertEqual(result["retainedComponents"], self.composite["backend"]["components"])
        self.assertEqual(result["buildComponents"], ["web"])
        self.assertFalse(result["deploymentAuthorized"])
        result["retainedComponents"]["worker"].clear()
        self.assertTrue(self.admit()["retainedComponents"]["worker"])

    def test_rejects_fresh_b_drift_and_original_a_component_substitution(self):
        modified = self.change(deepcopy(self.active), "web", STYLE_FILE)
        with self.assertRaisesRegex(CandidateError, "Fresh active Web inputs differ"):
            self.admit(active_inputs=modified)
        for key, value in (("sourceRevision", NEXT), ("inputSha256", "e" * 64), ("inputPolicySha256", "e" * 64)):
            composite = deepcopy(self.composite)
            composite["backend"]["components"]["worker"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(CandidateError, "retained backend artifact"):
                self.admit(composite=composite)
        changed_backend = self.change(deepcopy(self.next), "worker", "src/worker.ts")
        with self.assertRaisesRegex(CandidateError, "retained backend artifact"):
            self.admit(candidate_inputs=changed_backend)

    def test_rejects_changed_build_context_or_discovery_policy(self):
        context = deepcopy(self.next)
        context["context"]["buildArgs"]["NEXT_PUBLIC_WS_URL"] = ""
        context["policy"]["context"] = context["context"]
        with self.assertRaisesRegex(CandidateError, "build context or component discovery policy"):
            self.admit(candidate_inputs=rehash(context))
        policy = deepcopy(self.next)
        policy["policy"]["web"] = {"newResolver": True}
        with self.assertRaisesRegex(CandidateError, "build context or component discovery policy"):
            self.admit(candidate_inputs=rehash(policy))

    def test_rejects_foreign_or_unbounded_presentation_proof(self):
        changes = (
            {"baselineRevision": self.composite["backend"]["sourceRevision"]}, {"currentRevision": "9" * 40},
            {"profileSha256": "8" * 64}, {"deploymentAuthorized": True}, {"guardedWebPathCount": False},
            {"protectedSourceSha256": "missing"}, {"changed": []}, {"changed": self.presentation["changed"] * 2},
            {"changed": [{**self.presentation["changed"][0], "currentBlob": "4" * 40}]},
        )
        for change in changes:
            with self.subTest(change=change), self.assertRaises(CandidateError):
                self.admit(presentation=self.presentation | change)

    def test_exact_web_delta_rejects_add_remove_unlisted_and_unchanged_paths(self):
        for altered in (deepcopy(self.active), self.change(deepcopy(self.next), "web", "src/web.ts")):
            with self.assertRaisesRegex(CandidateError, "exact changed input paths"):
                self.admit(candidate_inputs=altered)
        for operation in ("remove", "add", "byte-count-only"):
            candidate = deepcopy(self.next)
            records = candidate["components"]["web"]["inputs"]
            row = next(row for row in records if row["path"] == STYLE_FILE)
            if operation == "remove":
                records.remove(row)
            elif operation == "add":
                records.append({**row, "path": "src/new.css"})
                records.sort(key=lambda item: item["path"])
            else:
                original = next(item for item in self.active["components"]["web"]["inputs"] if item["path"] == STYLE_FILE)
                row.update(sha256=original["sha256"], bytes=original["bytes"] + 1)
            with self.subTest(operation=operation), self.assertRaisesRegex(CandidateError, "exact changed input paths"):
                self.admit(candidate_inputs=rehash(candidate))

    def test_reviewed_tools_transition_needs_exact_disjoint_inventory(self):
        tools = "scripts/deployment/web_repeat_source.py"
        revision = "8" * 40
        candidate = deepcopy(self.next)
        records = candidate["components"]["web"]["inputs"]
        records.append({"path": tools, "sha256": "8" * 64, "bytes": 7})
        records.sort(key=lambda row: row["path"])
        candidate = rehash(candidate)
        presentation = self.presentation | {"baselineRevision": revision}
        tooling = {"activeWebRevision": self.composite["web"]["sourceRevision"], "toolingRevision": revision,
                   "candidateRevision": NEXT, "toolingPaths": [tools], "toolingSourceSha256": "9" * 64}
        outcome = self.admit(candidate_inputs=candidate, presentation=presentation, tooling=tooling)
        self.assertEqual(outcome["schemaVersion"], 2)
        self.assertEqual(outcome["toolingTransition"], tooling)
        for paths in ([STYLE_FILE], [tools, "src/unreviewed.ts"], []):
            with self.subTest(paths=paths), self.assertRaises(CandidateError):
                self.admit(candidate_inputs=candidate, presentation=presentation, tooling=tooling | {"toolingPaths": paths})


if __name__ == "__main__":
    unittest.main()
