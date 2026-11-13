from pathlib import Path
import unittest

from candidate import CandidateError
from component_inputs import canonical, content_hash
import test_web_repeat_candidate as repeat_fixture
import web_functional_candidate as candidate
from web_repeat_candidate import runtime_hash


CURRENT, ORIGIN = repeat_fixture.CURRENT, repeat_fixture.ORIGIN


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
