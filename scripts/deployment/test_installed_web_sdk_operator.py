"""SDK orchestration over private temporary custody and mocked native boundaries.

Real SDK publication/qualification predicates have their separate admission
suite. These cases verify ordering, exact arguments, source/custody holds,
unknown acknowledgements and operator-only lifecycle/readback composition.
"""

from copy import deepcopy
from hashlib import sha256
import io
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import component_inputs as inputs
import installed_web_sdk_operator as operator
import test_installed_web_functional_operator as legacy_fixtures
from installed_web_image import WebImageUnknown
from installed_web_lineage import _generation
from installed_web_sdk_runtime import PROFILE_ID
from installed_web_stage_ack import _verify_stage_load as generic_verify_stage_load
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, SwitchUnknown, canonical, content_hash


class SdkOperatorTests(unittest.TestCase):
    def setUp(self):
        fixture = legacy_fixtures.FunctionalOperatorTests(
            "test_legacy_stage_reuses_exact_chain_and_releases_target_before_private_start")
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.fixture = fixture
        self.root = fixture.operation.parent
        self.operation = self.root / ("sdk-web-release-" + fixture.args.suffix)
        self.artifact, self.bundle, self.projected = (self.operation / path for path in
            ("artifact", "artifact/bundle", "artifact/projected-web"))
        for path in (self.operation, self.artifact, self.bundle, self.projected,
                     self.bundle / "smoke", self.bundle / "inspections"):
            path.mkdir(mode=0o700)
        self.args = SimpleNamespace(**vars(fixture.args))
        self.args.operation = self.operation
        self.args.sealed_index_sha256 = None
        self.events = []
        self.sdk_input = {"kind": "fixture-already-validated-sdk-inputs", "sourceRevision": self.args.revision}
        self.original_input = {"kind": "fixture-genuine-full-original-inputs", "components": ["web", "worker", "realtime", "migrator"]}
        self.comparison = {"schemaVersion": 1, "kind": "warpdrive-sdk-installed-backend-comparison",
            "sourceRevision": self.args.revision, "originalBackendRevision": "0" * 40,
            "allInputsEqual": False, "runtimeCompatibilityQualified": False, "deploymentAuthorized": False}
        full_archive = b"fixture original four-role image archive"
        projected_archive = b"fixture separately verified one-Web OCI archive"
        self.put(self.bundle / operator.full_bundle.ARCHIVE, full_archive)
        self.put(self.projected / "web-image.tar", projected_archive)
        for name in operator.full_bundle.metadata_files(3):
            self.put(self.bundle / name, inputs.canonical(self.sdk_input if name == "component-inputs.json" else {}))
        self.full_candidate = {"schemaVersion": 3, "kind": "warpdrive-image-candidate", "revision": self.args.revision,
            "components": {name: {"imageId": "sha256:" + digit * 64} for name, digit in
                           (("web", "1"), ("worker", "4"), ("realtime", "5"), ("migrator", "6"))},
            "deploymentAuthorized": False, "pendingGates": ["installation", "independently-qualified-component-reuse"]}
        self.put(self.bundle / "candidate.json", inputs.canonical(self.full_candidate))
        origin = {"kind": "github-actions", "repository": "KhademOHAli1/warpdrive", "runId": 42,
                  "runAttempt": 1, "ref": "refs/heads/main", "event": "push"}
        manifest = {"schemaVersion": 3, "kind": "warpdrive-tested-image-bundle", "revision": self.args.revision,
            "releaseRevision": self.args.revision, "origin": origin, "platform": "linux/amd64", "files": {}}
        manifest_raw = inputs.canonical(manifest)
        self.put(self.bundle / operator.full_bundle.MANIFEST, manifest_raw)
        full_manifest_sha, full_archive_sha = sha256(manifest_raw).hexdigest(), sha256(full_archive).hexdigest()
        self.put(self.artifact / "bundle.zip", b"fixture original API-bound ZIP")
        self.publication = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
            "repository": "KhademOHAli1/warpdrive", "revision": self.args.revision,
            "producer": {key: value for key, value in origin.items() if key not in {"kind", "repository"}},
            "deploymentAuthorized": False}
        publication_raw = (json.dumps(self.publication, indent=2) + "\n").encode()
        publication_sha = sha256(publication_raw).hexdigest()
        self.put(self.artifact / "publication-receipt.json", publication_raw)
        image = {"imageId": "sha256:" + "2" * 64, "sourceRevision": self.args.revision,
                 "runtimeUser": "bun", "generation": "wd-" + self.args.revision}
        provenance = {"bundleManifestSha256": full_manifest_sha, "archiveSha256": sha256(projected_archive).hexdigest(),
                      "archiveSizeBytes": len(projected_archive)}
        self.projection = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-archive-projection",
            "sourceRevision": self.args.revision, "platform": "linux/amd64",
            "original": {"kind": manifest["kind"], "schemaVersion": 3,
                "publicationAdmissionSha256": inputs.content_hash(self.publication), "origin": origin,
                "bundleManifestSha256": full_manifest_sha, "archiveSha256": full_archive_sha,
                "archiveSizeBytes": len(full_archive), "testedNativeImageId": self.full_candidate["components"]["web"]["imageId"],
                "candidatePendingGates": self.full_candidate["pendingGates"]},
            "selectedWeb": {"configDigest": image["imageId"], "manifestDigest": "sha256:" + "3" * 64},
            "derived": {"archiveSha256": provenance["archiveSha256"], "archiveSizeBytes": provenance["archiveSizeBytes"]},
            "image": image, "provenance": provenance, "projectionOnly": True, "backendReuseQualified": False,
            "installationAuthorized": False, "deploymentAuthorized": False}
        self.binding = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-runtime-binding",
            "publicationReceiptSha256": publication_sha, "sourceRevision": self.args.revision,
            "imageId": self.projection["selectedWeb"]["manifestDigest"], "testedConfigDigest": image["imageId"],
            "profileId": PROFILE_ID, "command": ["bun", "--bun", "next", "start"]}
        self.qualification = {"kind": "fixture-separately-admitted-native-mixed-qualification", "state": "passed"}
        self.engine = {"id": "9" * 64, "kind": "fixture-separately-admitted-engine-witness"}
        self.contract = {"kind": "fixture-reviewed-source-contract", "notes": "6b → current; آلمان"}
        records = {"original-backend-inputs.json": self.original_input, "backend-comparison.json": self.comparison,
            "runtime-binding.json": self.binding, "backend-reuse-qualification.json": self.qualification,
            "engine-witness.json": self.engine, "contract-review.json": self.contract}
        for name, value in records.items():
            self.put(self.operation / name, inputs.canonical(value))
        self.put(self.artifact / "projection.json", inputs.canonical(self.projection))
        self.admission = {"schemaVersion": 1, "kind": operator.ADMISSION_KIND, "revision": self.args.revision,
            "originalBackendRevision": "0" * 40, "sdkInputReceiptSha256": inputs.content_hash(self.sdk_input),
            "publicationReceiptSha256": publication_sha, "projectionReceiptSha256": inputs.content_hash(self.projection),
            "installedChainSha256": self.args.lineage_sha256, "backendFingerprint": fixture.chain["backendFingerprint"],
            "fullBundleManifestSha256": full_manifest_sha, "fullArchiveSha256": full_archive_sha,
            "fullArchiveSizeBytes": len(full_archive),
            **{key: inputs.content_hash(records[name]) for name, key in operator.RECORDS.items()}}
        self.freeze_admission()
        self.release = {"schemaVersion": 1, "kind": "warpdrive-installed-sdk-web-release", "sourceRevision": self.args.revision,
            "publicationReceiptSha256": publication_sha, "image": image, "provenance": provenance,
            "projectionReceiptSha256": self.admission["projectionReceiptSha256"],
            "runtimeBindingSha256": self.admission["runtimeBindingSha256"],
            "backendReuseQualificationSha256": self.admission["backendReuseQualificationSha256"]}
        self.loaded = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
            "sourceRevision": self.args.revision, "origin": origin,
            "baselineRevision": fixture.chain["active"]["provenance"]["revision"],
            "baselineManifestSha256": fixture.chain["active"]["provenance"]["manifestSha256"],
            **provenance, "testedConfigDigest": image["imageId"], "manifestDigest": self.binding["imageId"],
            "imageId": self.binding["imageId"], "daemon": fixture.identity,
            "beforeInventorySha256": "a" * 64, "afterInventorySha256": "b" * 64, "deploymentAuthorized": False}
        self.enterContext(patch.object(operator, "PRIVATE", self.root))
        self.enterContext(patch.object(operator, "INSTALLATION_UID", os.geteuid()))
        self.enterContext(patch.object(operator, "_existing_lock", side_effect=fixture.lock))
        self.enterContext(patch.object(operator, "read_record", side_effect=lambda path: operator.decode(path.read_bytes())))
        self.enterContext(patch.object(operator, "read_autosave", return_value=fixture.preimage))
        downloaded = {"candidate": self.full_candidate, "origin": origin,
                      "provenance": {"bundleManifestSha256": full_manifest_sha, "archiveSha256": full_archive_sha}}
        self.downloaded = self.enterContext(patch.object(operator, "verify_downloaded",
            side_effect=lambda *_a, **_k: self.event("publication", deepcopy(downloaded))))
        self.compare = self.enterContext(patch.object(operator, "compare_backend_inputs",
            side_effect=lambda *_a, **_k: self.event("comparison", deepcopy(self.comparison))))
        self.build_release = self.enterContext(patch.object(operator, "build_sdk_release",
            side_effect=lambda **_k: self.event("qualification", deepcopy(self.release))))
        self.facts = {"descriptor": {"digest": self.binding["imageId"]}}
        self.enterContext(patch.object(operator, "_archive_facts", return_value=self.facts))
        self.native = Mock()
        self.native.identity.return_value = fixture.identity
        self.native_factory = self.enterContext(patch.object(operator, "LocalDocker",
            side_effect=lambda **_k: self.event("native", self.native)))
        self.docker = self.enterContext(patch.object(operator, "InstalledDocker"))
        self.engine_check = self.enterContext(patch.object(operator, "verify_engine_unchanged", return_value=self.engine))
        self.install = self.enterContext(patch.object(operator, "InstalledWebSdkSuccessor"))
        self.install.return_value.backend.return_value = {"backendFingerprint": fixture.chain["backendFingerprint"]}
        self.install.return_value.stage.side_effect = self.stage
        self.loader = self.enterContext(patch.object(operator, "load_verified_web_archive", return_value=self.loaded))
        self.verify_load = self.enterContext(patch.object(operator, "_verify_stage_load"))
        self.enterContext(patch.object(operator.existing, "_verify_load_journal"))
        self.observe_native = self.enterContext(patch.object(operator, "_observe_native_image"))

    def event(self, name, value):
        self.events.append(name)
        return value

    @staticmethod
    def put(path, raw):
        path.write_bytes(raw)
        path.chmod(0o600)

    def freeze_admission(self):
        self.put(self.operation / "sdk-admission.json", inputs.canonical(self.admission))
        self.args.sdk_admission_sha256 = inputs.content_hash(self.admission)

    def stage(self, **options):
        self.assertEqual(self.fixture.stack, [self.fixture.original / "production-operation.lock", self.fixture.original])
        self.assertEqual(options["release"], self.release)
        return {"id": "8" * 64}

    def staged(self):
        operator.run(self.args)
        self.args.action = "promote"

    def seal_options(self, action):
        self.staged()
        self.args.action = action
        final = deepcopy(self.fixture.plan)
        final["operationId"] = "web-" + self.args.suffix + "-reapply"
        self.args.accepted_plan_sha256 = content_hash(final)
        controller = self.install.return_value.controller.return_value
        controller.plan.return_value = final
        return controller, final

    def test_full_admission_happens_before_native_and_preserves_inequality_and_parent_locks(self):
        result = operator.run(self.args)
        self.assertEqual(result["state"], "private-ready")
        self.assertEqual(self.events[:4], ["publication", "comparison", "qualification", "native"])
        self.assertFalse(self.comparison["allInputsEqual"])
        self.assertFalse(self.build_release.call_args.kwargs["backend_comparison"]["allInputsEqual"])
        self.assertEqual(self.install.call_args.kwargs["retained_sdk_bindings"], {})
        self.assertEqual(self.install.call_args.kwargs["expected_candidate_publication_sha256"], self.admission["publicationReceiptSha256"])
        self.assertEqual(self.fixture.stack, [])
        self.assertGreaterEqual(self.engine_check.call_count, 4)

    def test_wrong_source_input_custody_projection_chain_or_qualification_blocks_before_native(self):
        cases = (
            lambda: setattr(self.args, "revision", "f" * 40),
            lambda: self.put(self.operation / "backend-comparison.json", inputs.canonical({"fabricatedEquality": True})),
            lambda: self.put(self.bundle / "component-inputs.json", inputs.canonical({"other": True})),
            lambda: self.put(self.artifact / "projection.json", inputs.canonical({"other": True})),
        )
        original_args = deepcopy(self.args)
        paths = [self.operation / "backend-comparison.json", self.bundle / "component-inputs.json", self.artifact / "projection.json"]
        original = {path: path.read_bytes() for path in paths}
        for mutate in cases:
            self.args = deepcopy(original_args)
            for path, raw in original.items():
                self.put(path, raw)
            mutate()
            with self.subTest(mutate=mutate), self.assertRaises((ValueError, SwitchConflict)):
                operator.run(self.args)
            self.native_factory.assert_not_called()
            self.loader.assert_not_called()
        self.args = original_args
        for path, raw in original.items():
            self.put(path, raw)
        self.build_release.side_effect = ValueError("native qualification absent")
        with self.assertRaisesRegex(ValueError, "qualification absent"):
            operator.run(self.args)
        self.native_factory.assert_not_called()

    def test_unequal_comparison_cannot_be_replaced_by_rehashed_equal_flag(self):
        changed = self.comparison | {"allInputsEqual": True}
        self.put(self.operation / "backend-comparison.json", inputs.canonical(changed))
        self.admission["backendComparisonSha256"] = inputs.content_hash(changed)
        self.freeze_admission()
        with self.assertRaisesRegex(SwitchConflict, "Honest original/current"):
            operator.run(self.args)
        self.native_factory.assert_not_called()

    def test_wrong_accepted_chain_blocks_before_any_native_opcode(self):
        self.admission["installedChainSha256"] = "0" * 64
        self.freeze_admission()
        with self.assertRaisesRegex(SwitchConflict, "accepted chain/backend"):
            operator.run(self.args)
        self.native_factory.assert_not_called()

    def test_engine_changed_before_stage_or_during_release_callback_never_creates_candidate(self):
        self.engine_check.side_effect = ValueError("Engine changed")
        with self.assertRaisesRegex(ValueError, "Engine changed"):
            operator.run(self.args)
        self.loader.assert_not_called()
        self.install.assert_not_called()

    def disabled_newsletter(self):
        runtime = self.fixture.chain["active"]["slot"]["runtime"]
        return {"schemaVersion": 1, "kind": "warpdrive-disabled-newsletter-integration-witness",
            "web": {"id": runtime["runtimeId"], "name": "/" + runtime["name"], "imageId": runtime["imageId"],
                "pid": 701, "startedAt": "2026-11-14T10:00:00Z", "finishedAt": "0001-01-01T00:00:00Z",
                "restartCount": 0, "configSha256": "c" * 64, "project": "pitant-warpdrive", "service": "app"},
            "configuration": {"integrationConfigured": False, "deliveryEnabled": False, "publicSignupEnabled": False}}

    def freeze_newsletter(self, witness):
        self.engine = deepcopy(witness)
        self.put(self.operation / "engine-witness.json", inputs.canonical(witness))
        self.admission["engineWitnessSha256"] = inputs.content_hash(witness)
        self.freeze_admission()
        self.engine_check.return_value = witness

    def test_explicit_disabled_witness_binds_current_chain_before_release_and_stays_v1(self):
        witness = self.disabled_newsletter()
        self.freeze_newsletter(witness)
        result = operator.run(self.args)
        self.assertEqual(result["state"], "private-ready")
        self.assertEqual(self.events[:4], ["publication", "comparison", "qualification", "native"])
        self.assertEqual(self.build_release.call_args.kwargs["expected_engine_witness_sha256"],
                         inputs.content_hash(witness))
        self.assertTrue(all(call.args[1] == witness and call.kwargs == {
            "expected_sha256": inputs.content_hash(witness)} for call in self.engine_check.call_args_list))
        self.assertEqual(self.admission["schemaVersion"], 1)
        self.assertEqual(self.release["schemaVersion"], 1)
        self.assertNotIn("newsletterActivationSha256", self.release)
        self.assertNotIn("newsletter_activation", self.install.call_args.kwargs)
        self.assertEqual(self.install.call_args.kwargs["candidate_binding"]["profileId"], PROFILE_ID)

    def test_disabled_witness_wrong_accepted_web_id_image_or_name_blocks_before_comparison_or_native(self):
        mutations = (("id", "f" * 64), ("imageId", "sha256:" + "f" * 64), ("name", "/wrong-incumbent"))
        for key, value in mutations:
            witness = self.disabled_newsletter()
            witness["web"][key] = value
            self.freeze_newsletter(witness)
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "accepted incumbent Web"):
                operator.run(self.args)
            self.compare.assert_not_called()
            self.build_release.assert_not_called()
            self.native_factory.assert_not_called()
            self.docker.assert_not_called()
            self.loader.assert_not_called()

    def test_rehashed_disabled_configuration_or_process_shape_cannot_reach_release_builder(self):
        mutations = (
            lambda value: value.update(schemaVersion=True),
            lambda value: value["configuration"].update(deliveryEnabled=0),
            lambda value: value["configuration"].update(publicSignupEnabled=True),
            lambda value: value["web"].pop("finishedAt"),
            lambda value: value["web"].update(pid=True),
            lambda value: value.update(extra=True),
        )
        for mutate in mutations:
            witness = self.disabled_newsletter()
            mutate(witness)
            self.freeze_newsletter(witness)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                operator.run(self.args)
            self.compare.assert_not_called()
            self.build_release.assert_not_called()
            self.native_factory.assert_not_called()
            self.loader.assert_not_called()

    def test_changed_disabled_witness_bytes_hold_before_any_native_operation(self):
        self.freeze_newsletter(self.disabled_newsletter())
        changed = self.disabled_newsletter()
        changed["configuration"]["integrationConfigured"] = True
        self.put(self.operation / "engine-witness.json", inputs.canonical(changed))
        with self.assertRaises((ValueError, SwitchConflict)):
            operator.run(self.args)
        self.compare.assert_not_called()
        self.build_release.assert_not_called()
        self.native_factory.assert_not_called()
        self.loader.assert_not_called()

    def test_engine_guard_runs_on_controller_release_verification_and_after_action(self):
        self.staged()
        controller = self.install.return_value.controller.return_value
        def action(_name):
            verify = self.install.return_value.controller.call_args.kwargs["verify_release"]
            before = self.engine_check.call_count
            self.assertTrue(verify({}, initialize=False))
            self.assertGreater(self.engine_check.call_count, before)
            return {"state": "accepted"}
        controller.run.side_effect = action
        self.assertEqual(operator.run(self.args), {"state": "accepted"})
        controller.run.assert_called_once_with("promote")

    def test_native_load_view_keeps_original_release_and_all_three_image_identities_distinct(self):
        before = deepcopy(self.release)
        view = operator.native_load_view(self.release, self.projection)
        self.assertEqual(set(view), {"revision", "origin", "image", "provenance"})
        self.assertEqual(view["revision"], self.args.revision)
        self.assertNotIn("revision", self.release)
        self.assertEqual(len({self.full_candidate["components"]["web"]["imageId"],
                              view["image"]["imageId"], self.binding["imageId"]}), 3)
        generic_verify_stage_load(self.loaded, view, self.fixture.chain, self.fixture.identity, self.facts)
        view["image"]["imageId"] = self.binding["imageId"]
        self.assertEqual(self.release, before)
        with self.assertRaisesRegex(SwitchConflict, "load receipt differs"):
            generic_verify_stage_load(self.loaded, view, self.fixture.chain, self.fixture.identity, self.facts)

    def test_stage_load_uses_projection_not_original_archive_and_exact_active_baseline(self):
        operator.run(self.args)
        positional, options = self.loader.call_args
        self.assertEqual(positional, (self.projected,))
        self.assertEqual(options["image"], self.release["image"])
        self.assertEqual(options["baseline_revision"], self.fixture.chain["active"]["provenance"]["revision"])
        self.assertEqual(options["baseline_manifest_sha256"], self.fixture.chain["active"]["provenance"]["manifestSha256"])
        self.assertFalse(options["reconcile"])
        self.assertEqual(self.verify_load.call_args.args[1], operator.native_load_view(self.release, self.projection))

    def test_unknown_load_ack_has_no_automatic_second_load_or_private_start(self):
        self.loader.side_effect = WebImageUnknown("lost acknowledgement")
        with self.assertRaises(WebImageUnknown):
            operator.run(self.args)
        self.assertEqual(self.loader.call_count, 1)
        self.install.return_value.stage.assert_not_called()
        self.assertFalse((self.operation / "loaded-image.json").exists())

    def test_explicit_stage_reentry_uses_existing_generic_journal_reconciliation(self):
        image_state = self.operation / "image-load"
        image_state.mkdir(mode=0o700)
        self.put(image_state / operator.JOURNAL, b"fixture exact lost-ACK load journal")
        operator.run(self.args)
        self.assertTrue(self.loader.call_args.kwargs["reconcile"])
        self.assertEqual(self.loader.call_count, 1)

    def test_original_zip_or_archive_replacement_during_release_checks_holds(self):
        self.staged()
        path = self.artifact / "bundle.zip"
        def substitute(*_a):
            replacement = self.artifact / "replacement.zip"
            self.put(replacement, path.read_bytes())
            replacement.replace(path)
        self.observe_native.side_effect = substitute
        with self.assertRaisesRegex(SwitchConflict, "Original SDK custody"):
            operator.run(self.args)
        self.install.return_value.controller.assert_not_called()

    def test_unicode_new_evidence_pins_use_component_input_canonicalization(self):
        self.assertNotEqual(inputs.content_hash(self.contract), content_hash(self.contract))
        _, records, _, _ = operator._materials(self.args, self.operation, self.artifact)
        self.assertEqual(records["contract-review.json"], self.contract)
        operator.run(self.args)
        self.assertEqual(self.build_release.call_args.kwargs["expected_contract_review_sha256"], inputs.content_hash(self.contract))
        self.assertEqual(self.build_release.call_args.kwargs["expected_revision"], self.args.revision)

    def test_explicit_recovery_and_failed_stamp_actions_delegate_without_new_state_schema(self):
        self.staged()
        controller = self.install.return_value.controller.return_value
        for action in ("recover", "recover-reapply", "reconcile-failed-stamps", "rollback", "reapply"):
            self.args.action = action
            controller.run.reset_mock()
            controller.run.return_value = {"state": "accepted", "action": action}
            self.assertEqual(operator.run(self.args)["action"], action)
            controller.run.assert_called_once_with(action)

    def test_unknown_rollout_ack_propagates_without_retry(self):
        self.staged()
        controller = self.install.return_value.controller.return_value
        controller.run.side_effect = SwitchUnknown("route acknowledgement lost")
        with self.assertRaises(SwitchUnknown):
            operator.run(self.args)
        self.assertEqual(controller.run.call_count, 1)

    def test_observe_is_bracketed_by_engine_checks_without_rollout(self):
        self.staged()
        self.args.action = "observe"
        with patch.object(operator.existing, "_observe", return_value={"state": "observed"}) as observe:
            self.assertEqual(operator.run(self.args), {"state": "observed"})
        observe.assert_called_once()
        self.install.return_value.controller.return_value.run.assert_not_called()

    def test_seal_writes_only_then_requires_separate_independent_index_readback(self):
        controller, final = self.seal_options("seal")
        index = {"kind": operator.SDK_LINEAGE_KIND, "chainSha256": "4" * 64}
        with patch.object(operator, "sdk_installed_observer", return_value=lambda: {}), \
                patch.object(operator, "_verify_accepted_rollout"), \
                patch.object(operator, "seal_sdk_installed_web_lineage", return_value=index) as seal, \
                patch.object(operator, "read_sdk_seal_acknowledgement") as readback:
            result = operator.run(self.args)
        self.assertEqual(result["state"], "lineage-written-not-readback")
        self.assertTrue(result["readbackRequired"])
        self.assertNotIn("sealedIndexSha256", result)
        self.assertFalse((self.operation / "sdk-seal-readback.json").exists())
        readback.assert_not_called()
        self.assertEqual(seal.call_args.kwargs["expected_plan_sha256"], content_hash(final))

    def test_readback_needs_external_index_pin_then_persists_exact_immutable_receipt(self):
        _, final = self.seal_options("seal-readback")
        with self.assertRaisesRegex(SwitchConflict, "Independent raw SDK index"):
            operator.run(self.args)
        self.args.sealed_index_sha256 = "a" * 64
        index = {"kind": operator.SDK_LINEAGE_KIND, "chainSha256": "4" * 64}
        result = {"state": "sealed", "sourceRevision": self.args.revision, "lineage": index}
        with patch.object(operator, "sdk_installed_observer", return_value=lambda: {}), \
                patch.object(operator, "read_sdk_seal_acknowledgement", return_value=result) as readback:
            self.assertEqual(operator.run(self.args), result)
        self.assertEqual(readback.call_args.kwargs["expected_index_sha256"], self.args.sealed_index_sha256)
        path = self.operation / "sdk-seal-readback.json"
        self.assertEqual(path.stat().st_mode & 0o777, 0o400)
        record = operator.decode(path.read_bytes())
        self.assertEqual(record["chainSha256"], index["chainSha256"])
        self.assertEqual(record["sourceRevision"], self.args.revision)
        self.assertEqual(record["acceptedPlanSha256"], content_hash(final))
        self.assertEqual(record["result"], result)

    def test_missing_or_unmatched_sdk_predecessor_readback_blocks_history_admission(self):
        index = {"kind": operator.SDK_LINEAGE_KIND}
        with patch.object(operator, "_sealed", return_value=canonical(index)):
            with self.assertRaises(OSError):
                operator._prior_readback(self.fixture.previous, self.fixture.chain, self.fixture.plan, "a" * 64)

    def test_sdk_predecessor_exact_readback_binds_index_plan_chain_and_source(self):
        index = {"kind": operator.SDK_LINEAGE_KIND, "chainSha256": content_hash(self.fixture.chain)}
        index_pin = "a" * 64
        record = {"schemaVersion": 1, "kind": operator.READBACK_KIND, "sealedIndexSha256": index_pin,
            "acceptedPlanSha256": content_hash(self.fixture.plan), "chainSha256": content_hash(self.fixture.chain),
            "sourceRevision": self.fixture.chain["active"]["slot"]["runtime"]["sourceRevision"],
            "result": {"state": "sealed", "sourceRevision": self.fixture.chain["active"]["slot"]["runtime"]["sourceRevision"],
                       "lineage": index}}
        path = self.fixture.previous / "sdk-seal-readback.json"
        self.put(path, canonical(record))
        path.chmod(0o400)
        with patch.object(operator, "_sealed", return_value=canonical(index)):
            operator._prior_readback(self.fixture.previous, self.fixture.chain, self.fixture.plan, index_pin)
            path.chmod(0o600)
            self.put(path, canonical(record | {"sourceRevision": "0" * 40}))
            path.chmod(0o400)
            with self.assertRaisesRegex(SwitchConflict, "completed independently pinned"):
                operator._prior_readback(self.fixture.previous, self.fixture.chain, self.fixture.plan, index_pin)

    def test_sdk_history_current_pair_bindings_are_forwarded_to_sdk_successor(self):
        registry = {"a" * 64: ({"fixtureAlreadyAdmittedBinding": True}, "b" * 64)}
        with patch.object(operator, "read_installed_web_history",
                return_value=(self.fixture.chain, self.fixture.plan, registry)) as history, \
                patch.object(operator, "_prior_readback") as prior:
            operator.run(self.args)
        self.assertTrue(prior.called)
        self.assertEqual(self.install.call_args.kwargs["retained_sdk_bindings"], registry)
        self.assertEqual(history.call_args.kwargs["expected_chain_sha256"], self.args.lineage_sha256)
        self.assertEqual(history.call_args.kwargs["expected_index_sha256"], self.args.lineage_index_sha256)

    def test_already_completed_core_projection_preserves_independent_pins_and_historical_bytes(self):
        # The generic legacy fixture uses web-1/web-2 process names unrelated
        # to its private aliases. Give this SDK-bound historical pair real
        # alias/name parity before the unchanged Core projector sees it.
        fixture = self.fixture
        old_plan = deepcopy(fixture.plan)
        old_pointer = _record(old_plan, old_plan["after"])
        for name, side in (("active", "after"), ("previous", "before")):
            item = fixture.chain[name]
            fixture.plan[side]["runtime"]["name"] = item["alias"]
            item["receiptSha256"] = fixture.seal(fixture.lineage / (name + ".json"),
                _generation(fixture.plan, side, item["alias"], item["provenance"]), newline=True)
            self.assertEqual(item["slot"]["runtime"]["sourceRevision"], item["provenance"]["revision"])
            self.assertEqual(item["slot"]["runtime"]["name"], item["alias"])
        fixture.chain["acceptedPlanSha256"] = content_hash(fixture.plan)
        fixture.seal(fixture.lineage / "accepted-plan.json", fixture.plan)
        fixture.args.lineage_sha256 = fixture.seal(fixture.lineage / "chain.json", fixture.chain)
        index = operator.decode((fixture.lineage / "lineage.json").read_bytes())
        index.update(acceptedPlanSha256=content_hash(fixture.plan), chainSha256=fixture.args.lineage_sha256,
                     activeSha256=fixture.chain["active"]["receiptSha256"],
                     previousSha256=fixture.chain["previous"]["receiptSha256"])
        fixture.args.lineage_index_sha256 = fixture.seal(fixture.lineage / "lineage.json", index, newline=True)
        _write_state(fixture.state / "web-rollouts" / (fixture.plan["operationId"] + ".json"),
                     {"plan": fixture.plan, "state": "accepted"}, previous={"plan": old_plan, "state": "accepted"})
        _write_state(fixture.pointer_path, _record(fixture.plan, fixture.plan["after"]), previous=old_pointer)
        self.args.lineage_sha256 = fixture.args.lineage_sha256
        self.args.lineage_index_sha256 = fixture.args.lineage_index_sha256
        projection = self.fixture.project()
        for name in ("active", "previous"):
            self.assertEqual(projection.chain[name]["slot"]["runtime"], fixture.chain[name]["slot"]["runtime"])
        core_path = self.operation / "retained-core.json"
        self.put(core_path, self.fixture.args.retained_core.read_bytes())
        self.args.retained_core = core_path
        self.args.retained_core_sha256 = self.fixture.args.retained_core_sha256
        self.args.core_activation_operation = self.fixture.args.core_activation_operation
        self.args.core_activation_lineage_sha256 = self.fixture.args.core_activation_lineage_sha256
        self.args.projected_lineage_sha256 = self.fixture.args.projected_lineage_sha256
        self.admission["installedChainSha256"] = self.args.projected_lineage_sha256
        self.admission["backendFingerprint"] = projection.chain["backendFingerprint"]
        self.freeze_admission()
        self.install.return_value.backend.return_value = {"backendFingerprint": projection.chain["backendFingerprint"]}
        operator.read_autosave.return_value = self.fixture.preimage
        old = {path: path.read_bytes() for path in self.fixture.lineage.iterdir()}
        result = operator.run(self.args)
        self.assertEqual(result["backendFingerprint"], projection.chain["backendFingerprint"])
        self.assertEqual(self.install.call_args.kwargs["chain"], projection.chain)
        self.assertEqual(self.install.call_args.kwargs["core_activation_operation_id"], self.args.core_activation_operation)
        self.assertEqual(self.build_release.call_args.kwargs["expected_chain_sha256"], self.args.projected_lineage_sha256)
        self.assertEqual({path: path.read_bytes() for path in old}, old)

    def test_wrong_core_authority_path_holds_before_native(self):
        self.args.retained_core = self.operation / "different-core.json"
        self.args.retained_core_sha256 = "a" * 64
        with self.assertRaisesRegex(SwitchConflict, "paired retained Core"):
            operator.run(self.args)
        self.native_factory.assert_not_called()

    def test_actual_cli_rejects_arbitrary_command_and_profile_arguments(self):
        with patch("sys.stderr", new_callable=io.StringIO), patch.object(operator.os, "umask"):
            with self.assertRaises(SystemExit):
                operator.main(["stage", "--command", "sh", "--profile", "arbitrary"])


if __name__ == "__main__":
    unittest.main()
