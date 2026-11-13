from pathlib import Path
import unittest

from candidate import CandidateError
from component_inputs import canonical, content_hash
import test_web_repeat_candidate as repeat_fixture
import web_functional_candidate as candidate
from web_mixed_image_smoke import CRM_SWITCH, SDK_SWITCH
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
            "source": {"kind": "warpdrive-web-functional-source", "currentRevision": CURRENT, "baselineRevision": "e" * 40,
                       "profileSha256": "d" * 64, "changed": [{"path": "src/components/FeatureView.tsx"}]},
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

    def enable_switch(self):
        profile, tooling = self.facts["reviewedProfileSha256"], self.facts["toolingRevision"]
        dependencies = self.facts["dependencies"]
        self.facts.update(schemaVersion=2, sdkScenario=CRM_SWITCH, source={
            "schemaVersion": 2, "kind": "warpdrive-web-functional-successor-source",
            "activeWebRevision": self.facts["activeWebRevision"], "toolingRevision": tooling,
            "candidateRevision": CURRENT, "profileSha256": profile, "toolingChanges": [], "carriedWebChanges": [],
            "changed": [{"path": candidate.SWITCH, "beforeBlob": "a" * 40, "afterBlob": "b" * 40}],
            "runtimePolicySha256": "1" * 64, "engineContextTreeSha256": "2" * 64,
            "webInputSha256": "3" * 64, "importPolicySha256": "4" * 64,
            "originalBackendReceiptSha256": dependencies["originalBackendReceiptSha256"],
            "retainedComponentInputSha256": dependencies["retainedComponentInputSha256"],
            "sdkBindings": {candidate.SWITCH: [{"specifier": candidate.SWITCH_ENTRY, "exported": name, "local": name}
                                              for name in candidate.SWITCH_EXPORTS]},
            "deploymentAuthorized": False,
        })
        self.fixture.report["browserProfile"]["sdkScenario"] = CRM_SWITCH
        self.fixture.report["checks"][5]["detail"]["complete"]["sdkSwitch"] = dict(SDK_SWITCH)
        self.options.update(sdk_scenario=CRM_SWITCH, expected_tooling_revision=tooling, expected_profile_sha256=profile)
        self.write_inputs()

    def write_inputs(self):
        self.input_path.write_bytes(canonical(self.facts))
        self.mixed_path.write_bytes(canonical(self.fixture.report))
        self.options["expected_input_sha256"] = content_hash(self.facts)

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

    def test_switch_bundle_requires_external_authority_again_on_readback(self):
        self.enable_switch()
        created = self.create()
        external = {**self.options, "expected_manifest_sha256": created["bundleManifestSha256"]}
        self.assertEqual(candidate.load_functional_bundle(self.directory, **external), created)
        for overrides in ({"sdk_scenario": None, "expected_tooling_revision": None, "expected_profile_sha256": None},
                          {"expected_profile_sha256": "9" * 64}, {"expected_tooling_revision": "9" * 40}):
            with self.subTest(overrides=overrides), self.assertRaises(CandidateError):
                candidate.load_functional_bundle(self.directory, **(external | overrides))

    def test_switch_report_cannot_substitute_for_missing_switch_build_facts(self):
        self.enable_switch()
        self.facts["schemaVersion"] = 1
        self.write_inputs()
        with self.assertRaisesRegex(CandidateError, "build context receipt"):
            self.create()
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.fixture.docker.calls, [])

    def test_switch_build_facts_cannot_substitute_for_browser_proof(self):
        self.enable_switch()
        self.fixture.report["checks"][5]["detail"]["complete"]["sdkSwitch"]["actionPosts"] = True
        self.write_inputs()
        with self.assertRaisesRegex(CandidateError, "browser continuity"):
            self.create()
        self.assertFalse(self.directory.exists())

    def test_switch_bundle_rejects_rehashed_source_without_the_reviewed_named_binding(self):
        self.enable_switch()
        self.facts["source"]["sdkBindings"][candidate.SWITCH][0]["exported"] = "Unknown"
        self.write_inputs()
        with self.assertRaisesRegex(CandidateError, "named Switch bindings"):
            self.create()
        self.assertFalse(self.directory.exists())
