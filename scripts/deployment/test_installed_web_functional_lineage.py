"""Verify functional lineage across initial Core activation and later Web rolls."""

from hashlib import sha256
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from installed_core_activation import reconcile_initial_core_route
from installed_core_lineage_seal import accept_initial_core_lineage, initial_core_lineage_acceptance, seal_initial_core_lineage
from installed_web_chain import REPOSITORY, _state, admit_installed_web_chain
from installed_web_functional_image import CATEGORIES, INPUTS, JOB, MANIFEST, REPORT, WORKFLOW, import_receipt
from installed_web_functional_lineage import functional_installed_observer, seal_functional_installed_web_lineage
from installed_web_lineage import _generation
from installed_web_repeat import InstalledWebRepeat
from installed_web_stage import write_record
from test_caddy_web_repeat import B, C, D, HOST, PEER, RELAY, compile_next, installed_after_first_switch
from test_installed_web_target import Admin
from test_web_rollout import slot
from test_web_switch import FakeClock
from web_candidate import ARCHIVE, _record as file_record
from web_generation_routes import WebGeneration
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, canonical, content_hash


E = WebGeneration("wd-" + "e" * 40, "warpdrive-web-" + "e" * 12)


class FunctionalLineageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.original, self.state, self.prior = (self.directory(name) for name in ("original", "state", "prior"))
        (self.original / "production-operation.lock").touch(mode=0o600)
        self.operations = self.state / "web-rollouts"
        self.operations.mkdir(mode=0o700)
        self.pointer = self.state / "accepted-web-generation.json"
        documents = compile_next(installed_after_first_switch())
        self.admin = Admin(documents["after"])
        self.clock = FakeClock()
        before, after = self.runtime_slot(B, "1"), self.runtime_slot(C, "2")
        before["route"]["fingerprint"] = content_hash(documents["manualRollback"])
        after["route"]["fingerprint"] = content_hash(self.admin.live)
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "targetKey": "installed",
                     "operationId": "web-cccccccccccc-reapply", "backendFingerprint": "a" * 64,
                     "qualificationSha256": "b" * 64, "before": before, "after": after}
        _write_state(self.pointer, _record(self.plan, after))
        self.original_journal = self.operations / (self.plan["operationId"] + ".json")
        _write_state(self.original_journal, {"plan": self.plan, "state": "accepted"})
        self.seal_receipt("previous", "before", B, "7")
        self.seal_receipt("active", "after", C, "8")
        self.chain = self.admit(self.plan, self.prior)
        self.activation = {}
        self.core_alias = None
        self.core_authority = None

    def directory(self, name):
        directory = self.root / name
        directory.mkdir(mode=0o700)
        return directory

    @staticmethod
    def runtime_slot(generation, digit):
        value = slot(digit, digit, generation.deployment_id[-1])
        value["runtime"]["name"] = generation.target
        return value

    def seal_receipt(self, name, side, generation, digit):
        provenance = {"repository": REPOSITORY, "revision": generation.deployment_id[3:], "manifestSha256": digit * 64,
                      "archiveSha256": digit * 64, "authoritySha256": digit * 64, "testedConfigDigest": "sha256:" + digit * 64}
        path = self.prior / (name + ".json")
        path.write_bytes(canonical(_generation(self.plan, side, generation.target, provenance)) + b"\n")
        path.chmod(0o400)

    def admit(self, plan, directory):
        active, previous = (directory / (name + ".json") for name in ("active", "previous"))
        return admit_installed_web_chain(self.state, plan=plan, active=active, previous=previous,
            expected_active_sha256=sha256(active.read_bytes()).hexdigest(), expected_previous_sha256=sha256(previous.read_bytes()).hexdigest())

    def activate_core(self):
        self.core_alias = "warpdrive-core-fixture"
        backend, self.core_authority = "e" * 64, "f" * 64
        chain_pin = content_hash(self.chain)
        callbacks = {"admin": self.admin, "read_durable_config": lambda: self.admin.persisted,
                     "verify_authority": lambda _: True, "observe_core": lambda: backend, "observe_public": lambda *_: True}
        route = reconcile_initial_core_route(self.original, self.state, predecessor=self.plan, chain=self.chain,
            expected_chain_sha256=chain_pin, installed_bytes=canonical(self.admin.live), core_backend_fingerprint=backend,
            core_authority_sha256=self.core_authority, host=HOST, traefik_ip=PEER, relay_alias=RELAY, core_alias=self.core_alias,
            clock=self.clock.monotonic, sleep=self.clock.sleep, **callbacks)
        operation = route["operationId"]
        binding = _state(self.operations / (operation + ".json"))
        binding.pop("state")
        seal = seal_initial_core_lineage(self.original, self.state, accepted_plan=self.plan, expected_plan_sha256=content_hash(self.plan),
            accepted_chain=self.chain, expected_chain_sha256=chain_pin, activation_binding=binding, expected_activation_operation_id=operation,
            expected_activation_plan_sha256=route["planSha256"], expected_core_authority_sha256=self.core_authority,
            expected_core_backend_fingerprint=backend, **callbacks)
        acceptance = initial_core_lineage_acceptance(seal, binding)
        accept_initial_core_lineage(self.original, self.state, activation_operation_id=operation,
            expected_projection_seal_sha256=content_hash(seal), expected_activation_lineage_sha256=content_hash(acceptance),
            binding=binding, **callbacks)
        self.chain = seal["projectedChain"]
        self.activation = {"core_activation_operation_id": operation, "core_activation_lineage_sha256": content_hash(acceptance)}

    def candidate(self, generation, digit):
        revision = generation.deployment_id[3:]
        self.output, self.bundle = (self.directory(revision[:12] + "-" + name) for name in ("lineage", "bundle"))
        self.candidate_alias = generation.target
        current = self.chain["active"]["provenance"]
        lineage = content_hash(self.chain)
        origin = {"kind": "github-actions", "repository": REPOSITORY, "ref": "refs/heads/main", "event": "workflow_dispatch",
                  "runId": 3, "runAttempt": 1}
        build = {"kind": "warpdrive-functional-web-build-inputs", "revision": revision, "activeWebRevision": current["revision"],
                 "originalBackendRevision": "0" * 40}
        baseline = {"compositeSha256": "3" * 64, "installedLineageSha256": lineage, "inputSha256": content_hash(build),
                    "activeWebRevision": current["revision"], "originalBackendRevision": "0" * 40}
        image = {"imageId": "sha256:" + ("9" if digit == "3" else "6") * 64, "sourceRevision": revision,
                 "generation": generation.deployment_id, "runtimeUser": "bun"}
        bodies = {INPUTS: canonical(build), REPORT: ("report " + revision).encode(), ARCHIVE: ("archive " + revision).encode()}
        files = {name: file_record(raw) for name, raw in bodies.items()}
        manifest = {"schemaVersion": 1, "kind": "warpdrive-tested-functional-web-bundle", "revision": revision, "platform": "linux/amd64",
                    "origin": origin, "baseline": baseline, "imageId": image["imageId"], "files": files, "deploymentAuthorized": False}
        manifest_raw = canonical(manifest)
        for name, raw in (bodies | {MANIFEST: manifest_raw}).items():
            path = self.bundle / name
            path.write_bytes(raw)
            path.chmod(0o600)
        provenance = {"bundleManifestSha256": sha256(manifest_raw).hexdigest(), "archiveSha256": files[ARCHIVE]["sha256"],
                      "archiveSizeBytes": files[ARCHIVE]["sizeBytes"]}
        self.release = {"schemaVersion": 1, "kind": "warpdrive-web-functional-publication-admission", "repository": REPOSITORY,
                        "revision": revision, "workflow": WORKFLOW, "origin": origin, "jobId": 2,
                        "artifact": {"id": 2, "name": f"web-functional-image-bundle-{revision}-3-1", "digest": "sha256:" + "4" * 64,
                                     "sizeBytes": 900},
                        "ci": [{"workflow": WORKFLOW, "run_id": 3, "attempt": 1, "jobs": [JOB]}] + [{}] * 6,
                        "security": {"tool": "CodeQL", "ref": origin["ref"], "revision": revision, "categories": CATEGORIES,
                                     "main_bound_before_and_after": True, "blocking_alerts": 0},
                        "baseline": baseline, "image": image, "provenance": provenance, "deploymentAuthorized": False,
                        "qualification": {"fixtureQualificationSha256": "1" * 64, "fixtureBackendFingerprint": "2" * 64,
                                          "fixtureSchemaSha256": "3" * 64, "reportSha256": files[REPORT]["sha256"]}}
        self.publication = canonical(self.release)
        self.publication_pin = sha256(self.publication).hexdigest()
        self.imported = import_receipt(self.release, manifest_raw, files, self.publication_pin)
        candidate = self.runtime_slot(generation, digit)["runtime"]
        self.loaded = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                       "deploymentAuthorized": False, "sourceRevision": revision, "origin": origin,
                       "baselineRevision": current["revision"], "baselineManifestSha256": current["manifestSha256"],
                       **provenance, "testedConfigDigest": image["imageId"], "manifestDigest": candidate["imageId"], "imageId": candidate["imageId"]}
        retained_slots = (self.chain[side]["slot"] for side in ("active", "previous"))
        runtimes = {item["route"]["generation"]: item["runtime"] for item in retained_slots}
        runtimes[generation.deployment_id] = candidate
        backend = self.chain["backendFingerprint"]
        preimage = canonical(self.admin.live)
        self.preimage = preimage
        self.controller = InstalledWebRepeat(self.state, admitted_chain=self.chain, expected_chain_sha256=lineage,
            installed_bytes=preimage, expected_installed_sha256=sha256(preimage).hexdigest(), host=HOST, traefik_ip=PEER, relay_alias=RELAY,
            candidate_runtime=candidate, candidate_alias=generation.target, qualification_sha256=content_hash(self.release), admin=self.admin,
            verify_release=lambda *_, **__: True, observe_installed=lambda: {"backendFingerprint": backend, "runtimes": runtimes},
            probe_health=lambda value, **_: {"runtimeId": value["runtime"]["runtimeId"], "generation": value["route"]["generation"], "healthy": True},
            read_durable_config=lambda: self.admin.persisted, observe_candidate_failure=lambda _: False, core_alias=self.core_alias,
            core_activation_operation_id=self.activation.get("core_activation_operation_id"),
            expected_core_activation_lineage_sha256=self.activation.get("core_activation_lineage_sha256"),
            expected_core_authority_sha256=self.core_authority if self.activation else None)
        for action in ("promote", "rollback", "reapply"):
            self.assertEqual(self.controller.run(action, clock=self.clock.monotonic, sleep=self.clock.sleep)["state"], "accepted")
        self.final = self.controller.plan("reapply")
        before, after = self.final["before"], self.final["after"]
        self.observation = {"beforeRuntime": before["runtime"], "afterRuntime": after["runtime"], "backendFingerprint": backend,
                            "route": after["route"], "aliases": {before["route"]["generation"]: self.chain["active"]["alias"],
                                                                generation.deployment_id: generation.target},
                            "liveConfigSha256": content_hash(self.admin.live), "autosaveConfigSha256": content_hash(self.admin.persisted),
                            "publicSourceRevision": revision, "publicHealthy": True, "ingressReady": True}

    def seal(self, **overrides):
        options = {"output_dir": self.output, "admitted_chain": self.chain, "expected_chain_sha256": content_hash(self.chain),
                   "expected_operation_id": self.final["operationId"], "expected_plan_sha256": content_hash(self.final),
                   "bundle_dir": self.bundle, "publication_bytes": self.publication, "expected_publication_sha256": self.publication_pin,
                   "import_record": self.imported, "loaded": self.loaded, "candidate_alias": self.candidate_alias,
                   "observe_installed": lambda: self.observation, **self.activation}
        return seal_functional_installed_web_lineage(self.state, **(options | overrides))

    def test_legacy_receipt_and_index_bytes_are_unchanged(self):
        self.candidate(D, "3")
        index = self.seal()
        self.assertEqual((self.output / "previous.json").read_bytes(), (self.prior / "active.json").read_bytes())
        self.assertEqual(index["previousSha256"], self.chain["active"]["receiptSha256"])
        self.assertEqual({path.name for path in self.output.iterdir()}, {"chain.json", "accepted-plan.json", "lineage.json", "active.json", "previous.json"})
        self.assertEqual((self.output / "lineage.json").read_bytes(), canonical(index) + b"\n")
        self.assertEqual(self.seal(), index)

    def test_first_core_receipt_rebinds_only_backend_and_next_rollout_reuses_exact_bytes(self):
        original = {path: path.read_bytes() for path in (*self.prior.iterdir(), self.original_journal)}
        self.activate_core()
        self.candidate(D, "3")
        new_backend = self.chain["backendFingerprint"]
        index = self.seal()
        transitioned = (self.output / "previous.json").read_bytes()
        expected = _generation(self.final, "before", C.target, self.chain["active"]["provenance"])
        self.assertEqual(transitioned, canonical(expected) + b"\n")
        self.assertNotEqual(index["previousSha256"], self.chain["active"]["receiptSha256"])
        self.assertEqual(index["backendFingerprint"], new_backend)
        self.assertEqual(index["predecessorChainSha256"], content_hash(self.chain))
        self.assertEqual({path: path.read_bytes() for path in original}, original)
        self.assertEqual(self.seal(), index)
        self.chain = self.admit(self.final, self.output)
        self.assertEqual(content_hash(self.chain), index["chainSha256"])
        retained = (self.output / "active.json").read_bytes()
        self.activation = {}
        self.candidate(E, "4")
        self.assertEqual(self.seal()["previousSha256"], sha256(retained).hexdigest())
        self.assertEqual((self.output / "previous.json").read_bytes(), retained)
        self.assertEqual({path: path.read_bytes() for path in original}, original)

    def test_core_requires_both_independent_pins_and_accepted_lineage(self):
        self.activate_core()
        self.candidate(D, "3")
        for overrides, message in (
            ({"core_activation_operation_id": None}, "Paired Core activation"),
            ({"core_activation_operation_id": None, "core_activation_lineage_sha256": None}, "differs from the accepted journal"),
            ({"core_activation_lineage_sha256": "0" * 64}, "Pinned Core lineage acceptance differs"),
            ({"expected_chain_sha256": "0" * 64}, "Independently pinned projected Web chain"),
        ):
            with self.subTest(overrides=overrides), self.assertRaisesRegex(SwitchConflict, message):
                self.seal(**overrides)
        self.assertFalse(list(self.output.iterdir()))

    def test_core_hold_or_lost_post_seal_observation_leaves_no_index(self):
        self.activate_core()
        self.candidate(D, "3")
        operation = self.activation["core_activation_operation_id"]
        pending = self.operations / (operation + ".json")
        accepted = _state(self.state / (operation + "-lineage-accepted.json"))
        _write_state(pending, {**accepted["activationBinding"], "state": "route-verified-lineage-pending"})
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.seal()
        self.assertFalse(list(self.output.iterdir()))
        pending.unlink()
        observations = iter((self.observation, {**self.observation, "publicHealthy": False}))
        with self.assertRaisesRegex(SwitchConflict, "route or protected backend changed"):
            self.seal(observe_installed=lambda: next(observations))
        self.assertFalse((self.output / "lineage.json").exists())
        self.assertEqual(self.seal()["acceptedOperationId"], self.final["operationId"])

    def test_observer_requires_the_compiled_core_route(self):
        self.activate_core()
        self.candidate(D, "3")
        previous, active = self.final["before"]["runtime"], self.final["after"]["runtime"]
        stage = self.directory("candidate")
        write_record(stage / "stage-ready.json", {"id": active["runtimeId"], "alias": D.target,
            "runtime": {key: value for key, value in active.items() if key != "schemaSha256"},
            "qualificationSha256": content_hash(self.release)})
        backend = {"backendFingerprint": self.chain["backendFingerprint"], "schemaSha256": active["schemaSha256"]}
        rows = {runtime["runtimeId"]: {"Id": runtime["runtimeId"], "State": {"Pid": 300, "StartedAt": "fixture"}, "RestartCount": 0}
                for runtime in (previous, active)}
        install = SimpleNamespace(chain=self.chain, relay_alias=RELAY, inputs={"edgeIP": PEER, "networkIds": {}, "runtimeSecret": "fixture",
                                  "version": "fixture"}, generations={"active": C, "previous": B}, preimage=self.preimage, core_alias=self.core_alias,
                                  operation=self.root, binding={"daemon": "fixture"}, backend=lambda: backend, _verify_ingress=lambda: None,
                                  admin=self.admin, relay_dir=self.root, docker=SimpleNamespace(inspect=rows.__getitem__), network="fixture",
                                  _public_health=lambda *_args, **_kwargs: True)
        self.loaded["daemon"] = "fixture"
        module = "installed_web_functional_lineage"
        with patch("installed_web_stage.OWNER_UID", os.geteuid()), \
                patch(f"{module}.read_autosave", side_effect=lambda _: self.admin.persisted), patch(f"{module}.read_admitted_web_slot"), \
                patch(f"{module}.network_peer", return_value="127.0.0.1"), patch(f"{module}.read_direct_web", return_value=True):
            observer = functional_installed_observer(install, plan=self.final, loaded=self.loaded, release=self.release, candidate_alias=D.target)
            self.assertEqual(observer(), self.observation)
            install.core_alias = None
            with self.assertRaisesRegex(ValueError, "Installed Caddy config differs"):
                functional_installed_observer(install, plan=self.final, loaded=self.loaded, release=self.release, candidate_alias=D.target)


if __name__ == "__main__":
    unittest.main()
