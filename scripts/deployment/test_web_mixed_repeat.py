"""Exercise repeat fixture admission and image selection without a daemon."""

from contextlib import ExitStack
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from web_mixed_image_smoke import (
    BROWSER_PHASES, BROWSER_SCRIPT, REPEAT_BROWSER_PROFILE, REPEAT_LIMITATIONS, MixedWebSmoke,
    browser_message, repeat_assembly, repeat_baseline, repeat_mode, successor_baseline, successor_mode, verify_repeat_harness,
)
from web_switch_smoke import WebSwitchSmokeError


A, B, C, D, TOOLKIT = (letter * 40 for letter in "abcde")
MANIFEST = "1" * 64
B_MANIFEST = "2" * 64
B_ARCHIVE = b"synthetic archived active Web"
A_IMAGES = {name: f"sha256:{digit * 64}" for digit, name in zip("1234", ("web", "worker", "realtime", "migrator"))}
B_IMAGE = "sha256:" + "5" * 64
C_IMAGE = "sha256:" + "6" * 64
D_IMAGE = "sha256:" + "7" * 64


class RepeatMixedTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.active = self.root / "active"
        self.active.mkdir()
        (self.active / "web-image.tar").write_bytes(B_ARCHIVE)
        self.core = self.root / "core"
        self.core.mkdir()
        (self.core / "bundle.json").write_text("{}")
        self.receipt = self.root / "publication.json"
        self.receipt.write_text('{"fixture":true}')
        self.seed = self.root / "seed"
        self.seed.mkdir()
        self.args = SimpleNamespace(
            bundle_dir=self.core, baseline_revision=A, baseline_manifest_sha256=MANIFEST, browser=True,
            new_web_revision=C, new_web_image_id=C_IMAGE, output_dir=self.root / "output",
            active_web_bundle=self.active, active_web_publication_receipt=self.receipt,
            active_web_publication_receipt_sha256=hashlib.sha256(self.receipt.read_bytes()).hexdigest(),
            seed_root=self.seed, harness_revision=TOOLKIT,
        )
        self.backend = {
            "origin": {"kind": "github-actions"},
            "provenance": {"bundleManifestSha256": MANIFEST, "archiveSha256": "3" * 64},
            "candidate": {"schemaVersion": 2, "components": {
                name: {"imageId": value, "runtimeUser": "bun"} for name, value in A_IMAGES.items()
            }},
            "archivePath": self.core / "core-images.tar",
        }
        self.composite = {
            "web": {"sourceRevision": B, "image": {**self.image(B_IMAGE, B), "runtimeUser": "bun"},
                    "provenance": {"bundleManifestSha256": B_MANIFEST,
                                   "archiveSha256": hashlib.sha256(B_ARCHIVE).hexdigest()},
                    "inputReceipt": {"fixture": True},
                    "publicationReceiptSha256": self.args.active_web_publication_receipt_sha256},
            "backend": {
                "sourceRevision": A, "origin": self.backend["origin"], "provenance": self.backend["provenance"],
                "components": {name: self.backend["candidate"]["components"][name]
                               for name in ("worker", "realtime", "migrator")},
            },
        }

    @staticmethod
    def image(identifier, revision):
        return {"imageId": identifier, "sourceRevision": revision, "generation": "wd-" + revision}

    def test_requires_all_explicit_inputs_and_browser(self):
        self.assertFalse(repeat_mode(SimpleNamespace(browser=True)))
        self.assertTrue(repeat_mode(self.args))
        for override in ({"browser": False}, {"seed_root": None}, {"active_web_publication_receipt_sha256": "bad"},
                         {"active_web_bundle": Path(".")}):
            with self.subTest(override=override), self.assertRaises(WebSwitchSmokeError):
                repeat_mode(SimpleNamespace(**(vars(self.args) | override)))

    def test_authenticates_active_artifact_and_binds_b_source_to_a_b_c_ancestry(self):
        with (
            patch("web_composite_baseline.verify_web_composite_baseline", return_value=self.composite) as verify,
            patch("web_release_inputs._git") as git,
            patch("web_release_inputs._tree", return_value={}) as tree,
            patch("web_release_inputs._verify_baseline_blobs") as blobs,
        ):
            self.assertEqual(repeat_baseline(self.args, self.backend), self.composite)
            verify.assert_called_once_with(web_receipt=self.receipt.read_bytes(),
                expected_web_receipt_sha256=self.args.active_web_publication_receipt_sha256,
                web_bundle_dir=self.active, backend_bundle_dir=self.core, expected_backend_manifest_sha256=MANIFEST)
            self.assertEqual([call.args for call in git.call_args_list],
                [(self.seed, "merge-base", "--is-ancestor", A, B), (self.seed, "merge-base", "--is-ancestor", B, C)])
            tree.assert_called_once_with(self.seed, B)
            blobs.assert_called_once_with(self.seed, {}, self.composite["web"]["inputReceipt"])
            self.composite["backend"]["sourceRevision"] = B
            with self.assertRaisesRegex(WebSwitchSmokeError, "retained Core bundle"):
                repeat_baseline(self.args, self.backend)

    def test_loads_exact_a_and_b_archives_without_substituting_a_web_or_relabeling(self):
        docker_calls = []

        def run(args, **_):
            docker_calls.append(args)
            return SimpleNamespace(stdout="linux amd64")

        docker = SimpleNamespace(run=run)
        with ExitStack() as patches:
            patches.enter_context(patch("web_mixed_image_smoke.platform.system", return_value="Linux"))
            patches.enter_context(patch("web_mixed_image_smoke.platform.machine", return_value="x86_64"))
            patches.enter_context(patch("web_mixed_image_smoke.sha256", side_effect=lambda path:
                MANIFEST if path.name == "bundle.json" else hashlib.sha256(path.read_bytes()).hexdigest()))
            patches.enter_context(patch("web_mixed_image_smoke.load_bundle", return_value=self.backend))
            patches.enter_context(patch("web_mixed_image_smoke.repeat_baseline", return_value=self.composite))
            images = patches.enter_context(patch("web_mixed_image_smoke.ImageSmoke"))
            images.return_value.report = {"images": {name: {"id": value} for name, value in A_IMAGES.items()}}
            patches.enter_context(patch("web_mixed_image_smoke.read_web_image",
                                        side_effect=lambda _, identifier, revision: self.image(identifier, revision)))
            source = patches.enter_context(patch.object(MixedWebSmoke, "verify_browser_source"))
            fixture = MixedWebSmoke(docker, self.args, self.root / "private")
            report = fixture.load()
            source.assert_called_once_with(self.backend["candidate"])
            images.assert_called_once_with(docker, A_IMAGES, self.root / "private/fixture", expected_revision=A)
            self.assertEqual(docker_calls[1:], [
                ["image", "load", "--input", str(self.backend["archivePath"])],
                ["image", "load", "--input", str(self.active / "web-image.tar")],
            ])
            self.assertEqual(report["activeWebImage"], self.image(B_IMAGE, B))
            self.assertEqual(report["newWeb"], self.image(C_IMAGE, C))
            self.assertEqual(report["retainedBackendImages"], {name: A_IMAGES[name]
                for name in ("worker", "realtime", "migrator")})
            self.assertEqual(report["fixtureBuilds"], 0)
            self.assertEqual(fixture.report["revision"], B)
            self.assertEqual(fixture.report["limitations"], REPEAT_LIMITATIONS)
            self.assertEqual(fixture.report["browserProfile"], {
                "kind": REPEAT_BROWSER_PROFILE, "seedRevision": A, "harnessRevision": TOOLKIT,
            })

    def successor(self):
        successor = self.root / "successor"
        successor.mkdir()
        data = b"synthetic archive for successor C"
        (successor / "web-image.tar").write_bytes(data)
        self.backend["archivePath"].write_bytes(b"original full Core bytes")
        self.backend["provenance"]["archiveSha256"] = hashlib.sha256(self.backend["archivePath"].read_bytes()).hexdigest()
        publication = self.root / "successor-publication.json"
        publication.write_bytes(b'{"fixture":"C"}')
        digest = hashlib.sha256(publication.read_bytes()).hexdigest()
        args = SimpleNamespace(**(vars(self.args) | {
            "new_web_revision": D, "new_web_image_id": D_IMAGE,
            "successor_web_bundle": successor, "successor_web_publication_receipt": publication,
            "successor_web_publication_receipt_sha256": digest, "successor_web_revision": C,
            "predecessor_lineage_sha256": "4" * 64,
        }))
        composite = {**self.composite, "web": {
            "sourceRevision": C, "image": {**self.image(C_IMAGE, C), "runtimeUser": "bun"},
            "provenance": {"bundleManifestSha256": "5" * 64, "archiveSha256": hashlib.sha256(data).hexdigest()},
            "publicationReceiptSha256": digest, "inputReceipt": {"fixture": "C"},
        }}
        return args, composite

    def test_successor_requires_all_inputs_browser_and_separate_bundle_authorities(self):
        args, _ = self.successor()
        self.assertFalse(successor_mode(self.args))
        self.assertTrue(successor_mode(args))
        for override in (
            {"browser": False}, {"successor_web_revision": None}, {"predecessor_lineage_sha256": "bad"},
            {"successor_web_bundle": self.active}, {"successor_web_bundle": Path(".")},
            {"successor_web_publication_receipt_sha256": "bad"},
        ):
            with self.subTest(override=override), self.assertRaises(WebSwitchSmokeError):
                successor_mode(SimpleNamespace(**(vars(args) | override)))

    def test_successor_reconstructs_c_using_exact_b_predecessor_and_binds_c_sources(self):
        args, composite = self.successor()
        with (
            patch("web_mixed_image_smoke.repeat_baseline", return_value=self.composite) as predecessor,
            patch("web_repeat_successor.verify_repeat_successor", return_value=composite) as verify,
            patch("web_release_inputs._git") as git,
            patch("web_release_inputs._tree", return_value={}) as tree,
            patch("web_release_inputs._verify_baseline_blobs") as blobs,
        ):
            self.assertEqual(successor_baseline(args, self.backend), composite)
            predecessor.assert_called_once_with(args, self.backend, candidate_revision=C)
            verify.assert_called_once_with(
                predecessor=self.composite, repeat_bundle_dir=args.successor_web_bundle,
                publication_bytes=args.successor_web_publication_receipt.read_bytes(),
                expected_publication_sha256=args.successor_web_publication_receipt_sha256,
                expected_revision=C, predecessor_lineage_sha256=args.predecessor_lineage_sha256,
            )
            self.assertEqual(git.call_args.args, (self.seed, "merge-base", "--is-ancestor", C, D))
            tree.assert_called_once_with(self.seed, C)
            blobs.assert_called_once_with(self.seed, {}, composite["web"]["inputReceipt"])
            for overrides in ({"new_web_revision": B}, {"new_web_image_id": B_IMAGE},
                              {"new_web_image_id": A_IMAGES["worker"]}):
                with self.subTest(overrides=overrides), self.assertRaisesRegex(WebSwitchSmokeError, "distinct"):
                    successor_baseline(SimpleNamespace(**(vars(args) | overrides)), self.backend)
            verify.return_value = {**composite, "backend": {**composite["backend"], "sourceRevision": B}}
            with self.assertRaisesRegex(WebSwitchSmokeError, "predecessor and Core"):
                successor_baseline(args, self.backend)

    def successor_fixture(self, args, composite, stack):
        docker_calls, inspected, web_inspected = [], [], []

        def run(command, **_):
            docker_calls.append(command)
            return SimpleNamespace(stdout="linux amd64")

        def inspect(command, **_):
            self.assertEqual(command[:2], ["image", "inspect"])
            identifier = command[-1]
            inspected.append(identifier)
            self.assertIn(identifier, [A_IMAGES[name] for name in ("worker", "realtime", "migrator")])
            return [{"Id": identifier, "Os": "linux", "Architecture": "amd64",
                     "Config": {"User": "bun", "Labels": {"org.opencontainers.image.revision": A}}}]

        def web(_, identifier, revision):
            web_inspected.append((identifier, revision))
            self.assertIn((identifier, revision), ((C_IMAGE, C), (D_IMAGE, D)))
            return self.image(identifier, revision)

        stack.enter_context(patch("web_mixed_image_smoke.platform.system", return_value="Linux"))
        stack.enter_context(patch("web_mixed_image_smoke.platform.machine", return_value="x86_64"))
        stack.enter_context(patch("web_mixed_image_smoke.sha256", side_effect=lambda path:
            MANIFEST if path.name == "bundle.json" else hashlib.sha256(path.read_bytes()).hexdigest()))
        stack.enter_context(patch("web_mixed_image_smoke.load_bundle", return_value=self.backend))
        stack.enter_context(patch("web_mixed_image_smoke.successor_baseline", return_value=composite))
        stack.enter_context(patch("web_mixed_image_smoke.read_web_image", side_effect=web))
        source = stack.enter_context(patch.object(MixedWebSmoke, "verify_browser_source"))
        fixture = MixedWebSmoke(SimpleNamespace(run=run, json=inspect), args, self.root / "private")
        return fixture, docker_calls, inspected, web_inspected, source

    def test_successor_runtime_uses_c_d_and_retained_backend_without_old_web_dependencies(self):
        args, composite = self.successor()
        with ExitStack() as stack:
            fixture, docker_calls, inspected, web_inspected, source = self.successor_fixture(args, composite, stack)
            report = fixture.load()
        self.assertEqual(report, repeat_assembly(composite, self.image(D_IMAGE, D)))
        self.assertEqual(docker_calls[1:], [
            ["image", "load", "--input", str(self.backend["archivePath"])],
            ["image", "load", "--input", str(args.successor_web_bundle / "web-image.tar")],
        ])
        self.assertEqual(inspected, [A_IMAGES[name] for name in ("worker", "realtime", "migrator")])
        self.assertEqual(web_inspected, [(D_IMAGE, D), (C_IMAGE, C), (D_IMAGE, D)])
        self.assertEqual(fixture.old_image, self.image(C_IMAGE, C))
        self.assertEqual(fixture.new_image, self.image(D_IMAGE, D))
        self.assertEqual(fixture.report["revision"], C)
        self.assertEqual(fixture.report["schemaVersion"], 2)
        self.assertEqual(fixture.report["browserProfile"]["seedRevision"], A)
        self.assertEqual(fixture.report["browserProfile"]["harnessRevision"], TOOLKIT)
        source.assert_called_once_with(self.backend["candidate"])

    def test_successor_archive_replacement_fails_before_any_load(self):
        args, composite = self.successor()
        (args.successor_web_bundle / "web-image.tar").write_bytes(b"replaced")
        with ExitStack() as stack:
            fixture, docker_calls, inspected, _, _ = self.successor_fixture(args, composite, stack)
            with self.assertRaisesRegex(WebSwitchSmokeError, "Successor Web archive differs"):
                fixture.load()
        self.assertEqual(len(docker_calls), 1)
        self.assertEqual(inspected, [])

    def test_repeat_completion_requires_distinct_protocol_proof(self):
        original = {"phase": "complete", **BROWSER_PHASES["complete"]}
        repeat = {**original, "freshStampedPage": True}
        self.assertEqual(browser_message(original), original)
        self.assertEqual(browser_message(repeat, repeat=True), repeat)
        for message, profile in ((repeat, False), (original, True), ({**repeat, "freshStampedPage": 1}, True)):
            with self.subTest(profile=profile, message=message), self.assertRaises(WebSwitchSmokeError):
                browser_message(message, repeat=profile)

    def test_harness_source_rejects_a_hidden_tracked_edit_and_ignored_tooling(self):
        def git(args):
            return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=self.seed,
                                           text=True, env={"PATH": os.environ["PATH"]}, timeout=5)

        git(["init", "-q"])
        for name in (BROWSER_SCRIPT, "package.json", "tools/browser-smoke/package.json",
                     "tools/browser-smoke/bun.lock", "scripts/deployment/web_mixed_image_smoke.py"):
            path = self.seed / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("trusted source")
        (self.seed / ".gitignore").write_text("ignored.py\nnode_modules/\n")
        git(["add", "."])
        git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture"])
        revision = git(["rev-parse", "HEAD"]).strip()
        installed = self.seed / "tools/browser-smoke/node_modules/playwright/index.mjs"
        installed.parent.mkdir(parents=True)
        installed.write_text("frozen browser dependency fixture")
        with patch("web_mixed_image_smoke.admit_source"):
            verify_repeat_harness(self.seed, git, revision)
            git(["update-index", "--assume-unchanged", BROWSER_SCRIPT])
            (self.seed / BROWSER_SCRIPT).write_text("edited source!")
            self.assertEqual(git(["status", "--porcelain"]), "")
            with self.assertRaisesRegex(WebSwitchSmokeError, "exact reviewed source"):
                verify_repeat_harness(self.seed, git, revision)
            (self.seed / BROWSER_SCRIPT).write_text("trusted source")
            (self.seed / "scripts/deployment/ignored.py").write_text("shadow")
            self.assertEqual(git(["status", "--porcelain"]), "")
            with self.assertRaisesRegex(WebSwitchSmokeError, "Untracked"):
                verify_repeat_harness(self.seed, git, revision)


if __name__ == "__main__":
    unittest.main()
