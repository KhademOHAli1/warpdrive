"""Exercise the successor adapter without starting or inspecting an older Web process."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import installed_web_successor as successor
from caddy_core_config import core_api_routes
from caddy_web_config import _generation_handler
from caddy_web_repeat import compile_repeat_web_configs
from installed_web_probe import PublicProbe
from installed_web_runtime import OWNER_LABEL, WebRuntimeError, verify_candidate
from test_caddy_web_repeat import B, C, D, HOST, PEER, RELAY, compile_next, installed_after_first_switch
from test_installed_web_operator import NETWORK_IDS, RUNTIME_SECRET, candidate_fixture
from test_installed_web_target import Admin
from test_web_rollout import Target
from test_web_switch import FakeClock
from web_rollout import _write_state, rollout_web
from web_switch import SwitchConflict, SwitchHeld, canonical, content_hash


def generation_row(generation, identifier, image_letter):
    document, row = candidate_fixture()
    revision = generation.deployment_id.removeprefix("wd-")
    image = "sha256:" + image_letter * 64
    row.update(Id=identifier, Name="/" + generation.target, Image=image, ImageManifestDescriptor={"digest": image})
    env = [value for value in document["Env"] if not value.startswith(("APP_COMMIT=", "NEXT_DEPLOYMENT_ID="))]
    row["Config"].update(Image=image, Env=env + [f"APP_COMMIT={revision}", f"NEXT_DEPLOYMENT_ID={generation.deployment_id}"],
                         Labels={OWNER_LABEL: generation.target, "traefik.enable": "false"})
    for endpoint in row["NetworkSettings"]["Networks"].values():
        endpoint["Aliases"] = [generation.target]
    profile = successor.installed_profile(row, image_id=image, revision=revision, network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
    expected = successor._document(profile, image=image, revision=revision, alias=generation.target)
    runtime = verify_candidate(row, expected, alias=generation.target, network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
    return row, {**runtime, "schemaSha256": "d" * 64}, expected


class InstalledWebSuccessorTests(unittest.TestCase):
    core_alias = None

    def setUp(self):
        tmp = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.first, self.operation, self.watched = (tmp / name for name in ("first", "next", "watched"))
        for path in (self.first, self.operation, self.watched):
            path.mkdir(mode=0o700)
        self.state = self.first / "rollout"
        self.clock = FakeClock()
        configs = compile_next(installed_after_first_switch())
        if self.core_alias is not None:
            for name, active, retained in (("after", C, B), ("manualRollback", B, C)):
                _generation_handler(configs[name])["routes"][1:1] = core_api_routes(self.core_alias, active, retained)
        self.current = configs["after"]
        self.preimage = canonical(self.current)
        self.admin = Admin(self.current)
        row_b, runtime_b, _ = generation_row(B, "b" * 64, "b")
        row_c, runtime_c, _ = generation_row(C, "c" * 64, "c")
        row_d, self.runtime_d, self.doc_d = generation_row(D, "d" * 64, "d")
        self.relay = {"id": "4" * 64, "imageId": "sha256:" + "4" * 64}
        self.manifest = {"digest": "sha256:" + "8" * 64, "mediaType": "application/vnd.oci.image.manifest.v1+json", "size": 52,
                         "platform": {"os": "linux", "architecture": "amd64"}}
        self.rows = {row["Id"]: row for row in (row_b, row_c, row_d)} | {
            self.relay["id"]: {"Id": self.relay["id"], "Image": self.relay["imageId"], "ImageManifestDescriptor": self.manifest},
            "6" * 64: {"Id": "6" * 64}}
        self.image = {"Id": self.relay["imageId"], "Descriptor": {"digest": self.relay["imageId"], "size": 75,
            "mediaType": "application/vnd.oci.image.index.v1+json"}, "Manifests": [
            {"Descriptor": self.manifest, "ID": self.manifest["digest"], "Kind": "image", "Available": True,
             "ImageData": {"Platform": self.manifest["platform"]}},
            {"Descriptor": {**self.manifest, "digest": "sha256:" + "9" * 64, "platform": {"os": "linux", "architecture": "arm64"}},
             "Kind": "image", "Available": False}]}
        self.inspected = []

        def inspect(identifier):
            self.inspected.append(identifier)
            return deepcopy(self.rows[identifier])

        def request(method, path):
            self.assertEqual((method, path), ("GET", f"/images/{self.relay['imageId']}/json?manifests=true"))
            return deepcopy(self.image)

        self.docker = SimpleNamespace(inspect=inspect, request=request)

        def make_slot(runtime, generation, config):
            return {"runtime": runtime, "route": {"runtimeId": runtime["runtimeId"], "generation": generation.deployment_id,
                                                 "fingerprint": content_hash(config)}}

        old, active = make_slot(runtime_b, B, configs["manualRollback"]), make_slot(runtime_c, C, self.current)
        self.backend = {"backendFingerprint": "e" * 64, "schemaSha256": "d" * 64,
                        "processes": {"edge": {"id": "5" * 64, "pid": 23}, "realtime": {"id": "6" * 64}}}
        self.original_backend = deepcopy(self.backend)
        if self.core_alias is not None:
            self.core_witness = {"id": "8" * 64}
            self.core_pin = {"id": "8" * 64,
                "ingress": {"networkId": NETWORK_IDS[successor.INGRESS], "alias": self.core_alias},
                "database": {"networkId": NETWORK_IDS[successor.NETWORKS[1]]}}
            facts = {"schemaSha256": self.backend["schemaSha256"],
                     "processes": {**self.backend["processes"], "core": self.core_witness}}
            self.backend = {**facts, "backendFingerprint": content_hash(facts)}
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "web-cccccccccccc-reapply",
                     "targetKey": "pitant-warpdrive", "backendFingerprint": self.backend["backendFingerprint"],
                     "qualificationSha256": "f" * 64, "before": old, "after": active}
        rollout_web(self.plan, state_dir=self.state, target=Target(self.plan), initialize=True,
                    clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.chain = {"targetKey": self.plan["targetKey"], "backendFingerprint": self.plan["backendFingerprint"],
                      "acceptedOperationId": self.plan["operationId"], "acceptedPlanSha256": content_hash(self.plan),
                      "active": {"slot": active, "alias": C.target, "provenance": {}, "receiptSha256": "1" * 64},
                      "previous": {"slot": old, "alias": B.target, "provenance": {}, "receiptSha256": "2" * 64}}
        self.binding = {"backend": self.original_backend, "backendPins": {}, "daemon": {"serverId": "owned-fixture"},
                        "inputs": {"networkIds": NETWORK_IDS, "runtimeSecret": RUNTIME_SECRET, "successorRelayAlias": RELAY,
                                   "edgeIP": PEER, "publicIP": "127.0.0.1", "publicStorageIP": "127.0.0.2", "version": "1.6.1",
                                   "installedRouteBytes": "{}", "installedRouteSha256": "9" * 64},
                        "incumbent": {"relay": {"id": "7" * 64, "imageId": self.relay["imageId"], "alias": "old-unavailable-relay"}}}
        self.core_profile = None if self.core_alias is None else {
            "schemaVersion": 1, "kind": "warpdrive-installed-retained-core",
            "originalBindingSha256": content_hash(self.binding), "acceptedChainSha256": content_hash(self.chain),
            "corePin": self.core_pin, "coreWitness": self.core_witness,
        }
        self.release = {"fixtureRelease": True}
        self.loaded = {"kind": "warpdrive-installed-web-image-load", "state": "verified",
                       "sourceRevision": self.runtime_d["sourceRevision"], "imageId": self.runtime_d["imageId"],
                       "manifestDigest": self.runtime_d["imageId"], "daemon": self.binding["daemon"]}
        relay_doc = {"fixtureRelay": True}
        self.stage_receipts = {self.first / "relay/stage-ready.json": {"id": self.relay["id"], "alias": RELAY,
                  "configSha256": content_hash(relay_doc), "qualificationSha256": content_hash(self.binding), "runtime": self.relay},
            self.operation / "candidate/stage-ready.json": {"id": self.runtime_d["runtimeId"], "alias": D.target,
                  "configSha256": content_hash(self.doc_d), "qualificationSha256": content_hash(self.release),
                  "runtime": {key: value for key, value in self.runtime_d.items() if key != "schemaSha256"}}}
        self.enterContext(patch.object(successor, "read_record", side_effect=self.stage_receipts.__getitem__))
        for name, value in (("create_document", relay_doc), ("verify_running", self.relay), ("_relay_admin", self.admin),
                            ("compile_traefik_web_handoff", {}), ("verify_accepted_traefik_web_handoff", None),
                            ("network_peer", "10.0.8.8"), ("read_direct_web", True), ("observe_direct_failure", None)):
            self.enterContext(patch.object(successor, name, return_value=value))
        self.backend_observer = self.enterContext(patch.object(successor, "observe_backend", side_effect=self.observe_backend))
        self.enterContext(patch.object(successor, "read_autosave", side_effect=lambda _: deepcopy(self.admin.persisted)))
        self.web = self.enterContext(patch.object(successor, "TlsProbe", return_value=lambda *_a, **_k: SimpleNamespace(status=200, body=b'{"ok":true}')))
        self.public = self.enterContext(patch.object(successor, "probe_public", return_value=PublicProbe("after", "after", True, True, True, True, True)))
        self.install = self.build(self.core_profile)

    def observe_backend(self, _docker, _pins, **options):
        self.assertEqual(options, {} if self.core_alias is None else {"core_pin": self.core_pin})
        return self.backend

    def build(self, profile, pin=None):
        return successor.InstalledWebSuccessor(self.docker, first=self.first, operation=self.operation,
            binding=self.binding, expected_binding_sha256=content_hash(self.binding), chain=self.chain,
            chain_sha256=content_hash(self.chain), watched=self.watched, preimage=self.preimage, retained_core=profile,
            expected_retained_core_sha256=(pin or content_hash(profile)) if profile is not None else pin)

    def options(self):
        return {"loaded": self.loaded, "alias": D.target, "revision": self.runtime_d["sourceRevision"], "release": self.release}

    def test_stable_relay_accepts_oci_index_and_exact_available_running_child(self):
        self.assertNotEqual(self.image["Id"], self.manifest["digest"])
        self.assertEqual(self.install.relay_manifest, self.manifest)
        self.assertEqual(successor._relay_manifest(self.docker, self.relay), self.manifest)

    def test_stable_relay_rejects_wrong_index_unavailable_or_ambiguous_child(self):
        original = deepcopy(self.image)
        for mutate in (
            lambda image: image["Descriptor"].update(digest=self.manifest["digest"]),
            lambda image: image["Manifests"][0].update(Available=False),
            lambda image: image["Manifests"][0].update(ID=image["Id"]),
            lambda image: image["Manifests"][0].update(Descriptor={**self.manifest, "size": 53}),
            lambda image: image["Manifests"][0].update(ImageData={"Platform": {"os": "linux", "architecture": "arm64"}}),
            lambda image: image["Manifests"].append(deepcopy(image["Manifests"][0])),
        ):
            self.image = deepcopy(original)
            mutate(self.image)
            with self.assertRaisesRegex(WebRuntimeError, "stable relay|Stable relay"):
                successor._relay_manifest(self.docker, self.relay)

    def test_stable_relay_still_accepts_exact_single_platform_target(self):
        direct = {**self.manifest, "digest": self.relay["imageId"]}
        self.rows[self.relay["id"]]["ImageManifestDescriptor"] = direct
        self.image = {"Id": direct["digest"], "Descriptor": {key: direct[key] for key in ("digest", "mediaType", "size")}}
        self.assertEqual(successor._relay_manifest(self.docker, self.relay), direct)

    def test_stage_from_verified_live_c_then_promote_reverse_reapply_without_a(self):
        with patch.object(successor, "start_private", return_value=self.stage_receipts[self.operation / "candidate/stage-ready.json"]) as stage:
            self.install.stage(**self.options())
        self.assertEqual(stage.call_args.kwargs["document"], self.doc_d)
        controller = self.install.controller(**self.options(), verify_release=lambda _plan, *, initialize: not initialize)
        expected = compile_repeat_web_configs(self.preimage, expected_sha256=sha256(self.preimage).hexdigest(), host=HOST,
            traefik_ip=PEER, relay_alias=RELAY, current=C, previous=B, candidate=D, core_alias=self.core_alias)
        for action, config in (("promote", "after"), ("rollback", "manualRollback"), ("reapply", "after")):
            result = controller.run(action, clock=self.clock.monotonic, sleep=self.clock.sleep)
            self.assertEqual(result["state"], "accepted")
            self.assertEqual(self.admin.live, expected[config])
        self.assertEqual(self.admin.writes, [expected[key] for key in ("after", "manualRollback", "after")])
        self.assertEqual(set(self.inspected), {"b" * 64, "c" * 64, "d" * 64, self.relay["id"]})

    def test_stage_holds_on_live_durable_or_retained_runtime_drift_before_create(self):
        with patch.object(successor, "start_private") as stage:
            self.admin.persisted = {}
            with self.assertRaisesRegex(WebRuntimeError, "persisted predecessor"):
                self.install.stage(**self.options())
            self.admin.persisted = self.current
            self.rows["c" * 64]["Config"]["Labels"][OWNER_LABEL] = "foreign"
            with self.assertRaisesRegex(WebRuntimeError, "admitted Web slot"):
                self.install.stage(**self.options())
            stage.assert_not_called()

    def test_same_relay_observation_uses_one_web_destination_and_direct_realtime(self):
        with patch.object(successor, "network_peer", side_effect=("10.0.8.20", "10.0.8.21")), patch.object(successor, "observe_route_hints") as read:
            self.install._route_hints(self.backend)
        self.assertEqual(read.call_args.kwargs["web_peers"], {"10.0.8.20": f"http://{RELAY}:8080"})
        self.assertEqual(read.call_args.kwargs["realtime_peers"], {"10.0.8.21": "http://ws:8080"})
        self.assertNotIn(self.binding["incumbent"]["relay"]["id"], self.inspected)

    def test_non_candidate_public_failure_holds_and_confirmed_candidate_can_restore(self):
        self.public.return_value = PublicProbe("after", "after", False, True, True, True, True)
        with self.assertRaises(SwitchHeld):
            self.install._public_health(self.runtime_d, self.backend, failure=lambda: None)
        self.assertIs(self.install._public_health(self.runtime_d, self.backend, failure=lambda: True), False)
        with self.assertRaises(SwitchHeld):
            self.install._public_health(self.plan["after"]["runtime"], self.backend, failure=lambda: self.fail("C is retained"))

    def test_unresolved_existing_route_journal_holds_before_private_create(self):
        journal = self.state / "web-rollouts" / "another.json"
        _write_state(journal, {"plan": {**self.plan, "operationId": "another"}, "state": "switch-intent"})
        with patch.object(successor, "start_private") as stage:
            with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
                self.install.stage(**self.options())
            stage.assert_not_called()

    def test_protected_backend_drift_holds_before_candidate_document(self):
        self.backend = {**self.backend, "schemaSha256": "0" * 64}
        with self.assertRaisesRegex(WebRuntimeError, "Protected original backend"):
            self.install.stage(**self.options())


class InstalledCoreWebSuccessorTests(InstalledWebSuccessorTests):
    core_alias = "warpdrive-core-fixture"

    def test_unmatched_core_authority_and_network_hold_before_staging(self):
        with self.assertRaisesRegex(WebRuntimeError, "protected backend.*current Web chain"):
            self.build(None)
        with self.assertRaisesRegex(WebRuntimeError, "independently admitted"):
            self.build(self.core_profile, "0" * 64)
        wrong_chain = {**self.core_profile, "acceptedChainSha256": "0" * 64}
        with self.assertRaisesRegex(WebRuntimeError, "independently admitted"):
            self.build(wrong_chain)
        changed = deepcopy(self.core_profile)
        changed["corePin"]["database"]["networkId"] = "0" * 64
        with self.assertRaisesRegex(WebRuntimeError, "admitted installation networks"):
            self.build(changed)
        self.backend_observer.assert_not_called()
