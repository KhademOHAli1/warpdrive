"""Verify that a private installed C+B chain binds separate Web and backend custody."""

from copy import deepcopy
import unittest

from candidate import CandidateError
from component_inputs import content_hash
from installed_web_chain import REPOSITORY
from test_caddy_web_repeat import B, C, compile_next, installed_after_first_switch
from test_web_rollout import slot
from web_successor_lineage import verify_web_successor_lineage


class WebSuccessorLineageTests(unittest.TestCase):
    def setUp(self):
        previous, active = slot("2", "2", "b"), slot("3", "3", "c")
        previous["runtime"]["name"], active["runtime"]["name"] = B.target, C.target
        docs = compile_next(installed_after_first_switch())
        previous["route"]["fingerprint"] = content_hash(docs["manualRollback"])
        active["route"]["fingerprint"] = content_hash(docs["after"])
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "web-cccccccccccc-reapply",
                     "targetKey": "pitant-warpdrive", "backendFingerprint": "4" * 64, "qualificationSha256": "5" * 64,
                     "before": previous, "after": active}
        self.chain = {"targetKey": self.plan["targetKey"], "backendFingerprint": self.plan["backendFingerprint"],
                      "acceptedOperationId": self.plan["operationId"], "acceptedPlanSha256": content_hash(self.plan)}
        self.web = {}
        for side, current_slot, generation, digit, receipt in (("previous", previous, B, "b", "6"), ("active", active, C, "c", "7")):
            revision = current_slot["runtime"]["sourceRevision"]
            provenance = {"bundleManifestSha256": digit * 64, "archiveSha256": receipt * 64}
            image = {"imageId": "sha256:" + digit * 64, "sourceRevision": revision, "generation": generation.deployment_id,
                     "runtimeUser": "bun"}
            self.web[side] = {"sourceRevision": revision, "image": image, "publicationReceiptSha256": "a" + digit * 63,
                              "provenance": provenance, "inputReceiptSha256": "d" * 64}
            self.chain[side] = {"slot": deepcopy(current_slot), "alias": generation.target, "receiptSha256": receipt * 64,
                                "provenance": {"repository": REPOSITORY, "revision": revision, "manifestSha256": digit * 64,
                                               "archiveSha256": receipt * 64, "testedConfigDigest": image["imageId"],
                                               "authoritySha256": self.web[side]["publicationReceiptSha256"]}}
        self.backend = {"sourceRevision": "a" * 40, "provenance": {"bundleManifestSha256": "a" * 64, "archiveSha256": "e" * 64},
                        "inputReceiptSha256": "f" * 64, "components": {
                            name: {"sourceRevision": "a" * 40, "imageId": "sha256:" + digit * 64,
                                   "inputSha256": "6" * 64, "inputPolicySha256": "7" * 64}
                            for name, digit in (("worker", "8"), ("realtime", "9"), ("migrator", "0"))}}

    def verify(self, chain=None, **overrides):
        value = self.chain if chain is None else chain
        defaults = {"expected_lineage_sha256": content_hash(value), "accepted_plan": self.plan,
                    "active_web": self.web["active"], "previous_web": self.web["previous"], "original_backend": self.backend}
        return verify_web_successor_lineage(value, **(defaults | overrides))

    def test_exact_repeat_pair_returns_defensive_copy_and_keeps_tested_config_separate_from_manifest(self):
        result = self.verify()
        self.assertEqual(result, self.chain)
        self.assertNotEqual(result["active"]["slot"]["runtime"]["imageId"], result["active"]["provenance"]["testedConfigDigest"])
        result["active"]["slot"]["runtime"]["running"] = False
        self.assertTrue(self.chain["active"]["slot"]["runtime"]["running"])

    def test_digest_plan_route_runtime_and_schema_tampering_hold(self):
        with self.assertRaisesRegex(CandidateError, "chain digest required"):
            self.verify(expected_lineage_sha256="0" * 64)
        for key, value in (("acceptedOperationId", "other"), ("acceptedPlanSha256", "0" * 64),
                           ("backendFingerprint", "0" * 64), ("targetKey", "other")):
            with self.subTest(key=key), self.assertRaisesRegex(CandidateError, "exact accepted plan"):
                self.verify({**self.chain, key: value})
        for key, changed in (("runtimeId", "f" * 64), ("schemaSha256", "f" * 64), ("configSha256", "f" * 64), ("running", 1)):
            invalid = deepcopy(self.chain)
            invalid["active"]["slot"]["runtime"][key] = changed
            with self.subTest(key=key), self.assertRaisesRegex(CandidateError, "exact accepted slot"):
                self.verify(invalid)
        for key in ("runtimeId", "fingerprint", "generation"):
            invalid = deepcopy(self.chain)
            invalid["previous"]["slot"]["route"][key] = "f" * 64
            with self.subTest(key=key), self.assertRaisesRegex(CandidateError, "exact accepted slot"):
                self.verify(invalid)
        plan = deepcopy(self.plan)
        plan["before"]["runtime"]["schemaSha256"] = "f" * 64
        with self.assertRaisesRegex(CandidateError, "accepted installed Web plan"):
            self.verify(accepted_plan=plan)

    def test_artifact_slots_are_independently_pinned(self):
        with self.assertRaisesRegex(CandidateError, "source, generation or private runtime alias"):
            self.verify(previous_web=self.web["active"])
        with self.assertRaisesRegex(CandidateError, "source, generation or private runtime alias"):
            self.verify({**self.chain, "previous": {**self.chain["previous"], "alias": "app"}})
        for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256"):
            invalid = deepcopy(self.chain)
            invalid["previous"]["provenance"][key] = invalid["active"]["provenance"][key]
            with self.subTest(key=key), self.assertRaisesRegex(CandidateError, "authenticated Web artifact"):
                self.verify(invalid)
        invalid = deepcopy(self.chain)
        invalid["active"]["receiptSha256"] = invalid["previous"]["receiptSha256"]
        with self.assertRaisesRegex(CandidateError, "separate immutable receipts"):
            self.verify(invalid)

    def test_original_backend_is_separate_from_retained_b_and_its_tested_config(self):
        wrong = {**self.backend, "sourceRevision": self.web["previous"]["sourceRevision"]}
        with self.assertRaisesRegex(CandidateError, "distinct from both Web generations"):
            self.verify(original_backend=wrong)
        wrong = deepcopy(self.backend)
        wrong["components"]["migrator"]["imageId"] = self.web["active"]["image"]["imageId"]
        with self.assertRaisesRegex(CandidateError, "configs must be distinct"):
            self.verify(original_backend=wrong)
        wrong["components"].pop("worker")
        with self.assertRaisesRegex(CandidateError, "original retained backend projection"):
            self.verify(original_backend=wrong)
