"""SDK lineage cases over existing pure controllers and native-shaped fixtures."""

from copy import deepcopy
from hashlib import sha256
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from component_inputs import canonical as sdk_canonical, content_hash as sdk_content_hash
import installed_web_sdk_lineage as lineage
import installed_web_sdk_runtime as sdk
import test_installed_web_functional_lineage as functional_fixtures
import test_installed_web_sdk_successor as runtime_fixtures
from installed_web_lineage import _generation
from installed_web_repeat import InstalledWebRepeat
from test_caddy_web_repeat import D, HOST, PEER, RELAY
from test_installed_web_operator import NETWORK_IDS, RUNTIME_SECRET
from test_installed_web_sdk_runtime import binding_for
from web_generation_routes import WebGeneration
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, canonical, content_hash


class SdkLineageTests(unittest.TestCase):
    def setUp(self):
        self.prepare()

    def prepare(self, *, core=False, unicode_evidence=False):
        fixture = functional_fixtures.FunctionalLineageTests("test_legacy_receipt_and_index_bytes_are_unchanged")
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.fixture = fixture
        if core:
            fixture.activate_core()
        self.chain = deepcopy(fixture.chain)
        self.retained = {}
        self.authority = Mock(return_value=True)
        self.original_receipts = {path: path.read_bytes() for path in fixture.prior.iterdir()}
        self.candidate(D, "3", unicode_evidence=unicode_evidence)

    def candidate(self, generation, digit, *, unicode_evidence=False):
        fixture = self.fixture
        self.operation = fixture.directory("sdk-" + generation.deployment_id[-12:])
        self.output = self.operation / "lineage"
        self.output.mkdir(mode=0o700)
        self.alias = generation.target
        self.runtime = fixture.runtime_slot(generation, digit)["runtime"]
        source = self.runtime["sourceRevision"]
        publication = {"kind": "fixture-original-full-sdk-publication-admission", "revision": source}
        if unicode_evidence:
            publication["notes"] = "Freigabe geprüft – مسیر انتشار / 日本語"
        self.publication = sdk_canonical(publication) + b"\n"
        self.publication_pin = sha256(self.publication).hexdigest()
        config = "sha256:" + sha256(("config:" + source).encode()).hexdigest()
        self.binding = {"kind": "warpdrive-sdk-web-runtime-binding", "schemaVersion": 1,
                        "publicationReceiptSha256": self.publication_pin, "sourceRevision": source,
                        "imageId": self.runtime["imageId"], "testedConfigDigest": config,
                        "profileId": sdk.PROFILE_ID, "command": list(sdk.COMMAND)}
        self.image = {"imageId": config, "sourceRevision": source, "runtimeUser": "bun", "generation": generation.deployment_id}
        provenance = {"bundleManifestSha256": sha256(("bundle:" + source).encode()).hexdigest(),
                      "archiveSha256": sha256(("archive:" + source).encode()).hexdigest(), "archiveSizeBytes": 123456}
        origin = {"kind": "github-actions", "repository": lineage.REPOSITORY, "ref": "refs/heads/main",
                  "event": "workflow_dispatch", "runId": 41, "runAttempt": 1}
        self.projection = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-archive-projection",
            "policy": "sdk-full-bundle-one-web-native-closure-v1", "sourceRevision": source, "platform": "linux/amd64",
            "original": {"kind": "warpdrive-tested-image-bundle", "schemaVersion": 3,
                "publicationAdmissionSha256": sdk_content_hash(lineage.decode(self.publication)), "origin": origin,
                "bundleManifestSha256": provenance["bundleManifestSha256"], "archiveSha256": "0" * 64,
                "archiveSizeBytes": 456789, "testedNativeImageId": "sha256:" + "a" * 64, "candidatePendingGates": ["installation"]},
            "selectedWeb": {"configDigest": config, "manifestDigest": self.runtime["imageId"]},
            "derived": {"path": "/synthetic/projection/web-image.tar", "kind": "untagged-single-web-direct-oci-archive",
                        "archiveSha256": provenance["archiveSha256"], "archiveSizeBytes": provenance["archiveSizeBytes"]},
            "image": self.image, "provenance": provenance, "projectionOnly": True, "backendReuseQualified": False,
            "installationAuthorized": False, "deploymentAuthorized": False}
        self.reuse = {"kind": "fixture-independent-sdk-backend-engine-reuse",
                      "backendFingerprint": self.chain["backendFingerprint"], "engineWitness": "separately-pinned"}
        if unicode_evidence:
            self.projection["derived"]["path"] = "/synthetic/projection/prüfungen/مسیر/web-image.tar"
            self.reuse["limitations"] = ["Backend geprüft; Engine séparément qualifié – محدودیت‌ها"]
            self.reuse["evidencePath"] = "/synthetic/qualification/évidence/پشتوانه.json"
        self.release = {"schemaVersion": 1, "kind": lineage.RELEASE_KIND, "sourceRevision": source,
                        "publicationReceiptSha256": self.publication_pin, "image": self.image, "provenance": provenance,
                        "projectionReceiptSha256": sdk_content_hash(self.projection), "runtimeBindingSha256": sdk_content_hash(self.binding),
                        "backendReuseQualificationSha256": sdk_content_hash(self.reuse)}
        previous = self.chain["active"]["provenance"]
        self.loaded = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                       "deploymentAuthorized": False, "sourceRevision": source, "origin": origin,
                       "baselineRevision": previous["revision"], "baselineManifestSha256": previous["manifestSha256"],
                       **provenance, "testedConfigDigest": config, "manifestDigest": self.runtime["imageId"],
                       "imageId": self.runtime["imageId"], "daemon": {"serverId": "fixture", "socketDevice": 1, "socketInode": 2},
                       "beforeInventorySha256": "b" * 64, "afterInventorySha256": "c" * 64}
        slots = [self.chain[name]["slot"] for name in ("active", "previous")]
        runtimes = {slot["route"]["generation"]: slot["runtime"] for slot in slots}
        runtimes[generation.deployment_id] = self.runtime
        preimage = canonical(fixture.admin.live)
        self.controller = InstalledWebRepeat(fixture.state, admitted_chain=self.chain,
            expected_chain_sha256=content_hash(self.chain), installed_bytes=preimage,
            expected_installed_sha256=sha256(preimage).hexdigest(), host=HOST, traefik_ip=PEER, relay_alias=RELAY,
            candidate_runtime=self.runtime, candidate_alias=self.alias, qualification_sha256=content_hash(self.release),
            admin=fixture.admin, verify_release=lambda *_, **__: True,
            observe_installed=lambda: {"backendFingerprint": self.chain["backendFingerprint"], "runtimes": runtimes},
            probe_health=lambda value, **_: {"runtimeId": value["runtime"]["runtimeId"],
                "generation": value["route"]["generation"], "healthy": True},
            read_durable_config=lambda: fixture.admin.persisted, observe_candidate_failure=lambda _: False,
            core_alias=fixture.core_alias, core_activation_operation_id=fixture.activation.get("core_activation_operation_id"),
            expected_core_activation_lineage_sha256=fixture.activation.get("core_activation_lineage_sha256"),
            expected_core_authority_sha256=fixture.core_authority if fixture.activation else None)
        for phase in ("promote", "rollback", "reapply"):
            self.assertEqual(self.controller.run(phase, clock=fixture.clock.monotonic, sleep=fixture.clock.sleep)["state"], "accepted")
        self.final = self.controller.plan("reapply")
        self.observation = lineage._expected_observation(self.final, self.chain, self.alias)

    def options(self):
        return {"output_dir": self.output, "admitted_chain": self.chain, "expected_chain_sha256": content_hash(self.chain),
                "expected_operation_id": self.final["operationId"], "expected_plan_sha256": content_hash(self.final),
                "release": self.release, "source_publication_bytes": self.publication,
                "expected_publication_sha256": self.publication_pin, "projection_receipt": self.projection,
                "runtime_binding": self.binding, "expected_runtime_binding_sha256": sdk_content_hash(self.binding),
                "retained_sdk_bindings": self.retained, "backend_reuse_qualification": self.reuse, "loaded": self.loaded,
                "candidate_alias": self.alias, "observe_installed": lambda: self.observation,
                "verify_authority": self.authority, **self.fixture.activation}

    def seal(self, **changes):
        return lineage.seal_sdk_installed_web_lineage(self.fixture.state, **(self.options() | changes))

    def history(self, index=None):
        index = self.seal() if index is None else index
        return lineage.read_sdk_installed_web_history(self.output, expected_chain_sha256=index["chainSha256"],
            expected_index_sha256=sha256((self.output / "lineage.json").read_bytes()).hexdigest(), verify_authority=self.authority)

    def rewrite(self, name, value, *, newline=False):
        path = self.output / (name + ".json")
        path.chmod(0o600)
        path.write_bytes(canonical(value) + (b"\n" if newline else b""))
        path.chmod(0o400)

    def test_seal_is_index_last_idempotent_and_preserves_generic_and_legacy_bytes(self):
        index = self.seal()
        self.assertEqual(index["kind"], lineage.KIND)
        self.assertEqual(set(index), lineage.INDEX_KEYS)
        self.assertEqual({p.name for p in self.output.iterdir()}, {n + ".json" for n in lineage.SEALED_NAMES})
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o400 for p in self.output.iterdir()))
        self.assertEqual((self.output / "previous.json").read_bytes(), self.original_receipts[self.fixture.prior / "active.json"])
        self.assertEqual({p: p.read_bytes() for p in self.original_receipts}, self.original_receipts)
        before = {p: p.read_bytes() for p in self.output.iterdir()}
        self.assertEqual(self.seal(), index)
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_history_returns_explicit_authority_registry_with_separate_identity_pins(self):
        index = self.seal()
        chain, plan, registry = self.history(index)
        self.assertEqual(content_hash(chain), index["chainSha256"])
        self.assertEqual(plan, self.final)
        self.assertEqual(registry, {self.publication_pin: (self.binding, sdk_content_hash(self.binding))})
        self.assertNotEqual(self.binding["imageId"], self.binding["testedConfigDigest"])
        self.assertNotEqual(self.projection["original"]["testedNativeImageId"], self.binding["imageId"])
        self.assertEqual(chain["active"]["provenance"]["manifestSha256"], self.projection["original"]["bundleManifestSha256"])

    def test_original_raw_publication_and_canonical_admission_hash_are_distinct_and_preserved(self):
        self.assertNotEqual(self.publication_pin, sdk_content_hash(lineage.decode(self.publication)))
        index = self.seal()
        self.assertEqual(index["sourcePublicationSha256"], self.publication_pin)
        self.assertEqual((self.output / "source-publication.json").read_bytes(), self.publication)
        with self.assertRaises(SwitchConflict):
            self.seal(expected_publication_sha256=sdk_content_hash(lineage.decode(self.publication)))

    def test_unicode_qualification_projection_path_and_original_publication_roundtrip(self):
        self.prepare(unicode_evidence=True)
        original = lineage.decode(self.publication)
        admission_pin = sdk_content_hash(original)
        self.assertEqual(self.projection["original"]["publicationAdmissionSha256"], admission_pin)
        self.assertNotEqual(admission_pin, content_hash(original))
        self.assertNotEqual(self.publication_pin, admission_pin)
        for value in (self.projection, self.reuse):
            self.assertNotEqual(sdk_content_hash(value), content_hash(value))
        # The established controller still hashes the release qualification
        # and composes the two digest strings with web_switch.
        self.assertEqual(self.final["qualificationSha256"], content_hash({
            "installedChainSha256": content_hash(self.chain),
            "releaseQualificationSha256": content_hash(self.release)}))
        index = self.seal()
        chain, plan, registry = self.history(index)
        self.assertEqual(plan, self.final)
        self.assertEqual(content_hash(chain), index["chainSha256"])
        self.assertEqual(registry[self.publication_pin], (self.binding, sdk_content_hash(self.binding)))
        for name, value in (("projection-receipt", self.projection), ("backend-reuse-qualification", self.reuse)):
            with self.subTest(record=name):
                raw = (self.output / (name + ".json")).read_bytes()
                self.assertEqual(raw, sdk_canonical(value))
                self.assertNotEqual(raw, canonical(value))
                self.assertEqual(lineage.decode(raw), value)
        self.assertEqual(index["projectionReceiptSha256"], self.release["projectionReceiptSha256"])
        self.assertEqual(index["backendReuseQualificationSha256"], self.release["backendReuseQualificationSha256"])
        self.assertEqual(index["sourcePublicationSha256"], sha256(self.publication).hexdigest())
        self.assertEqual((self.output / "source-publication.json").read_bytes(), self.publication)
        self.assertEqual({p: p.read_bytes() for p in self.original_receipts}, self.original_receipts)
        with self.assertRaisesRegex(SwitchConflict, "qualification pins differ"):
            self.seal(release=self.release | {"backendReuseQualificationSha256": content_hash(self.reuse)})

    def test_wrong_index_kind_rejected_even_with_new_independent_test_pin(self):
        index = self.seal()
        self.rewrite("lineage", index | {"kind": "warpdrive-functional-installed-web-lineage"}, newline=True)
        with self.assertRaisesRegex(SwitchConflict, "index kind"):
            self.history(index)

    def test_registry_mutation_missing_authority_and_wrong_source_all_hold(self):
        index = self.seal()
        original = lineage.decode((self.output / "runtime-bindings.json").read_bytes())
        for mutate in (
            lambda doc: doc["bindings"].clear(),
            lambda doc: doc["bindings"][self.publication_pin]["binding"].update(sourceRevision="0" * 40),
            lambda doc: doc["bindings"][self.publication_pin].update(bindingSha256="0" * 64),
        ):
            changed = deepcopy(original)
            mutate(changed)
            self.rewrite("runtime-bindings", changed)
            with self.subTest(mutate=mutate), self.assertRaises((ValueError, SwitchConflict)):
                self.history(index)
        self.rewrite("runtime-bindings", original)
        self.history(index)

    def test_candidate_generation_provenance_cannot_be_substituted(self):
        index = self.seal()
        generation = lineage.decode((self.output / "active.json").read_bytes())
        generation["provenance"]["authoritySha256"] = "0" * 64
        self.rewrite("active", generation, newline=True)
        with self.assertRaisesRegex(SwitchConflict, "generation"):
            self.history(index)

    def test_stale_final_plan_and_missing_healthy_rollback_hold_before_any_seal(self):
        original = self.controller.plan("rollback")
        path = self.fixture.operations / (original["operationId"] + ".json")
        accepted = {"plan": original, "state": "accepted"}
        rejected = {"plan": original, "state": "rejected"}
        _write_state(path, rejected, previous=accepted)
        with self.assertRaisesRegex(SwitchConflict, "healthy rollback"):
            self.seal()
        self.assertEqual(list(self.output.iterdir()), [])
        _write_state(path, accepted, previous=rejected)
        with self.assertRaises(SwitchConflict):
            self.seal(expected_plan_sha256="0" * 64)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_failed_second_observation_retains_partial_records_but_never_index(self):
        observe = Mock(side_effect=[self.observation, self.observation | {"publicHealthy": False}])
        with self.assertRaisesRegex(SwitchConflict, "changed during sealing"):
            self.seal(observe_installed=observe)
        self.assertFalse((self.output / "lineage.json").exists())
        self.assertTrue((self.output / "active.json").exists())

    def test_authority_callback_must_explicitly_succeed_before_seal(self):
        for value in (None, False):
            with self.subTest(value=value), self.assertRaisesRegex(SwitchConflict, "backend/Engine"):
                self.seal(verify_authority=lambda: value)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_extra_release_fields_and_falsely_qualified_projection_are_rejected(self):
        with self.assertRaisesRegex(SwitchConflict, "admitted SDK release"):
            self.seal(release=self.release | {"deploymentAuthorized": True})
        projection = self.projection | {"backendReuseQualified": True}
        release = self.release | {"projectionReceiptSha256": sdk_content_hash(projection)}
        with self.assertRaisesRegex(SwitchConflict, "non-admission scope"):
            self.seal(projection_receipt=projection, release=release)

    def test_sdk_readback_checks_exact_index_all_journals_and_current_authority(self):
        index = self.seal()
        install = SimpleNamespace(operation=self.operation, state=self.fixture.state, chain=self.chain,
            chain_sha256=content_hash(self.chain), candidate_publication_sha256=self.publication_pin,
            candidate_binding=self.binding, candidate_binding_sha256=sdk_content_hash(self.binding),
            retained_sdk_bindings=self.retained, core_activation_operation_id=None, core_activation_lineage_sha256=None)
        options = {"controller": self.controller, "expected_plan_sha256": content_hash(self.final),
                   "expected_index_sha256": sha256((self.output / "lineage.json").read_bytes()).hexdigest(),
                   "loaded": self.loaded, "release": self.release, "publication_sha256": self.publication_pin,
                   "observe_installed": lambda: self.observation, "verify_authority": self.authority}
        self.assertEqual(lineage.read_sdk_seal_acknowledgement(install, **options),
                         {"state": "sealed", "sourceRevision": self.runtime["sourceRevision"], "lineage": index})
        with self.assertRaises(SwitchConflict):
            lineage.read_sdk_seal_acknowledgement(install, **(options | {"expected_index_sha256": "0" * 64}))
        phase = self.controller.plan("promote")
        _write_state(self.fixture.operations / (phase["operationId"] + ".json"),
                     {"plan": phase, "state": "rejected"}, previous={"plan": phase, "state": "accepted"})
        with self.assertRaises(SwitchConflict):
            lineage.read_sdk_seal_acknowledgement(install, **options)

    def test_legacy_history_dispatch_uses_unchanged_reader_and_empty_sdk_registry(self):
        fixture = self.fixture
        index = {"schemaVersion": 1, "kind": "warpdrive-functional-installed-web-lineage", "targetKey": fixture.plan["targetKey"],
                 "acceptedOperationId": fixture.plan["operationId"], "acceptedPlanSha256": content_hash(fixture.plan),
                 "predecessorChainSha256": "f" * 64, "backendFingerprint": fixture.plan["backendFingerprint"],
                 "liveConfigSha256": fixture.plan["after"]["route"]["fingerprint"],
                 "activeSha256": fixture.chain["active"]["receiptSha256"], "previousSha256": fixture.chain["previous"]["receiptSha256"],
                 "chainSha256": content_hash(fixture.chain)}
        for name, raw in (("chain", canonical(fixture.chain)), ("accepted-plan", canonical(fixture.plan)),
                          ("lineage", canonical(index) + b"\n")):
            path = fixture.prior / (name + ".json")
            path.write_bytes(raw)
            path.chmod(0o400)
        before = {p: p.read_bytes() for p in fixture.prior.iterdir()}
        result = lineage.read_installed_web_history(fixture.prior, expected_chain_sha256=content_hash(fixture.chain),
            expected_index_sha256=sha256((fixture.prior / "lineage.json").read_bytes()).hexdigest(), verify_authority=self.authority)
        self.assertEqual(result, (fixture.chain, fixture.plan, {}))
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_already_completed_core_projection_reuses_existing_verifier_without_rewriting_old_receipts(self):
        self.prepare(core=True)
        index = self.seal()
        self.assertEqual(index["coreActivation"], {
            "operationId": self.fixture.activation["core_activation_operation_id"],
            "lineageSha256": self.fixture.activation["core_activation_lineage_sha256"]})
        self.assertNotEqual(index["previousSha256"], self.chain["active"]["receiptSha256"])
        self.assertEqual({p: p.read_bytes() for p in self.original_receipts}, self.original_receipts)
        self.history(index)

    def test_next_sdk_seal_carries_previous_sdk_binding_and_unchanged_generation_bytes(self):
        first = self.seal()
        accepted, _, registry = self.history(first)
        previous = (self.output / "active.json").read_bytes()
        generations = ((functional_fixtures.E, "4"),
                       (WebGeneration("wd-" + "f" * 40, "warpdrive-web-" + "f" * 12), "5"),
                       (WebGeneration("wd-" + "a" * 40, "warpdrive-web-" + "a" * 12), "6"))
        for generation, digit in generations:
            with self.subTest(generation=generation.deployment_id):
                self.chain, self.retained = accepted, registry
                self.fixture.activation = {}
                self.candidate(generation, digit)
                index = self.seal()
                accepted, _, registry = self.history(index)
                self.assertEqual((self.output / "previous.json").read_bytes(), previous)
                self.assertEqual(len(registry), 2)
                self.assertEqual(registry[self.publication_pin], (self.binding, sdk_content_hash(self.binding)))
                self.assertEqual(set(registry), {accepted[name]["provenance"]["authoritySha256"]
                                                for name in ("active", "previous")})
                sealed = lineage.decode((self.output / "runtime-bindings.json").read_bytes())
                self.assertGreaterEqual(len(sealed["bindings"]), len(registry))
                previous = (self.output / "active.json").read_bytes()


