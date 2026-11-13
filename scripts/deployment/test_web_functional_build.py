import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, content_hash, decode
from web_functional_build import CRM_SWITCH, SWITCH_BUILD_TOOLKIT, main, prepare
from web_functional_successor_source import PROFILE_PATH, RETAINED, SWITCH
from web_release_inputs import _tree


class FunctionalWebBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = self.enterContext(TemporaryDirectory(prefix="functional-web-build-"))
        root = Path(temporary).resolve()
        profile = {"version": 1, "modules": ["src/components/shell/FeatureView.tsx"], "styles": [],
                   "adapters": ["src/components/shell/FeatureAdapter.tsx"]}
        profile_path = root / "profile.json"
        profile_path.write_bytes(canonical(profile))
        self.args = SimpleNamespace(root=root / "checkout", profile=profile_path, profile_sha256=content_hash(profile),
            revision="d" * 40, active_web_revision="c" * 40, tooling_revision="e" * 40, core_revision="a" * 40,
            core_manifest_sha256="b" * 64, core_bundle_dir=root / "core", web_projection=root / "projection",
            sdk_core=root / "core.tgz", sdk_react=root / "react.tgz", context=root / "context",
            output=root / "inputs.json", verify=False)
        self.context = {"gitInventorySha256": "3" * 64, "fileCount": 34}
        self.source = self.enterContext(patch("web_functional_build._source", return_value={"proof": "source"}))
        self.backend = self.enterContext(patch("web_functional_build._backend", return_value=({"proof": "backend"}, "5" * 64)))
        self.extension = self.enterContext(patch("web_functional_build.verify_web_extension_candidate", return_value={"proof": "extension"}))
        self.dependencies = self.extension
        self.prepare_context = self.enterContext(patch("web_functional_build.prepare_context", return_value=self.context))
        self.verify_context = self.enterContext(patch("web_functional_build.verify_context", return_value=self.context))

    def test_preparation_and_postbuild_require_the_same_combined_evidence(self):
        initial = prepare(self.args)
        value = decode(self.args.output.read_bytes())
        self.assertEqual(initial["inputSha256"], content_hash(value))
        self.assertEqual(value["schemaVersion"], 1)
        self.assertNotIn("sdkScenario", value)
        self.assertEqual(value["buildComponents"], ["web"])
        self.assertFalse(value["deploymentAuthorized"])
        self.args.verify = True
        self.assertEqual(prepare(self.args), initial)
        self.verify_context.return_value = {**self.context, "fileCount": 35}
        with self.assertRaisesRegex(CandidateError, "changed after compilation"):
            prepare(self.args)

    def test_wrong_profile_digest_holds_before_source_or_context(self):
        self.args.profile_sha256 = "0" * 64
        with self.assertRaisesRegex(CandidateError, "reviewed checksum"):
            prepare(self.args)
        self.source.assert_not_called()
        self.assertFalse(self.args.output.exists())

    def configure_switch(self):
        self.args.profile = None
        self.args.switch_successor = True
        root = self.args.root
        root.mkdir()
        self.git("init", "--quiet")
        self.put(SWITCH, b"old Switch")
        self.args.active_web_revision = self.commit()
        for path in SWITCH_BUILD_TOOLKIT:
            self.put(path, path.encode())
        self.put(PROFILE_PATH, b"reviewed switch profile fixture")
        self.args.tooling_revision = self.commit()
        self.put(SWITCH, b"new Switch")
        self.args.revision = self.commit()
        tree = _tree(root, self.args.revision)
        self.context = {"gitInventorySha256": content_hash({path: list(row) for path, row in tree.items()}),
                        "fileCount": len(tree)}
        self.prepare_context.return_value = self.context
        self.verify_context.return_value = self.context
        self.retained = {"components": {name: {"componentInputSha256": value * 64}
                         for name, value in zip(RETAINED, "abc")}, "proof": "original retained"}
        self.fingerprints = {name: self.retained["components"][name]["componentInputSha256"] for name in RETAINED}
        self.retained_pin = content_hash(self.retained)
        self.backend.return_value = (self.retained, self.retained_pin)
        self.switch_source = self.enterContext(patch("web_functional_build.verify_web_functional_successor_source", return_value={
            "schemaVersion": 2, "kind": "warpdrive-web-functional-successor-source", "deploymentAuthorized": False,
            "activeWebRevision": self.args.active_web_revision, "toolingRevision": self.args.tooling_revision,
            "candidateRevision": self.args.revision, "profileSha256": self.args.profile_sha256,
            "originalBackendReceiptSha256": self.retained_pin, "retainedComponentInputSha256": self.fingerprints,
        }))
        self.extension.return_value = {
            "schemaVersion": 1, "kind": "warpdrive-web-extension-candidate-inputs", "deploymentAuthorized": False,
            "sourceRevision": self.args.revision, "baselineRevision": self.args.active_web_revision,
            "originalBackendReceiptSha256": self.retained_pin, "retainedComponentInputSha256": self.fingerprints,
            "retainedBackendInputsSha256": content_hash(self.retained),
        }

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=self.args.root,
                                       timeout=10).decode().strip()

    def put(self, path, value):
        target = self.args.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)

    def commit(self):
        self.git("add", "--all")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet",
                 "--no-gpg-sign", "-m", "isolated build fixture")
        return self.git("rev-parse", "HEAD")

    def test_switch_uses_protected_source_and_real_dependency_contract_for_build_and_readback(self):
        self.configure_switch()
        initial = prepare(self.args)
        facts = decode(self.args.output.read_bytes())
        self.assertEqual(facts["schemaVersion"], 2)
        self.assertEqual(facts["sdkScenario"], CRM_SWITCH)
        self.assertEqual(facts["context"], self.context)
        self.assertEqual(initial["inputSha256"], content_hash(facts))
        self.switch_source.assert_called_once_with(self.args.root, active_revision=self.args.active_web_revision,
            tooling_revision=self.args.tooling_revision, candidate_revision=self.args.revision,
            profile_sha256=self.args.profile_sha256, original_backend_receipt=self.retained,
            original_backend_sha256=self.retained_pin)
        self.extension.assert_called_once_with(self.args.root, expected_revision=self.args.revision,
            expected_baseline_revision=self.args.active_web_revision, retained_receipt=self.retained,
            expected_retained_sha256=self.retained_pin, web_root=self.args.web_projection,
            sdk_archives={"@ui-sdk/core": self.args.sdk_core, "@ui-sdk/react": self.args.sdk_react})
        self.source.assert_not_called()
        self.args.verify = True
        self.assertEqual(prepare(self.args), initial)
        for changed in ({"sdkScenario": None}, {"schemaVersion": 1}, {"reviewedProfileSha256": "0" * 64}):
            with self.subTest(changed=changed):
                self.args.output.write_bytes(canonical(facts | changed))
                with self.assertRaisesRegex(CandidateError, "changed after compilation"):
                    prepare(self.args)

    def test_switch_rejects_other_proof_pins_and_nonmatching_git_context(self):
        self.configure_switch()
        self.extension.return_value["retainedBackendInputsSha256"] = "0" * 64
        with self.assertRaisesRegex(CandidateError, "source and dependency proofs"):
            prepare(self.args)
        self.prepare_context.assert_not_called()
        self.assertFalse(self.args.output.exists())
        self.extension.return_value["retainedBackendInputsSha256"] = content_hash(self.retained)
        self.prepare_context.return_value = {**self.context, "gitInventorySha256": "0" * 64}
        with self.assertRaisesRegex(CandidateError, "reviewed Git inventory"):
            prepare(self.args)
        self.assertFalse(self.args.output.exists())

    def test_switch_rejects_hidden_toolkit_change_before_source_or_dependencies(self):
        self.configure_switch()
        path = SWITCH_BUILD_TOOLKIT[1]
        self.git("update-index", "--assume-unchanged", path)
        self.put(path, b"hidden tool change")
        with self.assertRaisesRegex(CandidateError, "toolkit differs from protected tooling"):
            prepare(self.args)
        self.switch_source.assert_not_called()
        self.extension.assert_not_called()

    def test_switch_mode_cannot_be_selected_by_external_profile_or_receipt(self):
        self.configure_switch()
        self.args.profile = self.args.output.parent / "profile.json"
        with self.assertRaisesRegex(CandidateError, "exactly one"):
            prepare(self.args)
        self.switch_source.assert_not_called()
        self.args.switch_successor = False
        self.args.profile.write_bytes(canonical({"schemaVersion": 2}))
        with self.assertRaisesRegex(CandidateError, "profile version required"):
            prepare(self.args)
        self.switch_source.assert_not_called()

    def test_cli_preserves_v1_flag_and_requires_one_mode(self):
        args = [option for name in ("root", "core-bundle-dir", "web-projection", "sdk-core", "sdk-react",
                "context", "output", "revision", "active-web-revision", "tooling-revision", "core-revision",
                "core-manifest-sha256", "profile-sha256")
                for option in ("--" + name, os.fspath(getattr(self.args, name.replace("-", "_"))))]
        with patch("web_functional_build.prepare", return_value={}) as run, patch("builtins.print"):
            self.assertEqual(main([*args, "--profile", str(self.args.profile)]), 0)
            self.assertIs(run.call_args.args[0].switch_successor, False)
            self.assertEqual(main([*args, "--switch-successor"]), 0)
            self.assertIs(run.call_args.args[0].switch_successor, True)
            self.assertIsNone(run.call_args.args[0].profile)

    def test_structural_context_is_checked_before_and_after_build(self):
        self.args.structural_delta = self.args.profile.with_name("delta.json")
        self.args.structural_delta_sha256 = "4" * 64
        self.args.structural_registry_sha256 = None
        excluded = ["src/components/shell/FeatureView.test.tsx"]
        proof = {"excludedBuildTests": excluded, "retainedBackendInputsSha256": "5" * 64}
        self.dependencies.return_value = {"retainedBackendInputsSha256": "5" * 64}
        context = {**self.context, "schemaVersion": 2, "excludedTests": excluded, "excludedTestCount": 1,
                   "excludedTestPathsSha256": content_hash(excluded), "excludedTestsSha256": "6" * 64,
                   "contextInventorySha256": "7" * 64}
        self.prepare_context.return_value = self.verify_context.return_value = context
        with patch("web_functional_build._structural_source", return_value=proof):
            initial = prepare(self.args)
            self.assertEqual(self.prepare_context.call_args.kwargs, {"exclude_tests": excluded})
            stored = decode(self.args.output.read_bytes())
            self.assertEqual(stored["schemaVersion"], 3)
            self.assertEqual(stored["reviewedDeltaSha256"], self.args.structural_delta_sha256)
            self.assertEqual(stored["context"]["excludedPathsSha256"], content_hash(excluded))
            self.args.verify = True
            self.assertEqual(prepare(self.args), initial)
            self.assertEqual(self.verify_context.call_args.kwargs, {"exclude_tests": excluded})
            self.verify_context.return_value = {**context, "excludedTests": []}
            with self.assertRaisesRegex(CandidateError, "required structural test exclusions"):
                prepare(self.args)

    def test_structural_authority_inputs_must_be_supplied_together(self):
        self.args.structural_delta_sha256 = "4" * 64
        with self.assertRaisesRegex(CandidateError, "review inputs required together"):
            prepare(self.args)
        self.prepare_context.assert_not_called()
        self.assertFalse(self.args.output.exists())

    def test_switch_cannot_reuse_structural_authority_inputs(self):
        self.configure_switch()
        self.args.structural_delta = self.args.output.parent / "delta.json"
        self.args.structural_delta_sha256 = "4" * 64
        self.args.structural_registry_sha256 = None
        with self.assertRaisesRegex(CandidateError, "structural review inputs"):
            prepare(self.args)
        self.switch_source.assert_not_called()
        self.prepare_context.assert_not_called()
        self.assertFalse(self.args.output.exists())
