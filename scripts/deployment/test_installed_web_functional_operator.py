"""Exercise the functional operator's protected dispatch without Docker or production paths."""

from contextlib import contextmanager
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import installed_web_functional_operator as operator
from installed_core_lineage import project_initial_core_lineage
from installed_core_lineage_seal import initial_core_lineage_acceptance
from installed_web_chain import REPOSITORY
from test_web_rollout import slot
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, canonical, content_hash


class FunctionalOperatorTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.operation, self.first, self.original, self.previous = (
            root / name for name in ("functional-web-release-dddddddddddd", "first", "original", "previous")
        )
        self.state, self.lineage = self.first / "rollout", self.previous / "lineage"
        self.artifact, self.bundle = self.operation / "artifact", self.operation / "artifact/bundle"
        for path in (self.operation, self.first, self.original, self.previous, self.state, self.state / "web-rollouts",
                     self.lineage, self.artifact, self.bundle):
            path.mkdir(mode=0o700)
        self.args = SimpleNamespace(action="stage", suffix="d" * 12, revision="d" * 40, operation=self.operation,
            first=self.first, original=self.original, previous=self.previous, retained_core=None, retained_core_sha256=None,
            core_activation_operation=None, core_activation_lineage_sha256=None, projected_lineage_sha256=None,
            first_accepted_operation="web-aaaaaaaaaaaa-reapply", accepted_plan_sha256=None)
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "targetKey": "pitant-warpdrive",
                     "operationId": "web-cccccccccccc-reapply", "before": slot("1", "b", "b"), "after": slot("2", "c", "c"),
                     "backendFingerprint": "d" * 64, "qualificationSha256": "e" * 64}
        self.preimage = {"generation": self.plan["after"]["route"]["generation"]}
        self.plan["after"]["route"]["fingerprint"] = content_hash(self.preimage)
        plan_sha = self.seal(self.lineage / "accepted-plan.json", self.plan)
        self.chain = {"targetKey": self.plan["targetKey"], "backendFingerprint": self.plan["backendFingerprint"],
                      "acceptedOperationId": self.plan["operationId"], "acceptedPlanSha256": plan_sha}
        for name, side, digest in (("active", "after", "a"), ("previous", "before", "b")):
            runtime = self.plan[side]["runtime"]
            alias = "warpdrive-web-" + digest * 12
            provenance = {"repository": REPOSITORY, "revision": runtime["sourceRevision"],
                          "manifestSha256": digest * 64, "archiveSha256": digest * 64,
                          "testedConfigDigest": "sha256:" + digest * 64, "authoritySha256": digest * 64}
            raw = {"schemaVersion": 1, "kind": "warpdrive-installed-web-generation", "targetKey": self.plan["targetKey"],
                   "backendFingerprint": self.plan["backendFingerprint"], "runtime": runtime, "alias": alias, "provenance": provenance}
            self.chain[name] = {"slot": self.plan[side], "alias": alias, "provenance": provenance,
                                "receiptSha256": self.seal(self.lineage / f"{name}.json", raw, newline=True)}
        self.args.lineage_sha256 = self.seal(self.lineage / "chain.json", self.chain)
        index = {"schemaVersion": 1, "kind": "warpdrive-functional-installed-web-lineage", "targetKey": self.plan["targetKey"],
                 "acceptedOperationId": self.plan["operationId"], "acceptedPlanSha256": plan_sha,
                 "predecessorChainSha256": "e" * 64, "backendFingerprint": self.plan["backendFingerprint"],
                 "liveConfigSha256": self.plan["after"]["route"]["fingerprint"], "chainSha256": self.args.lineage_sha256,
                 "activeSha256": self.chain["active"]["receiptSha256"], "previousSha256": self.chain["previous"]["receiptSha256"]}
        self.args.lineage_index_sha256 = self.seal(self.lineage / "lineage.json", index, newline=True)
        self.identity = {"serverId": "owned", "socketDevice": 7, "socketInode": 9}
        self.binding = {"daemon": self.identity}
        initial = {**self.plan, "operationId": self.args.first_accepted_operation, "qualificationSha256": content_hash(self.binding)}
        self.args.first_accepted_plan_sha256 = content_hash(initial)
        self.write(self.first / "bound-release.json", self.binding)
        for journal in (initial, self.plan):
            _write_state(self.state / "web-rollouts" / (journal["operationId"] + ".json"), {"plan": journal, "state": "accepted"})
        self.pointer_path = self.state / "accepted-web-generation.json"
        _write_state(self.pointer_path, _record(self.plan, self.plan["after"]))
        self.args.publication_sha256 = self.seal(self.artifact / "publication-receipt.json", {"publication": True})
        self.args.import_sha256 = self.seal(self.artifact / "import-receipt.json", {"import": True})
        self.archive = self.bundle / operator.ARCHIVE
        self.archive.write_bytes(b"fixture")
        self.archive.chmod(0o600)
        self.enterContext(patch.object(operator, "PRIVATE", root))
        self.enterContext(patch.object(operator, "_INSTALLATION_UID", os.geteuid()))
        self.enterContext(patch("installed_web_stage_ack.PRIVATE", root))
        self.enterContext(patch.object(operator, "read_record", side_effect=lambda path: operator.decode(path.read_bytes())))
        self.enterContext(patch.object(operator, "write_record", side_effect=self.write))
        self.enterContext(patch.object(operator, "read_autosave", side_effect=lambda _: self.preimage))
        self.enterContext(patch.object(operator, "_existing_lock", side_effect=self.lock))
        self.native = self.enterContext(patch.object(operator, "LocalDocker")).return_value
        self.native.identity.return_value = self.identity
        self.docker = self.enterContext(patch.object(operator, "InstalledDocker"))
        self.release = {"provenance": {}, "image": {}}
        self.verify_release = self.enterContext(patch.object(operator, "verify_received_functional", return_value=self.release))
        self.load = self.enterContext(patch.object(operator, "load_installed_functional_image", return_value={"loaded": True}))
        self.install = self.enterContext(patch.object(operator, "InstalledWebSuccessor"))
        self.install.return_value.stage.return_value = {"id": "1" * 64}
        self.install.return_value.stage.side_effect = self.stage
        self.stack = []

    @staticmethod
    def write(path, value):
        path.write_bytes(canonical(value))
        path.chmod(0o600)

    @staticmethod
    def seal(path, value, *, newline=False):
        raw = canonical(value) + (b"\n" if newline else b"")
        path.write_bytes(raw)
        path.chmod(0o600)
        return sha256(raw).hexdigest()

    @contextmanager
    def lock(self, path, modes, *, directory=False):
        self.assertNotIn(path, self.stack)
        self.stack.append(path)
        try:
            yield
        finally:
            self.assertEqual(self.stack.pop(), path)

    def stage(self, **options):
        self.assertNotIn(self.state / "target.lock", self.stack)
        self.assertEqual(self.stack, [self.original / "production-operation.lock", self.original])
        self.assertEqual(options["release"], self.release)
        return {"id": "1" * 64}

    def project(self):
        self.preimage = {**self.preimage, "core": True}
        profile = {"independentCoreAuthority": True}
        self.args.retained_core = self.operation / "retained-core.json"
        self.args.retained_core_sha256 = self.seal(self.args.retained_core, profile)
        activation = {"schemaVersion": 1, "kind": "warpdrive-installed-core-activation", "targetKey": self.plan["targetKey"],
                      "acceptedChainSha256": self.args.lineage_sha256, "coreAuthoritySha256": self.args.retained_core_sha256,
                      "oldBackendFingerprint": self.chain["backendFingerprint"], "newBackendFingerprint": "9" * 64,
                      "oldRouteSha256": self.chain["active"]["slot"]["route"]["fingerprint"],
                      "newRouteSha256": content_hash(self.preimage)}
        activation_sha = content_hash(activation)
        identifier = "core-activation-" + activation_sha[:40]
        self.args.core_activation_operation = identifier
        projection = project_initial_core_lineage(accepted_plan=self.plan, expected_plan_sha256=content_hash(self.plan),
            accepted_chain=self.chain, expected_chain_sha256=self.args.lineage_sha256, activation_binding=activation,
            activation_record={**activation, "state": "route-verified-lineage-pending"}, expected_activation_operation_id=identifier,
            expected_activation_plan_sha256=activation_sha, expected_core_authority_sha256=self.args.retained_core_sha256,
            expected_core_backend_fingerprint=activation["newBackendFingerprint"])
        self.args.projected_lineage_sha256 = content_hash(projection.chain)
        seal = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-projection", "activationOperationId": identifier,
                "activationPlanSha256": activation_sha, "coreAuthoritySha256": self.args.retained_core_sha256,
                "originalChainSha256": self.args.lineage_sha256, "projectedChainSha256": self.args.projected_lineage_sha256,
                "projectedChain": projection.chain, "projectedPointer": projection.accepted_pointer}
        accepted = initial_core_lineage_acceptance(seal, activation)
        self.args.core_activation_lineage_sha256 = content_hash(accepted)
        _write_state(self.state / (identifier + "-lineage-projection.json"), seal)
        _write_state(self.state / (identifier + "-lineage-accepted.json"), accepted)
        _write_state(self.pointer_path, projection.accepted_pointer, previous=_record(self.plan, self.plan["after"]))
        return projection

    def test_legacy_stage_reuses_exact_chain_and_releases_target_before_private_start(self):
        result = operator.run(self.args)
        self.assertEqual(result["state"], "private-ready")
        self.assertEqual(self.install.call_args.kwargs["chain"], self.chain)
        self.assertIsNone(self.install.call_args.kwargs["retained_core"])
        self.assertEqual(self.load.call_args.kwargs["expected_lineage_sha256"], self.args.lineage_sha256)
        self.assertFalse(self.load.call_args.kwargs["reconcile"])
        self.assertEqual(self.stack, [])

    def test_repeat_lineage_index_keeps_separate_chain_and_artifact_pins(self):
        path = self.lineage / "lineage.json"
        index = operator.decode(path.read_bytes())
        index["kind"] = "warpdrive-repeat-installed-web-lineage"
        index.pop("chainSha256")
        index_pin = self.seal(path, index, newline=True)
        self.assertEqual(operator._historical(self.lineage, self.args.lineage_sha256, index_pin), (self.chain, self.plan))
        index["chainSha256"] = self.args.lineage_sha256
        wrong_schema = self.seal(path, index, newline=True)
        with self.assertRaisesRegex(SwitchConflict, "predecessor and index required"):
            operator._historical(self.lineage, self.args.lineage_sha256, wrong_schema)

    def test_first_post_core_stage_adopts_only_sealed_projection_and_retains_historical_files(self):
        projected = self.project()
        old = {path.name: path.read_bytes() for path in self.lineage.iterdir()}
        result = operator.run(self.args)
        self.assertEqual(result["backendFingerprint"], projected.chain["backendFingerprint"])
        self.assertEqual(self.install.call_args.kwargs["chain"], projected.chain)
        self.assertEqual(self.install.call_args.kwargs["expected_core_activation_lineage_sha256"], self.args.core_activation_lineage_sha256)
        self.assertEqual(self.load.call_args.kwargs["expected_lineage_sha256"], self.args.projected_lineage_sha256)
        self.assertEqual(operator.decode((self.operation / "installed-chain.json").read_bytes()), projected.chain)
        self.assertEqual({path.name: path.read_bytes() for path in self.lineage.iterdir()}, old)

    def test_wrong_core_profile_or_pointer_blocks_before_docker_or_receipt(self):
        projected = self.project()
        original_pin = self.args.retained_core_sha256
        self.args.retained_core_sha256 = self.seal(self.args.retained_core, {"other": True})
        with self.assertRaisesRegex(SwitchConflict, "Core activation differs"):
            operator.run(self.args)
        self.args.retained_core_sha256 = self.seal(self.args.retained_core, {"independentCoreAuthority": True})
        self.assertEqual(self.args.retained_core_sha256, original_pin)
        _write_state(self.pointer_path, _record(self.plan, self.plan["after"]), previous=projected.accepted_pointer)
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            operator.run(self.args)
        self.docker.assert_not_called()
        self.load.assert_not_called()
        self.assertFalse((self.operation / "installed-chain.json").exists())

    def test_wrong_historical_generation_bytes_block_before_projection_or_docker(self):
        self.project()
        with (self.lineage / "active.json").open("ab") as output:
            output.write(b" ")
        with self.assertRaises(SwitchConflict):
            operator.run(self.args)
        self.docker.assert_not_called()
        self.load.assert_not_called()

    def test_seal_uses_controller_reapply_pin_and_exact_projected_lineage(self):
        projected = self.project()
        operator.run(self.args)
        self.args.action = "seal"
        controller = self.install.return_value.controller.return_value
        final = deepcopy(self.plan)
        final["operationId"] = "web-dddddddddddd-reapply"
        self.args.accepted_plan_sha256 = content_hash(final)
        controller.plan.return_value = final

        observed = []

        def archive_facts(source, *_):
            observed.append(source)
            return {"descriptor": {"digest": "fixture"}}

        def check_held(**_):
            self.assertFalse(observed[0].closed)

        with (patch.object(operator, "_archive_facts", side_effect=archive_facts), patch.object(operator, "_verify_stage_load"),
              patch.object(operator, "_verify_load_journal"), patch.object(operator, "_observe_native_image"),
              patch.object(operator, "_verify_accepted_rollout") as accepted,
              patch.object(operator, "functional_installed_observer"),
              patch.object(operator, "seal_functional_installed_web_lineage", side_effect=lambda *_, **kwargs: check_held(**kwargs)) as seal,
              patch.object(operator, "read_seal_acknowledgement", return_value={"state": "sealed"}) as acknowledge):
            self.assertEqual(operator.run(self.args), {"state": "sealed"})
        self.assertTrue(observed[0].closed)
        controller.plan.assert_called_once_with("reapply")
        accepted.assert_called_once()
        self.assertEqual(seal.call_args.kwargs["admitted_chain"], projected.chain)
        self.assertEqual(seal.call_args.kwargs["core_activation_operation_id"], self.args.core_activation_operation)
        acknowledge.assert_called_once()

    def test_archive_substitution_during_native_authority_check_holds_before_rollout(self):
        operator.run(self.args)
        self.args.action = "promote"

        def substitute(*_):
            replacement = self.bundle / "replacement.tar"
            replacement.write_bytes(self.archive.read_bytes())
            replacement.chmod(0o600)
            replacement.replace(self.archive)

        with (patch.object(operator, "_archive_facts", return_value={}), patch.object(operator, "_verify_stage_load"),
              patch.object(operator, "_verify_load_journal"), patch.object(operator, "_observe_native_image", side_effect=substitute)):
            with self.assertRaisesRegex(SwitchConflict, "changed during operation"):
                operator.run(self.args)
        self.install.return_value.controller.assert_not_called()

    def test_observe_reports_only_its_exact_route_reconciliation_journal(self):
        install = self.install.return_value
        install.state = self.state
        install.admin.config.return_value = self.preimage, '"etag"'
        install.web.return_value = SimpleNamespace(status=200,
            body=canonical({"sourceRevision": self.plan["after"]["runtime"]["sourceRevision"]}))
        install.backend.return_value = {"backendFingerprint": self.plan["backendFingerprint"]}
        controller = install.controller.return_value
        plans = {phase: {**self.plan, "operationId": "web-dddddddddddd-" + phase}
                 for phase in ("promote", "rollback", "reapply")}
        controller.plan.side_effect = plans.__getitem__
        final = plans["reapply"]
        recovery_id = final["operationId"] + "-route"
        pending = self.state / "web-rollouts" / (recovery_id + ".json")
        binding = {"schemaVersion": 1, "kind": "warpdrive-installed-web-route-reconciliation", "operationId": recovery_id,
                   "sourcePlanSha256": content_hash(final), "before": _record(final, final["before"]),
                   "after": _record(final, plans["promote"]["before"]), "state": "switch-intent"}
        _write_state(pending, binding)
        self.assertEqual(operator._observe(install, controller)["journals"], {recovery_id: "switch-intent"})
        _write_state(pending, {**binding, "sourcePlanSha256": "0" * 64}, previous=binding)
        with self.assertRaisesRegex(SwitchConflict, "route-only reconciliation journal differs"):
            operator._observe(install, controller)


if __name__ == "__main__":
    unittest.main()