class SdkObserverTests(unittest.TestCase):
    def setUp(self):
        fixture = runtime_fixtures.SdkSuccessorTests("test_observer_dispatch_reads_new_sdk_and_retained_legacy_slots_without_schema_change")
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.fixture, self.env = fixture, fixture.fixture
        env = self.env
        for name, side, digit in (("active", "after", "c"), ("previous", "before", "b")):
            item = env.chain[name]
            item["provenance"] = {"repository": lineage.REPOSITORY, "revision": item["slot"]["runtime"]["sourceRevision"],
                "manifestSha256": digit * 64, "archiveSha256": digit * 64,
                "testedConfigDigest": "sha256:" + digit * 64, "authoritySha256": digit * 64}
            item["receiptSha256"] = sha256(canonical(_generation(env.plan, side, item["alias"], item["provenance"])) + b"\n").hexdigest()
        self.authority = Mock(return_value=True)
        self.release = {"schemaVersion": 1, "kind": lineage.RELEASE_KIND,
            "sourceRevision": fixture.binding["sourceRevision"], "publicationReceiptSha256": fixture.publication,
            "image": {"imageId": fixture.binding["testedConfigDigest"], "sourceRevision": fixture.binding["sourceRevision"],
                      "runtimeUser": "bun", "generation": "wd-" + fixture.binding["sourceRevision"]},
            "provenance": {"bundleManifestSha256": "5" * 64, "archiveSha256": "6" * 64, "archiveSizeBytes": 123456},
            "projectionReceiptSha256": "1" * 64, "runtimeBindingSha256": sdk_content_hash(fixture.binding),
            "backendReuseQualificationSha256": "2" * 64}
        env.loaded.update(schemaVersion=1, deploymentAuthorized=False,
            origin={"kind": "github-actions", "repository": lineage.REPOSITORY, "runId": 1, "runAttempt": 1},
            baselineRevision=env.chain["active"]["provenance"]["revision"],
            baselineManifestSha256=env.chain["active"]["provenance"]["manifestSha256"],
            **self.release["provenance"], beforeInventorySha256="8" * 64, afterInventorySha256="9" * 64)
        env.stage_receipts[env.operation / "candidate/stage-ready.json"]["qualificationSha256"] = content_hash(self.release)
        self.enterContext(patch.object(lineage, "read_record", side_effect=env.stage_receipts.__getitem__))
        self.enterContext(patch.object(lineage, "read_autosave", side_effect=lambda _: deepcopy(env.admin.persisted)))
        self.enterContext(patch.object(lineage, "network_peer", return_value="10.0.8.8"))
        self.enterContext(patch.object(lineage, "read_direct_web", return_value=True))

    def install(self, registry=None):
        install = self.fixture.build(retained_sdk_bindings={} if registry is None else registry)
        controller = install.controller(loaded=self.env.loaded, alias=D.target, revision=self.fixture.binding["sourceRevision"],
                                       release=self.release, verify_release=lambda *_a, **_k: True)
        self.env.admin.live = deepcopy(controller._documents["after"])
        self.env.admin.persisted = deepcopy(controller._documents["after"])
        plan = controller.plan("reapply")
        observer = lineage.sdk_installed_observer(install, plan=plan, loaded=self.env.loaded, release=self.release,
                                                candidate_alias=D.target, verify_authority=self.authority)
        return install, plan, observer

    def test_old_legacy_and_new_sdk_dispatch_both_run_again_after_probe(self):
        install, plan, observer = self.install()
        with patch.object(install, "read_admitted_slot", wraps=install.read_admitted_slot) as read:
            observed = observer()
        self.assertEqual(observed, lineage._expected_observation(plan, install.chain, D.target))
        self.assertEqual(read.call_count, 4)
        authorities = [call.kwargs["item"]["provenance"]["authoritySha256"] for call in read.call_args_list]
        self.assertEqual(authorities, ["c" * 64, self.fixture.publication] * 2)
        self.assertGreaterEqual(self.authority.call_count, 4)

    def test_retained_old_sdk_and_new_sdk_both_use_exact_authority_bindings(self):
        item = self.env.chain["active"]
        row = self.env.rows[item["slot"]["runtime"]["runtimeId"]]
        row["Config"]["Cmd"] = list(sdk.COMMAND)
        binding = binding_for(row, "c" * 64, "sha256:" + "c" * 64)
        pin = sdk_content_hash(binding)
        profile = sdk.installed_profile(row, image_id=binding["imageId"], revision=binding["sourceRevision"],
            network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET, binding=binding, expected_binding_sha256=pin,
            authority_sha256="c" * 64, tested_config_digest=binding["testedConfigDigest"])
        item["slot"]["runtime"]["configSha256"] = content_hash(profile)
        install, _, observer = self.install({"c" * 64: (binding, pin)})
        with patch.object(install, "read_admitted_slot", wraps=install.read_admitted_slot) as read:
            observer()
        self.assertEqual(read.call_count, 4)
        with self.assertRaises(ValueError):
            self.fixture.build()._retained()

    def test_postprobe_command_mutation_is_not_hidden_by_unchanged_pid(self):
        install, _, observer = self.install()
        def mutate(*_a, **_k):
            self.env.rows["d" * 64]["Config"]["Cmd"] = ["bun", "node_modules/next/dist/bin/next", "start"]
            return True
        with patch.object(install, "_public_health", side_effect=mutate), self.assertRaises(ValueError):
            observer()

    def test_engine_authority_failure_after_healthy_native_probe_holds(self):
        _, _, observer = self.install()
        self.authority.side_effect = [True, False]
        with self.assertRaisesRegex(SwitchConflict, "backend/Engine"):
            observer()

    def test_candidate_provenance_cannot_self_select_another_publication(self):
        install, plan, _ = self.install()
        changed = self.release | {"publicationReceiptSha256": "0" * 64}
        with self.assertRaises((ValueError, SwitchConflict)):
            lineage.sdk_installed_observer(install, plan=plan, loaded=self.env.loaded, release=changed,
                candidate_alias=D.target, verify_authority=self.authority)


if __name__ == "__main__":
    unittest.main()
