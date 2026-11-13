"""Verify the actual Web-only producer's admission and immutable handoff."""
from copy import deepcopy
import hashlib
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import web_release_build as build


OLD = "a" * 40
NEW = "b" * 40
IMAGE = "sha256:" + "a" * 64
ENVIRONMENT = {
    "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
    "GITHUB_REPOSITORY": build.REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": NEW,
    "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_RUN_ID": "100", "GITHUB_RUN_ATTEMPT": "1",
}
BUILD_ARGS = {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"}


class WebReleaseBuildTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="warpdrive-web-build-test-")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name).resolve()
        self.args = SimpleNamespace(
            root=root / "candidate", expected_revision=NEW, baseline_dir=root / "baseline-bundle",
            baseline_admission=root / "admission.json", baseline_admission_sha256="0" * 64,
            input_receipt=root / "input.json", state_dir=root / "build-state",
            baseline_root=root / "baseline-checkout", new_web_image_id=IMAGE,
            bundle_output=root / "output",
        )
        for path in (self.args.root, self.args.baseline_dir, self.args.baseline_root):
            path.mkdir()
        self.origin = build.origin_for(NEW, ENVIRONMENT)
        self.current = {"context": {"buildArgs": BUILD_ARGS}}
        self.facts = {
            "sourceDelta": {"buildComponents": ["web"], "changedPresentationPaths": [build.STYLE_FILE]},
            "baselineManifestSha256": "1" * 64,
            "baselineArchiveSha256": "2" * 64,
            "baselineImages": {name: f"sha256:{index:064x}" for index, name in enumerate(build.COMPONENTS, 1)},
        }
        self.binding = {
            "origin": self.origin, "root": str(self.args.root), "baselineDirectory": str(self.args.baseline_dir),
            "baselineAdmissionSha256": self.args.baseline_admission_sha256, "facts": self.facts,
        }
        free = patch.object(build.shutil, "disk_usage", return_value=SimpleNamespace(free=20 * build.GIB))
        free.start()
        self.addCleanup(free.stop)

    def test_hosted_exact_main_admission_rejects_other_origins(self):
        self.assertEqual(self.origin["runId"], 100)
        self.assertEqual(self.origin["runAttempt"], 1)
        for name, value in {
            "GITHUB_ACTIONS": "false", "RUNNER_ENVIRONMENT": "self-hosted", "GITHUB_REPOSITORY": "other/repository",
            "GITHUB_REF": "refs/pull/1/merge", "GITHUB_SHA": OLD, "GITHUB_EVENT_NAME": "pull_request_target",
            "GITHUB_RUN_ID": "0", "GITHUB_RUN_ATTEMPT": "01",
        }.items():
            with self.subTest(name=name), self.assertRaisesRegex(build.WebBuildError, "hosted main"):
                build.origin_for(NEW, {**ENVIRONMENT, name: value})

    def test_authenticated_baseline_binds_checksum_zip_and_distinct_origin(self):
        build.write_metadata(self.args.baseline_admission, {"revision": OLD})
        pin = hashlib.sha256(self.args.baseline_admission.read_bytes()).hexdigest()
        producer = {**self.origin, "runId": 50}
        loaded = {"origin": producer, "candidate": {"schemaVersion": 2,
                  "inputProvenance": {"receiptSha256": build.inputs.content_hash(self.current)},
                  "components": {name: {"imageId": image} for name, image in self.facts["baselineImages"].items()}}}
        build.write_metadata(self.args.baseline_dir / build.INPUT_RECEIPT, self.current)
        with patch.object(build, "verify_downloaded", return_value=loaded) as verify:
            with self.assertRaisesRegex(build.WebBuildError, "checksum"):
                build.baseline_bundle(self.args.baseline_dir, self.args.baseline_admission, "0" * 64, self.origin)
            verify.assert_not_called()
            result = build.baseline_bundle(self.args.baseline_dir, self.args.baseline_admission, pin, self.origin)
            self.assertEqual(result, (OLD, loaded, self.current, self.facts["baselineImages"]))
            verify.assert_called_once_with({"revision": OLD}, self.args.baseline_dir, expected_revision=OLD)
            producer["runId"] = self.origin["runId"]
            with self.assertRaisesRegex(build.WebBuildError, "separately qualified"):
                build.baseline_bundle(self.args.baseline_dir, self.args.baseline_admission, pin, self.origin)

    def test_browser_profile_requires_exact_css_bytes_and_accepts_tooling_evidence(self):
        previous = b".bar {\n  gap: 24px;\n  height: 36px;\n}\n"
        changed = previous.replace(b"24px", b"22px")
        source = {**self.facts["sourceDelta"], "changedReleaseToolingPaths": ["scripts/deployment/web_release_build.py"]}
        with patch.object(build, "checkout") as exact, patch.object(build, "verify_web_source_delta", return_value=source):
            with patch.object(build, "git", side_effect=[previous, changed]) as git:
                self.assertIs(build.verify_source(self.args, OLD, self.current, self.current), source)
                exact.assert_called_once_with(self.args.root, NEW)
                self.assertEqual([call.args[3] for call in git.call_args_list],
                                 [f"{OLD}:{build.STYLE_FILE}", f"{NEW}:{build.STYLE_FILE}"])
            with patch.object(build, "git", side_effect=[previous, changed.replace(b"36px", b"38px")]):
                with self.assertRaisesRegex(build.WebBuildError, "exact 24px-to-22px"):
                    build.verify_source(self.args, OLD, self.current, self.current)

    def test_single_image_native_and_bundle_handoff(self):
        native, docker = Mock(), Mock()
        with patch.object(build, "prepared_inputs", return_value=(self.origin, OLD, self.current, self.binding)), \
                patch.object(build, "verify_baseline_checkout") as baseline, \
                patch.object(build, "read_web_image") as inspect, \
                patch.object(build, "create_web_bundle", return_value={"deploymentAuthorized": False}) as retain:
            plan = build.prepare(self.args, ENVIRONMENT)
            self.assertEqual(plan["target"], "web")
            self.assertEqual(plan["buildArgs"], {**BUILD_ARGS, "APP_COMMIT": NEW})
            self.assertEqual(plan["contextDirectory"], str(self.args.root))
            self.assertFalse(plan["deploymentAuthorized"])
            with self.assertRaisesRegex(build.WebBuildError, "fresh canonical output"):
                build.prepare(self.args, ENVIRONMENT)
            result = build.qualify(self.args, ENVIRONMENT, docker, native=native)
            self.assertFalse(result["deploymentAuthorized"])
            inspect.assert_called_once_with(docker, IMAGE, NEW)
            native.assert_called_once_with(self.args.baseline_root, self.args, OLD, self.facts["baselineManifestSha256"],
                                           self.args.state_dir / build.MIXED)
            self.assertEqual([call.args for call in baseline.call_args_list], [(self.args.baseline_root, OLD)] * 2)
            self.assertEqual(retain.call_args.args, (self.args.root, self.args.bundle_output))
            self.assertEqual(retain.call_args.kwargs["mixed_report_path"], self.args.state_dir / build.MIXED / "report.json")
            self.assertIs(retain.call_args.kwargs["docker"], docker)
            saved = build.inputs.decode(build.read_metadata(retain.call_args.kwargs["build_evidence_path"]))
            self.assertEqual({name: saved[name] for name in self.facts}, self.facts)
            self.assertEqual(saved["candidateWebImageId"], IMAGE)
            self.assertTrue(saved["sourceVerifiedAfterBuild"])

    def test_changed_prepared_binding_or_reused_image_holds_before_docker(self):
        native, docker = Mock(), Mock()
        supplied = (self.origin, OLD, self.current, self.binding)
        with patch.object(build, "prepared_inputs", return_value=supplied) as discover, \
                patch.object(build, "read_web_image") as inspect, patch.object(build, "create_web_bundle") as retain:
            build.prepare(self.args, ENVIRONMENT)
            changed = deepcopy(self.binding)
            changed["origin"]["runAttempt"] += 1
            discover.return_value = (self.origin, OLD, self.current, changed)
            with self.assertRaisesRegex(build.WebBuildError, "binding changed"):
                build.qualify(self.args, ENVIRONMENT, docker, native=native)
            discover.return_value = supplied
            self.args.new_web_image_id = self.facts["baselineImages"]["worker"]
            with self.assertRaisesRegex(build.WebBuildError, "reuses a baseline"):
                build.qualify(self.args, ENVIRONMENT, docker, native=native)
            inspect.assert_not_called()
            native.assert_not_called()
            retain.assert_not_called()

    def test_historical_fixture_rejects_hidden_git_index_change(self):
        root = self.args.baseline_root
        for name in (build.HARNESS, *build.BROWSER):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("original\n")

        def git(*arguments):
            return subprocess.run(
                ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *arguments],
                cwd=root, check=True, capture_output=True, text=True, timeout=8,
            ).stdout.strip()

        git("init", "-q")
        git("add", ".")
        git("commit", "-qm", "Native fixture")
        revision = git("rev-parse", "HEAD")
        build.verify_baseline_checkout(root, revision)
        git("update-index", "--assume-unchanged", "--", build.HARNESS)
        (root / build.HARNESS).write_text("hidden modification\n")
        self.assertEqual(git("status", "--porcelain"), "")
        with self.assertRaisesRegex(build.WebBuildError, "exact Git blob"):
            build.verify_baseline_checkout(root, revision)


if __name__ == "__main__":
    unittest.main()
