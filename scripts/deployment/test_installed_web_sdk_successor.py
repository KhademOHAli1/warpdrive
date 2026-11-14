"""Protected SDK lifecycle cases using the existing in-memory native fixtures.

The small base readiness-hook patch must be applied before these tests run.
No service, Docker daemon, public endpoint, or image archive is used.
"""

from copy import deepcopy
from hashlib import sha256
import unittest
from unittest.mock import patch

import installed_web_operator as operator
import installed_web_runtime as legacy
import installed_web_sdk_runtime as sdk
import installed_web_sdk_successor as sdk_successor
import installed_web_successor as base
import test_installed_web_successor as fixtures
from test_caddy_web_repeat import B, C, D, HOST, PEER, RELAY
from test_installed_web_operator import NETWORK_IDS, RUNTIME_SECRET
from test_installed_web_sdk_runtime import binding_for
from web_switch import content_hash


class SdkSuccessorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.InstalledWebSuccessorTests(
            "test_stage_from_verified_live_c_then_promote_reverse_reapply_without_a")
        # Reuse the real existing controller, durable journal and native-shaped
        # fixture. Only its external Docker/HTTP boundaries are already mocked.
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.row = self.fixture.rows["d" * 64]
        self.row["Config"]["Cmd"] = list(sdk.COMMAND)
        self.publication = "f" * 64
        self.binding = binding_for(self.row, self.publication, "sha256:" + "7" * 64)
        self.fixture.loaded["testedConfigDigest"] = self.binding["testedConfigDigest"]
        self.install = self.build()
        self.document, _ = self.install._candidate_document(self.fixture.loaded, D.target, self.binding["sourceRevision"])
        runtime = self.install._candidate(self.row, self.document, D.target)
        self.fixture.runtime_d = {**runtime, "schemaSha256": self.fixture.backend["schemaSha256"]}
        stage = self.fixture.stage_receipts[self.fixture.operation / "candidate/stage-ready.json"]
        stage.update(configSha256=content_hash(self.document), runtime=runtime)

    def build(self, **updates):
        env = self.fixture
        options = {"first": env.first, "operation": env.operation, "binding": env.binding,
                   "expected_binding_sha256": content_hash(env.binding), "chain": env.chain,
                   "chain_sha256": content_hash(env.chain), "watched": env.watched, "preimage": env.preimage,
                   "candidate_binding": self.binding, "expected_candidate_binding_sha256": content_hash(self.binding),
                   "expected_candidate_publication_sha256": self.publication}
        return sdk_successor.InstalledWebSdkSuccessor(env.docker, **(options | updates))

    def options(self):
        return self.fixture.options()

    def test_stage_then_promote_rollback_and_reapply_retain_real_controller_guards(self):
        env = self.fixture
        with patch.object(base, "start_private", return_value=env.stage_receipts[
                env.operation / "candidate/stage-ready.json"]) as stage:
            self.install.stage(**self.options())
        self.assertEqual(stage.call_args.kwargs["document"]["Cmd"], ["bun", "--bun", "next", "start"])
        controller = self.install.controller(**self.options(), verify_release=lambda _plan, *, initialize: not initialize)
        expected = fixtures.compile_repeat_web_configs(env.preimage,
            expected_sha256=sha256(env.preimage).hexdigest(), host=HOST, traefik_ip=PEER, relay_alias=RELAY,
            current=C, previous=B, candidate=D)
        for action, config in (("promote", "after"), ("rollback", "manualRollback"), ("reapply", "after")):
            with self.subTest(action=action):
                result = controller.run(action, clock=env.clock.monotonic, sleep=env.clock.sleep)
                self.assertEqual(result["state"], "accepted")
                self.assertEqual(env.admin.live, expected[config])
        self.assertEqual(env.admin.writes, [expected[name] for name in ("after", "manualRollback", "after")])
        self.assertEqual(set(env.inspected), {"b" * 64, "c" * 64, "d" * 64, env.relay["id"]})

    def test_stage_ready_callback_uses_sdk_hook_while_legacy_default_stays_legacy(self):
        env = self.fixture
        with patch.object(base, "start_private", return_value=env.stage_receipts[
                env.operation / "candidate/stage-ready.json"]) as stage:
            self.install.stage(**self.options())
        with patch.object(base, "candidate_ready", side_effect=AssertionError("legacy readiness cannot admit SDK")), \
                patch.object(operator, "network_peer", return_value="10.0.8.8"), \
                patch.object(operator, "read_direct_web", return_value=True) as direct:
            self.assertEqual(stage.call_args.kwargs["ready"](self.row),
                             self.fixture.stage_receipts[env.operation / "candidate/stage-ready.json"]["runtime"])
            direct.assert_called_once_with("10.0.8.8", self.binding["sourceRevision"], env.binding["inputs"]["version"])
        with patch.object(base, "candidate_ready", return_value="unchanged-default") as legacy_ready:
            self.assertEqual(env.install._candidate_ready(self.row, self.document, D.target,
                             self.binding["sourceRevision"]), "unchanged-default")
            legacy_ready.assert_called_once_with(env.docker, env.install.network, D.target, self.document,
                NETWORK_IDS, RUNTIME_SECRET, self.binding["sourceRevision"], env.install.inputs["version"], self.row)

    def test_readiness_requires_native_stable_healthy_process_and_direct_source_health(self):
        with patch.object(operator, "network_peer", return_value="10.0.8.8"), \
                patch.object(operator, "read_direct_web", return_value=False) as read:
            self.assertIsNone(self.install._candidate_ready(self.row, self.document, D.target,
                              self.binding["sourceRevision"]))
            self.assertEqual(read.call_count, 1)
        row = deepcopy(self.row)
        row["State"]["Health"]["Status"] = "starting"
        with patch.object(operator, "read_direct_web") as read:
            self.assertIsNone(self.install._candidate_ready(row, self.document, D.target,
                              self.binding["sourceRevision"]))
            read.assert_not_called()
        row["State"]["Health"]["Status"] = "healthy"
        row["RestartCount"] = 1
        with self.assertRaises(legacy.WebRuntimeError):
            self.install._candidate_ready(row, self.document, D.target, self.binding["sourceRevision"])

    def test_loaded_record_uses_generic_loader_config_and_platform_manifest_fields_exactly(self):
        for change in ({"testedConfigDigest": self.binding["imageId"]},
                       {"imageId": self.binding["testedConfigDigest"]},
                       {"manifestDigest": self.binding["testedConfigDigest"]},
                       {"sourceRevision": "1" * 40}, {"daemon": {"serverId": "foreign"}}):
            with self.subTest(change=change), self.assertRaises(legacy.WebRuntimeError):
                self.install._candidate_document(self.fixture.loaded | change, D.target,
                                                  self.binding["sourceRevision"])
        loaded = deepcopy(self.fixture.loaded)
        loaded.pop("testedConfigDigest")
        with self.assertRaises(legacy.WebRuntimeError):
            self.install._candidate_document(loaded, D.target, self.binding["sourceRevision"])

    def test_candidate_binding_cannot_choose_its_own_publication_authority(self):
        changed = deepcopy(self.binding)
        changed["publicationReceiptSha256"] = "0" * 64
        with self.assertRaises(legacy.WebRuntimeError):
            self.build(candidate_binding=changed, expected_candidate_binding_sha256=content_hash(changed))
        with self.assertRaises(legacy.WebRuntimeError):
            self.build(expected_candidate_binding_sha256="0" * 64)

    def test_retained_sdk_active_and_previous_use_each_exact_authority_not_candidate_profile(self):
        env = self.fixture
        registry = {}
        for name, authority, config in (("active", "a" * 64, "sha256:" + "1" * 64),
                                        ("previous", "b" * 64, "sha256:" + "2" * 64)):
            item = env.chain[name]
            row = env.rows[item["slot"]["runtime"]["runtimeId"]]
            row["Config"]["Cmd"] = list(sdk.COMMAND)
            binding = binding_for(row, authority, config)
            pin = content_hash(binding)
            registry[authority] = (binding, pin)
            item["provenance"] = {"authoritySha256": authority, "revision": binding["sourceRevision"],
                                   "testedConfigDigest": config}
            profile = sdk.installed_profile(row, image_id=binding["imageId"], revision=binding["sourceRevision"],
                network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET, binding=binding,
                expected_binding_sha256=pin, authority_sha256=authority, tested_config_digest=config)
            item["slot"]["runtime"]["configSha256"] = content_hash(profile)
        install = self.build(retained_sdk_bindings=registry)
        backend, profile = install._retained()
        self.assertEqual(backend, env.backend)
        self.assertEqual(profile["profileId"], sdk.PROFILE_ID)
        document, _ = install._candidate_document(env.loaded, D.target, self.binding["sourceRevision"])
        self.assertEqual(document["Cmd"], list(sdk.COMMAND))
        with self.assertRaises(legacy.WebRuntimeError):
            self.build()._retained()  # SDK retained runtime without authority must hold.
        for authority in registry:
            missing = {key: pair for key, pair in registry.items() if key != authority}
            with self.subTest(authority=authority), self.assertRaises(legacy.WebRuntimeError):
                self.build(retained_sdk_bindings=missing)._retained()
        env.chain["active"]["provenance"]["testedConfigDigest"] = self.binding["testedConfigDigest"]
        with self.assertRaises(legacy.WebRuntimeError):
            self.build(retained_sdk_bindings=registry)._retained()

    def test_observer_dispatch_reads_new_sdk_and_retained_legacy_slots_without_schema_change(self):
        env = self.fixture
        item = {"slot": {"runtime": env.runtime_d}, "alias": D.target,
                "provenance": {"authoritySha256": self.publication,
                               "revision": self.binding["sourceRevision"],
                               "testedConfigDigest": self.binding["testedConfigDigest"]}}
        self.assertEqual(self.install.read_admitted_slot(self.row, item=item,
            schema_sha256=env.backend["schemaSha256"])["profileId"], sdk.PROFILE_ID)
        for name in ("active", "previous"):
            retained = env.chain[name]
            row = env.rows[retained["slot"]["runtime"]["runtimeId"]]
            profile = self.install.read_admitted_slot(row, item=retained,
                schema_sha256=env.backend["schemaSha256"])
            self.assertNotIn("profileId", profile)
        item["provenance"].pop("authoritySha256")
        with self.assertRaises(legacy.WebRuntimeError):
            self.install.read_admitted_slot(self.row, item=item, schema_sha256=env.backend["schemaSha256"])

    def test_backend_relay_and_durable_route_drift_hold_before_candidate_creation(self):
        env = self.fixture
        with patch.object(base, "start_private") as create:
            env.admin.persisted = {}
            with self.assertRaises(legacy.WebRuntimeError):
                self.install.stage(**self.options())
            create.assert_not_called()
        env.admin.persisted = env.current
        with patch.object(self.install, "_backend", side_effect=legacy.WebRuntimeError("backend changed")), \
                patch.object(base, "start_private") as create:
            with self.assertRaisesRegex(legacy.WebRuntimeError, "backend changed"):
                self.install.stage(**self.options())
            create.assert_not_called()

    def test_candidate_live_privilege_or_command_drift_blocks_all_action_readbacks(self):
        for mutate in (lambda row: row["Config"].update(Cmd=legacy.COMMAND.copy()),
                       lambda row: row["HostConfig"].update(Privileged=True)):
            original = deepcopy(self.row)
            mutate(self.row)
            try:
                controller = self.install.controller(**self.options(),
                    verify_release=lambda _plan, *, initialize: not initialize)
                for action in ("promote", "rollback", "reapply"):
                    with self.subTest(action=action), self.assertRaises(legacy.WebRuntimeError):
                        controller._runtimes(controller.plan(action))
            finally:
                self.row.clear()
                self.row.update(original)


if __name__ == "__main__":
    unittest.main()
