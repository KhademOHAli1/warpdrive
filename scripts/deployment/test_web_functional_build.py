from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, content_hash, decode
from web_functional_build import prepare


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
        self.enterContext(patch("web_functional_build._backend", return_value=({"proof": "backend"}, "5" * 64)))
        self.dependencies = self.enterContext(patch("web_functional_build.verify_web_extension_candidate",
                                                   return_value={"proof": "extension"}))
        self.prepare_context = self.enterContext(patch("web_functional_build.prepare_context", return_value=self.context))
        self.verify_context = self.enterContext(patch("web_functional_build.verify_context", return_value=self.context))

    def test_preparation_and_postbuild_require_the_same_combined_evidence(self):
        initial = prepare(self.args)
        value = decode(self.args.output.read_bytes())
        self.assertEqual(initial["inputSha256"], content_hash(value))
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
