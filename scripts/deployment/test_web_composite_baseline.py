"""Reconstruct both actual bundle formats from bounded local fixtures."""

from copy import deepcopy
from hashlib import sha256
import json
import unittest

import bundle
from candidate import CandidateError
import test_web_candidate as candidate_fixture
from test_web_publication_gate import API, ATTEMPT, OLD, ORIGIN, REVISION, RUN_ID, zip_bytes
from web_composite_baseline import verify_web_composite_baseline
import web_publication_gate as gate


class CompositeBaselineTests(unittest.TestCase):
    def setUp(self):
        fixture = candidate_fixture.WebCandidateTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        packed = fixture.pack(origin=ORIGIN)
        self.backend_dir = fixture.baseline_dir
        self.retained = fixture.private / "verified"
        self.web_dir = self.retained / "bundle"
        self.backend_sha = packed["candidate"]["baseline"]["manifestSha256"]
        payload = zip_bytes({item.name: item.read_bytes() for item in fixture.output.iterdir()})
        self.receipt = gate.retain(API(payload), RUN_ID, REVISION, OLD, self.backend_sha, self.retained,
                                   fetch=lambda _artifact, path: path.write_bytes(payload))
        self.raw = (self.retained / gate.RECEIPT_NAME).read_bytes()

    def verify(self, *, raw=None, **changes):
        raw = self.raw if raw is None else raw
        options = {"web_receipt": raw, "expected_web_receipt_sha256": sha256(raw).hexdigest(),
                   "web_bundle_dir": self.web_dir, "backend_bundle_dir": self.backend_dir,
                   "expected_backend_manifest_sha256": self.backend_sha}
        return verify_web_composite_baseline(**(options | changes))

    def test_retains_distinct_web_and_backend_source_artifact_and_fixture_witnesses(self):
        baseline = self.verify()
        self.assertEqual(baseline["kind"], "warpdrive-web-composite-baseline")
        self.assertFalse(baseline["deploymentAuthorized"])
        self.assertNotIn("sourceRevision", baseline)
        self.assertEqual(baseline["web"]["sourceRevision"], REVISION)
        self.assertEqual(baseline["web"]["origin"], ORIGIN)
        self.assertEqual(baseline["web"]["image"], self.receipt["image"])
        self.assertEqual(baseline["web"]["publicationReceiptSha256"], sha256(self.raw).hexdigest())
        self.assertEqual(baseline["backend"]["sourceRevision"], OLD)
        self.assertNotEqual(baseline["backend"]["origin"], ORIGIN)
        self.assertEqual(set(baseline["backend"]["components"]), {"worker", "realtime", "migrator"})
        self.assertTrue(all(row["sourceRevision"] == OLD for row in baseline["backend"]["components"].values()))
        self.assertNotEqual(baseline["web"]["inputReceiptSha256"], baseline["backend"]["inputReceiptSha256"])
        self.assertEqual(baseline["qualification"]["fixtureSchemaSha256"], "d" * 64)
        self.assertTrue(baseline["qualification"]["retainedComponentInputsEqual"])

    def test_both_external_authentication_pins_required(self):
        with self.assertRaisesRegex(CandidateError, "publication receipt SHA-256 differs"):
            self.verify(raw=self.raw + b"\n", expected_web_receipt_sha256=sha256(self.raw).hexdigest())
        with self.assertRaisesRegex(CandidateError, "authenticated original backend"):
            self.verify(expected_backend_manifest_sha256="e" * 64)

    def test_publication_scope_origin_and_ci_must_bind_exact_artifact(self):
        for key, value in (("deploymentAuthorized", True), ("schemaVersion", True), ("repository", "fork/warpdrive"),
                           ("origin", {**ORIGIN, "event": "push"}), ("ci", []),
                           ("security", {**self.receipt["security"], "blocking_alerts": False}),
                           ("artifact", {**self.receipt["artifact"], "name": "wrong-attempt"})):
            with self.subTest(key=key), self.assertRaises(CandidateError):
                self.verify(raw=json.dumps(self.receipt | {key: value}).encode())
        changed = deepcopy(self.receipt)
        next(row for row in changed["ci"] if row["workflow"] == gate.WORKFLOW)["attempt"] = ATTEMPT + 1
        with self.assertRaisesRegex(CandidateError, "CI attempt differs"):
            self.verify(raw=json.dumps(changed).encode())

    def test_publication_image_and_provenance_cannot_be_substituted(self):
        mutations = (
            {"image": {**self.receipt["image"], "imageId": "sha256:" + "e" * 64}},
            {"baseline": {**self.receipt["baseline"], "archiveSha256": "e" * 64}},
            {"provenance": {**self.receipt["provenance"], "archiveSha256": "e" * 64}},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaisesRegex(CandidateError, "does not bind"):
                self.verify(raw=json.dumps(self.receipt | mutation).encode())

    def test_valid_b_receipt_cannot_replace_or_mutate_retained_a_bytes(self):
        archive = self.backend_dir / bundle.ARCHIVE
        archive.write_bytes(archive.read_bytes() + b"unrelated")
        with self.assertRaisesRegex(CandidateError, "bundle content changed"):
            self.verify()

    def test_separate_canonical_bundle_directories_are_required(self):
        with self.assertRaisesRegex(CandidateError, "Separate canonical Web and backend"):
            self.verify(backend_bundle_dir=self.web_dir)
        alias = self.retained / "aliased-backend"
        alias.symlink_to(self.backend_dir, target_is_directory=True)
        with self.assertRaisesRegex(CandidateError, "Separate canonical Web and backend"):
            self.verify(backend_bundle_dir=alias)


if __name__ == "__main__":
    unittest.main()
