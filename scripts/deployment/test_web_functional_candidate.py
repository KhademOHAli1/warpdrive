from copy import deepcopy
from pathlib import Path
import unittest

from candidate import CandidateError
from component_inputs import canonical, content_hash
import test_web_repeat_candidate as repeat_fixture
import web_functional_candidate as candidate
from web_repeat_candidate import runtime_hash


CURRENT, ORIGIN = repeat_fixture.CURRENT, repeat_fixture.ORIGIN
MODULE = "src/features/deals/useBoardCurrency.ts"
TEST = "src/features/deals/DealStatusBadge.test.tsx"
REGISTRY = "src/features/privacy/registryIdsCrm2.ts"


class FunctionalCandidateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = repeat_fixture.RepeatWebCandidateTests()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.root = self.fixture.private
        self.input_path = self.root / "functional-inputs.json"
        self.mixed_path = self.fixture.mixed_path
        self.directory = self.root / "functional-bundle"
        old, backend = (self.fixture.composite[name] for name in ("web", "backend"))
        self.facts = {
            "kind": "warpdrive-functional-web-build-inputs", "schemaVersion": 1, "revision": CURRENT,
            "activeWebRevision": old["sourceRevision"], "originalBackendRevision": backend["sourceRevision"],
            "originalBackendManifestSha256": backend["provenance"]["bundleManifestSha256"],
            "buildComponents": ["web"], "deploymentAuthorized": False, "toolingRevision": "e" * 40,
            "reviewedProfileSha256": "d" * 64,
            "context": {"gitInventorySha256": "1" * 64, "fileCount": 9820},
            "dependencies": {"kind": "warpdrive-web-extension-candidate-inputs", "sourceRevision": CURRENT,
                             "baselineRevision": old["sourceRevision"], "originalBackendReceiptSha256": backend["inputReceiptSha256"],
                             "retainedComponentInputSha256": {name: value["inputSha256"] for name, value in backend["components"].items()}},
            "source": {"schemaVersion": 1, "kind": "warpdrive-web-functional-source", "currentRevision": CURRENT,
                       "baselineRevision": "e" * 40, "profileSha256": "d" * 64, "guardedWebPathCount": 350,
                       "protectedSourceSha256": "8" * 64, "protectedGraphSha256": "9" * 64,
                       "changed": [{"path": "src/components/FeatureView.tsx", "baselineBlob": "2" * 40,
                                    "currentBlob": "3" * 40}], "deploymentAuthorized": False},
        }
        self.fixture.report["browserProfile"]["harnessRevision"] = CURRENT
        self.fixture.report["checks"][5]["detail"]["complete"]["sdkKeyboardHelp"] = {
            "openedByKeyboard": True, "escapeClosed": True, "focusRestored": True,
            "closeButtonWorked": True, "sameDocument": True,
        }
        self.mixed_path.write_bytes(canonical(self.fixture.report))
        self.input_path.write_bytes(canonical(self.facts))
        self.options = {"composite": self.fixture.composite, "revision": CURRENT, "origin": ORIGIN,
                        "expected_input_sha256": content_hash(self.facts), "installed_lineage_sha256": self.fixture.lineage_sha}

    def create(self):
        return candidate.create_functional_bundle(self.directory, input_path=self.input_path, mixed_path=self.mixed_path,
            image_id=self.fixture.docker.image_id, docker=self.fixture.docker, **self.options)

    def pin_facts(self, facts):
        self.input_path.write_bytes(canonical(facts))
        self.options["expected_input_sha256"] = content_hash(facts)

    def structural_facts(self, *, excluded=(), registry=None):
        facts = deepcopy(self.facts)
        facts.update(schemaVersion=2, reviewedDeltaSha256="d" * 64, reviewedRegistrySha256=registry)
        facts["dependencies"].update(schemaVersion=1, retainedBackendInputsSha256="5" * 64,
                                     buildIntegrationQualified=False, deploymentAuthorized=False)
        before, effect = (facts[key] for key in ("toolingRevision", "reviewedProfileSha256"))
        projection = {"schemaVersion": 1, "baselineRevision": before, "currentRevision": CURRENT,
                      "rendererCutsSha256": "a" * 64, "deploymentAuthorized": False}
        facts["source"] = {
            "schemaVersion": 1, "kind": "warpdrive-web-structural-source", "baselineRevision": before,
            "currentRevision": CURRENT, "deltaSha256": facts["reviewedDeltaSha256"], "effectsSha256": effect,
            "registryReviewSha256": registry, "changed": sorted([MODULE, *excluded, *([REGISTRY] if registry else [])]),
            "excludedBuildTests": list(excluded),
            "originalBackendReceiptSha256": facts["dependencies"]["originalBackendReceiptSha256"],
            "retainedBackendInputsSha256": facts["dependencies"]["retainedBackendInputsSha256"],
            "protectedSource": {
                **projection, "kind": "warpdrive-web-protected-source-projection",
                "protectedProjectionSha256": "b" * 64, "protectedRoots": 400, "protectedFiles": 3200,
            },
            "clientEffects": {
                **projection, "kind": "warpdrive-web-client-effect-projection", "profileSha256": effect,
                "effectSha256": "c" * 64, "capabilitySourceSha256": "d" * 64, "rendererContractSha256": "e" * 64,
                "baselineSubtreeSha256": "f" * 64, "candidateSubtreeSha256": "1" * 64, "capabilityUses": 0,
            },
            "deploymentAuthorized": False,
        }
        facts["context"].update(
            contextInventorySha256="2" * 64 if excluded else facts["context"]["gitInventorySha256"],
            excludedPathsSha256=content_hash(list(excluded)), excludedFileCount=len(excluded),
            excludedTestsSha256=content_hash({path: ["100644", "blob", "b" * 40] for path in excluded}),
        )
        return facts

    def test_save_reconstructs_the_exact_tested_web_image(self):
        created = self.create()
        readback = candidate.load_functional_bundle(self.directory, expected_manifest_sha256=created["bundleManifestSha256"], **self.options)
        self.assertEqual(readback, created)
        self.assertEqual(readback["archivePath"], Path(self.directory) / candidate.ARCHIVE)
        self.assertEqual(readback["image"]["imageId"], self.fixture.docker.image_id)
        self.assertFalse(readback["deploymentAuthorized"])

    def test_source_mismatch_cannot_reach_docker_or_create_a_bundle(self):
        self.facts["source"]["baselineRevision"] = "f" * 40
        self.input_path.write_bytes(canonical(self.facts))
        self.options["expected_input_sha256"] = content_hash(self.facts)
        with self.assertRaisesRegex(CandidateError, "source or retained backend"):
            self.create()
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.fixture.docker.calls, [])

    def test_version_two_requires_its_capability_binding_digest(self):
        source = self.facts["source"]
        source["schemaVersion"] = 2
        self.input_path.write_bytes(canonical(self.facts))
        self.options["expected_input_sha256"] = content_hash(self.facts)
        with self.assertRaisesRegex(CandidateError, "source proof version and protected hashes"):
            self.create()
        self.assertEqual(self.fixture.docker.calls, [])

        source["capabilityBindingsSha256"] = "4" * 64
        self.input_path.write_bytes(canonical(self.facts))
        self.options["expected_input_sha256"] = content_hash(self.facts)
        created = self.create()
        self.assertEqual(created["baseline"]["inputSha256"], self.options["expected_input_sha256"])

    def test_structural_receipt_preserves_native_bundle_save_and_readback(self):
        facts = self.structural_facts(excluded=(TEST,), registry="6" * 64)
        self.pin_facts(facts)
        created = self.create()
        self.assertEqual(candidate.load_functional_bundle(self.directory,
            expected_manifest_sha256=created["bundleManifestSha256"], **self.options), created)
        self.assertEqual(created["baseline"]["inputSha256"], content_hash(facts))
        self.assertFalse(created["deploymentAuthorized"])

    def test_structural_receipt_allows_no_exclusions_and_a_deleted_test_path(self):
        facts = self.structural_facts()
        facts["source"]["changed"] = sorted([MODULE, TEST])
        self.pin_facts(facts)
        self.assertEqual(self.create()["baseline"]["inputSha256"], content_hash(facts))

    def test_structural_source_proof_rejects_mismatched_pins_and_authority(self):
        changes = (
            (("source", "baselineRevision"), "f" * 40),
            (("source", "currentRevision"), "f" * 40),
            (("source", "deltaSha256"), "f" * 64),
            (("source", "effectsSha256"), "f" * 64),
            (("source", "registryReviewSha256"), "f" * 64),
            (("source", "originalBackendReceiptSha256"), "f" * 64),
            (("source", "retainedBackendInputsSha256"), "f" * 64),
            (("source", "deploymentAuthorized"), True),
            (("source", "schemaVersion"), True),
            (("source", "protectedSource", "currentRevision"), "f" * 40),
            (("source", "protectedSource", "rendererCutsSha256"), "f" * 64),
            (("source", "clientEffects", "profileSha256"), "f" * 64),
            (("source", "clientEffects", "baselineRevision"), "f" * 40),
            (("source", "clientEffects", "capabilityUses"), 513),
            (("source", "clientEffects", "deploymentAuthorized"), True),
            (("dependencies", "originalBackendReceiptSha256"), "f" * 64),
            (("dependencies", "buildIntegrationQualified"), True),
            (("dependencies", "deploymentAuthorized"), True),
            (("dependencies", "retainedComponentInputSha256", "worker"), "f" * 64),
            (("buildComponents",), ["web", "worker"]),
            (("toolingRevision",), CURRENT),
        )
        for keys, value in changes:
            with self.subTest(keys=keys):
                facts = self.structural_facts(excluded=(TEST,), registry="6" * 64)
                record = facts
                for key in keys[:-1]:
                    record = record[key]
                record[keys[-1]] = value
                self.pin_facts(facts)
                with self.assertRaises(CandidateError):
                    self.create()
                self.assertFalse(self.directory.exists())
                self.assertEqual(self.fixture.docker.calls, [])

    def test_structural_context_rejects_nonmatching_or_unscoped_excluded_paths(self):
        for excluded in (
            ["src/components/Unchanged.test.tsx"], [MODULE], [TEST, TEST],
            [TEST.lower(), TEST], ["/" + TEST], [TEST, MODULE], [7],
        ):
            with self.subTest(excluded=excluded):
                facts = self.structural_facts(excluded=(TEST,))
                facts["source"]["excludedBuildTests"] = excluded
                facts["context"].update(excludedFileCount=len(excluded), excludedPathsSha256=content_hash(excluded))
                self.pin_facts(facts)
                with self.assertRaisesRegex(CandidateError, "structural Web path|Structural Web paths"):
                    self.create()
        for updates in (
            {"excludedFileCount": 2}, {"excludedFileCount": True}, {"excludedPathsSha256": "0" * 64},
            {"excludedTestsSha256": content_hash({})}, {"excludedTestsSha256": None},
            {"contextInventorySha256": "1" * 64}, {"gitInventorySha256": "0" * 12}, {"fileCount": 20_000},
        ):
            with self.subTest(updates=updates):
                facts = self.structural_facts(excluded=(TEST,))
                facts["context"].update(updates)
                self.pin_facts(facts)
                with self.assertRaisesRegex(CandidateError, "Docker context"):
                    self.create()
        empty = self.structural_facts()
        empty["context"]["excludedTestsSha256"] = "0" * 64
        self.pin_facts(empty)
        with self.assertRaisesRegex(CandidateError, "exclusion inventory"):
            self.create()
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.fixture.docker.calls, [])

    def test_structural_registry_and_schema_cannot_be_reclassified(self):
        for top, source in (
            ({"schemaVersion": 1}, {}),
            ({"reviewedRegistrySha256": None}, {"registryReviewSha256": None}),
            ({}, {"changed": [MODULE]}),
            ({}, {"changed": sorted([REGISTRY, "src/server/Fake.tsx"])}),
        ):
            with self.subTest(top=top, source=source):
                facts = self.structural_facts(registry="6" * 64)
                facts.update(top)
                facts["source"].update(source)
                self.pin_facts(facts)
                with self.assertRaises(CandidateError):
                    self.create()
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.fixture.docker.calls, [])

    def test_browser_fixture_must_use_the_same_immutable_web_image(self):
        report = self.fixture.report
        report["checks"][2]["detail"]["qualification"]["assembly"]["newWeb"]["imageId"] = "sha256:" + "f" * 64
        report["checks"][2]["detail"]["qualificationSha256"] = runtime_hash(report["checks"][2]["detail"]["qualification"])
        self.mixed_path.write_bytes(canonical(report))
        with self.assertRaises(CandidateError):
            self.create()
        self.assertFalse(self.directory.exists())

    def test_browser_requires_all_sdk_keyboard_help_facts(self):
        complete = self.fixture.report["checks"][5]["detail"]["complete"]
        proof = complete.pop("sdkKeyboardHelp")
        for invalid in (None, {**proof, "focusRestored": False}, {**proof, "escapeClosed": 1}):
            with self.subTest(invalid=invalid):
                if invalid is not None:
                    complete["sdkKeyboardHelp"] = invalid
                self.mixed_path.write_bytes(canonical(self.fixture.report))
                with self.assertRaisesRegex(CandidateError, "browser continuity"):
                    self.create()
                self.assertFalse(self.directory.exists())
