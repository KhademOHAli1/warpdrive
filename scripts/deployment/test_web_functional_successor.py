"""Exercise reuse of a functional artifact with the exact prior public composite."""

from copy import deepcopy
from hashlib import sha256
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, content_hash
import test_web_functional_publication as fixture
import test_web_repeat_candidate as repeat_fixture
from web_functional_candidate import ARCHIVE, INPUTS, MIXED, create_functional_bundle
from web_functional_successor import verify_functional_publication, verify_functional_successor
from web_mixed_image_smoke import functional_successor_baseline, functional_successor_mode, repeat_assembly
from web_switch_smoke import WebSwitchSmokeError


class FunctionalSuccessorTests(unittest.TestCase):
    def setUp(self):
        hosted = fixture.FunctionalWebPublicationTests()
        self.addCleanup(hosted.doCleanups)
        hosted.setUp()
        self.receipt = hosted.retain()
        self.directory = hosted.output / "bundle"
        self.raw = (hosted.output / "receipt.json").read_bytes()
        self.predecessor = hosted.composite
        self.backend = deepcopy(self.predecessor["backend"])
        self.pin = sha256(self.raw).hexdigest()
        self.options = {"predecessor": self.predecessor, "expected_predecessor_sha256": content_hash(self.predecessor),
                        "original_backend": self.backend, "functional_bundle_dir": self.directory,
                        "publication_bytes": self.raw, "expected_publication_sha256": self.pin,
                        "expected_revision": self.receipt["revision"], "predecessor_lineage_sha256": hosted.lineage_sha}
        self.private_lineage = hosted.lineage

    def verify(self, **overrides):
        return verify_functional_successor(**(self.options | overrides))

    def changed_publication(self, value):
        raw = canonical(value)
        return {"publication_bytes": raw, "expected_publication_sha256": sha256(raw).hexdigest()}

    def test_exact_v1_archive_and_prior_composite_produce_a_reusable_public_baseline(self):
        snapshot = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        result = self.verify()
        self.assertEqual(result["backend"], self.backend)
        self.assertEqual(result["web"]["image"], self.receipt["image"])
        self.assertEqual(result["web"]["artifact"], self.receipt["artifact"])
        self.assertEqual(result["web"]["provenance"], self.receipt["provenance"])
        self.assertEqual(result["web"]["publicationReceiptSha256"], self.pin)
        self.assertEqual(result["web"]["inputProvenance"], {
            "kind": "warpdrive-web-functional-build-inputs", "schemaVersion": 1,
            "inputSha256": self.receipt["baseline"]["inputSha256"],
            "originalBackendReceiptSha256": self.backend["inputReceiptSha256"],
            "retainedComponentInputSha256": {key: item["inputSha256"] for key, item in self.backend["components"].items()},
        })
        self.assertNotIn("inputReceipt", result["web"])
        self.assertNotIn("inputReceiptSha256", result["web"])
        self.assertEqual(result["qualification"], {**self.receipt["qualification"], "retainedComponentInputsEqual": True})
        encoded = json.dumps(result)
        for slot in self.private_lineage["active"], self.private_lineage["previous"]:
            self.assertNotIn(slot["alias"], encoded)
            self.assertNotIn(json.dumps(slot["slot"]["runtime"]["runtimeId"]), encoded)
        self.assertIs(result["deploymentAuthorized"], False)
        self.assertEqual({path.name: path.read_bytes() for path in self.directory.iterdir()}, snapshot)
        self.assertNotIn("predecessor", result)
        result["backend"]["components"]["worker"]["imageId"] = "changed"
        self.assertEqual(self.verify()["backend"], self.backend)

    def test_result_feeds_the_existing_mixed_runtime_assembly(self):
        result = self.verify()
        new = {"imageId": "sha256:" + "e" * 64, "sourceRevision": "e" * 40, "generation": "wd-" + "e" * 40}
        assembly = repeat_assembly(result, new)
        self.assertEqual(assembly["activeWebRevision"], self.receipt["revision"])
        self.assertEqual(assembly["activeWebImage"]["imageId"], self.receipt["image"]["imageId"])
        self.assertEqual(assembly["originalBackendRevision"], self.backend["sourceRevision"])
        self.assertEqual(assembly["retainedBackendImages"], {key: item["imageId"] for key, item in self.backend["components"].items()})
        self.assertEqual(assembly["newWeb"], new)
        self.assertEqual(assembly["compositeSha256"], content_hash(result))

    def test_native_fixture_admits_functional_history_without_the_old_archive(self):
        root = self.directory.parent
        core, seed = (root / name for name in ("core", "seed"))
        core.mkdir()
        seed.mkdir()
        predecessor = root / "predecessor.json"
        predecessor.write_bytes(canonical(self.predecessor))
        predecessor.chmod(0o600)
        original = self.backend
        args = SimpleNamespace(
            browser=True, bundle_dir=core, seed_root=seed, harness_revision="e" * 40, new_web_revision="e" * 40,
            baseline_revision=original["sourceRevision"], baseline_manifest_sha256=original["provenance"]["bundleManifestSha256"],
            new_web_image_id="sha256:" + "e" * 64, successor_web_bundle=self.directory,
            successor_web_revision=self.receipt["revision"], successor_web_publication_receipt=root / "receipt.json",
            successor_web_publication_receipt_sha256=self.pin, predecessor_lineage_sha256=self.options["predecessor_lineage_sha256"],
            functional_predecessor_composite=predecessor, functional_predecessor_composite_sha256=content_hash(self.predecessor),
        )
        backend = {"candidate": {"schemaVersion": 2, "revision": original["sourceRevision"], "components": original["components"],
                                 "inputProvenance": {"receiptSha256": original["inputReceiptSha256"]}},
                   "origin": original["origin"], "provenance": original["provenance"]}
        self.assertTrue(functional_successor_mode(args))
        with patch("web_release_inputs._git") as git:
            self.assertEqual(functional_successor_baseline(args, backend), self.verify())
            history = (original["sourceRevision"], self.predecessor["web"]["sourceRevision"],
                       self.receipt["revision"], args.new_web_revision)
            self.assertEqual([call.args[-2:] for call in git.call_args_list], list(zip(history, history[1:])))
            args.new_web_image_id = self.predecessor["web"]["image"]["imageId"]
            with self.assertRaisesRegex(WebSwitchSmokeError, "must be distinct"):
                functional_successor_baseline(args, backend)
        args.active_web_bundle = core
        with self.assertRaisesRegex(WebSwitchSmokeError, "independent predecessor"):
            functional_successor_mode(args)

    def test_next_functional_bundle_reuses_composite_without_prior_archives(self):
        active = self.verify()
        revision = "e" * 40
        builder = repeat_fixture.RepeatWebCandidateTests()
        self.addCleanup(builder.doCleanups)
        builder.setUp()
        docker = builder.docker
        docker.config["Labels"]["org.opencontainers.image.revision"] = revision
        docker.config["Env"][1:] = ["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision]
        docker.raw_config = repeat_fixture.encoded({"architecture": "amd64", "os": "linux", "config": docker.config,
                                    "rootfs": {"type": "layers", "diff_ids": ["sha256:" + repeat_fixture.digest(docker.layer)]}})
        docker.image_id = "sha256:" + repeat_fixture.digest(docker.raw_config)
        next_image = {"imageId": docker.image_id, "sourceRevision": revision, "generation": "wd-" + revision}
        builder.assembly = repeat_assembly(active, next_image)
        report = builder.make_report()
        report["browserProfile"]["harnessRevision"] = revision
        report["checks"][5]["detail"]["complete"]["sdkKeyboardHelp"] = deepcopy(
            json.loads((self.directory / MIXED).read_bytes())["checks"][5]["detail"]["complete"]["sdkKeyboardHelp"])
        builder.mixed_path.write_bytes(canonical(report))
        facts = json.loads((self.directory / INPUTS).read_bytes())
        facts.update(revision=revision, activeWebRevision=active["web"]["sourceRevision"])
        facts["dependencies"].update(sourceRevision=revision, baselineRevision=active["web"]["sourceRevision"])
        facts["source"]["currentRevision"] = revision
        builder.inputs_path.write_bytes(canonical(facts))
        lineage_pin = "2" * 64
        origin = {**self.receipt["origin"], "runId": self.receipt["origin"]["runId"] + 1}
        loaded = create_functional_bundle(builder.output, input_path=builder.inputs_path, mixed_path=builder.mixed_path,
            composite=active, revision=revision, origin=origin, image_id=docker.image_id, docker=docker,
            expected_input_sha256=content_hash(facts), installed_lineage_sha256=lineage_pin)
        receipt = {**self.receipt, "revision": revision, "origin": origin,
                   "baseline": loaded["baseline"], "image": loaded["image"], "qualification": loaded["qualification"],
                   "provenance": {"bundleManifestSha256": loaded["bundleManifestSha256"],
                                  "archiveSha256": loaded["archive"]["sha256"], "archiveSizeBytes": loaded["archive"]["sizeBytes"]},
                   "security": {**self.receipt["security"], "revision": revision}}
        receipt["artifact"] = {**receipt["artifact"],
                               "name": f"web-functional-image-bundle-{revision}-{origin['runId']}-{origin['runAttempt']}"}
        receipt["ci"] = deepcopy(self.receipt["ci"])
        selected = next(row for row in receipt["ci"] if row["workflow"] == receipt["workflow"])
        selected.update(run_id=origin["runId"], url=f"https://github.com/{origin['repository']}/actions/runs/{origin['runId']}")
        self.directory.rename(self.directory.with_name("unavailable-prior-archive"))
        result = self.verify(predecessor=active, expected_predecessor_sha256=content_hash(active),
                             functional_bundle_dir=builder.output, expected_revision=revision,
                             predecessor_lineage_sha256=lineage_pin, **self.changed_publication(receipt))
        self.assertEqual(result["web"]["image"], loaded["image"])
        self.assertEqual(result["backend"], self.backend)
        self.assertNotIn("inputReceipt", result["web"])
        self.assertNotIn("predecessor", result)

    def test_foreign_pins_and_independent_backend_substitution_fail(self):
        self.assertEqual(verify_functional_publication(self.raw, expected_publication_sha256=self.pin,
                                                      expected_revision=self.receipt["revision"]), self.receipt)
        for key, value in (("expected_predecessor_sha256", "1" * 64), ("expected_publication_sha256", "1" * 64),
                           ("expected_revision", "0" * 40), ("predecessor_lineage_sha256", "1" * 64)):
            with self.subTest(key=key), self.assertRaises(CandidateError):
                self.verify(**{key: value})
        foreign = deepcopy(self.backend)
        foreign["components"]["worker"]["imageId"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(CandidateError, "Separately authenticated original backend"):
            self.verify(original_backend=foreign)

    def test_changed_predecessor_still_fails_with_a_matching_caller_pin(self):
        altered = deepcopy(self.predecessor)
        altered["web"]["inputReceiptSha256"] = "0" * 64
        with self.assertRaisesRegex(CandidateError, "exact predecessor composite"):
            self.verify(predecessor=altered, expected_predecessor_sha256=content_hash(altered))

    def test_receipt_must_bind_verified_archive_and_native_report(self):
        for group, key, new in (("provenance", "archiveSha256", "0" * 64),
                                ("qualification", "reportSha256", "0" * 64),
                                ("image", "runtimeUser", "changed")):
            altered = deepcopy(self.receipt)
            altered[group][key] = new
            with self.subTest(group=group), self.assertRaisesRegex(CandidateError, "does not bind"):
                self.verify(**self.changed_publication(altered))
        for name in (ARCHIVE, MIXED):
            path = self.directory / name
            raw = path.read_bytes()
            path.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
            try:
                with self.subTest(name=name), self.assertRaises(CandidateError):
                    self.verify()
            finally:
                path.write_bytes(raw)

    def test_historical_origin_and_security_are_typed_and_bound(self):
        changes = (
            ("origin", "runAttempt", 2),
            ("artifact", "id", True),
            ("security", "blocking_alerts", False),
            ("security", "main_bound_before_and_after", 1),
            ("baseline", "activeWebRevision", self.receipt["revision"]),
        )
        for group, key, value in changes:
            altered = deepcopy(self.receipt)
            altered[group][key] = value
            with self.subTest(group=group, key=key), self.assertRaises(CandidateError):
                self.verify(**self.changed_publication(altered))
        altered = deepcopy(self.receipt)
        del altered["ci"][-1]
        with self.assertRaisesRegex(CandidateError, "CI attempt differs"):
            self.verify(**self.changed_publication(altered))
