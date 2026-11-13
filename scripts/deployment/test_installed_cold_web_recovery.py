"""Combine real protected state, lock and storage guards with owned native rows."""

from copy import deepcopy
from hashlib import sha256
import json
import os
import unittest
from unittest.mock import patch

from caddy_web_config import ADMIN_SOCKET
import installed_cold_ingress_route as ingress
import installed_cold_relay_storage as relay
import installed_cold_web_recovery as recovery
from installed_core_lineage import project_initial_core_lineage
from installed_core_lineage_seal import initial_core_lineage_acceptance
from installed_web_chain import REPOSITORY
from installed_web_readback_lock import _existing_lock
from installed_web_relay import AUTOSAVE_FILE, INGRESS, create_document
from recovery import RecoveryError
import test_installed_cold_web_slots as slot_fixture
from test_traefik_web_handoff import NEW, OLD, handoff, installed_overlay
from traefik_web_handoff_state import (
    HandoffObservation, JOURNAL_FILE, ROUTE_FILE, _locked_directory, apply_traefik_web_handoff,
)
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, content_hash


class InstalledColdWebRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.slots = slot_fixture.InstalledColdWebSlotsTests()
        self.addCleanup(self.slots.doCleanups)
        self.slots.setUp()
        self.private = self.slots.root / "private"
        self.private.chmod(0o700)
        self.original = self.slots.release
        self.first = self.private / ("first-web-release-" + NEW.removeprefix("warpdrive-web-relay-"))
        self.state = self.first / "rollout"
        self.operations = self.state / "web-rollouts"
        self.watched = self.slots.root / "watched"
        for directory in (self.first, self.state, self.operations, self.watched):
            directory.mkdir(mode=0o700)
        self.production_lock = self.original / "production-operation.lock"
        self.target_lock = self.state / "target.lock"
        for path in (self.production_lock, self.target_lock):
            path.touch(mode=0o600)
        self.enterContext(patch.multiple(recovery, INSTALLED_PRIVATE_ROOT=self.private, INSTALLED_WATCHED_DIRECTORY=self.watched))
        self.enterContext(patch.multiple(ingress, INSTALLED_PRIVATE_ROOT=self.private, INSTALLED_WATCHED_DIRECTORY=self.watched))
        self.enterContext(patch.multiple(relay, INSTALLED_PRIVATE_ROOT=self.private, _ROOT_UID=os.geteuid(), _ROOT_GID=os.getegid(),
                                         _RELAY_UID=os.geteuid(), _RELAY_GID=os.getegid()))
        self.enterContext(patch("installed_web_relay._directory", side_effect=lambda path, _uid: path.lstat()))

        self.relay_dir = self.first / "relay"
        for subdirectory in ("", "config", "config/caddy", "socket"):
            (self.relay_dir / subdirectory).mkdir(mode=0o700)
        self.autosave = self.relay_dir / "config" / AUTOSAVE_FILE
        self.caddy = {"admin": {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}}, "apps": {}}
        self.set_autosave(self.caddy)
        self.relay_id, self.image_id = "f" * 64, "sha256:" + "e" * 64
        self.manifest = {"mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": self.image_id,
                         "size": 512, "platform": {"os": "linux", "architecture": "amd64"}}
        self.networks = self.slots.cold_networks
        self.ingress_id = self.networks[INGRESS]["Id"]
        doc = create_document(self.relay_dir, alias=NEW, image=self.image_id, ingress_id=self.ingress_id)
        self.relay_row = {"Id": self.relay_id, "Name": "/" + NEW, "Image": self.image_id, "ImageManifestDescriptor": self.manifest,
                          "Config": {key: value for key, value in doc.items() if key not in {"HostConfig", "NetworkingConfig"}},
                          "HostConfig": doc["HostConfig"],
                          "State": {"Status": "exited", "Pid": 0, "Running": False, "ExitCode": 0, "Error": "",
                                    "OOMKilled": False, "Paused": False, "Restarting": False, "Dead": False,
                                    "StartedAt": "2026-11-13T09:00:00Z", "FinishedAt": "2026-11-13T09:02:00Z"},
                          "RestartCount": 0, "NetworkSettings": {"Networks": {INGRESS: {
                              "NetworkID": self.ingress_id, "Aliases": [NEW], "EndpointID": "", "IPAddress": "",
                          }}},
                          "Mounts": [{"Type": "bind", "Source": item["Source"], "Destination": item["Target"],
                                      "Propagation": "rprivate", "RW": True} for item in doc["HostConfig"]["Mounts"]]}
        self.inventory = {"containers": [*self.slots.cold_rows.values(), self.relay_row], "networks": self.networks}
        self.reads = 0

        self.handoff = handoff(json.dumps(installed_overlay(OLD), indent=2).encode() + b"\n")
        self.route = self.watched / ROUTE_FILE
        self.route.write_bytes(self.handoff.before_document)
        self.route.chmod(0o644)
        apply_traefik_web_handoff(self.handoff, watched_dir=self.watched, state_dir=self.state,
                                 observe=lambda: self.route_proof())
        self.ingress_sha = sha256((self.state / JOURNAL_FILE).read_bytes()).hexdigest()

        self.chain = self.slots.chain
        self.chain["active"]["slot"]["route"]["fingerprint"] = content_hash(self.caddy)
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": self.chain["acceptedOperationId"],
                     "targetKey": self.chain["targetKey"], "backendFingerprint": self.chain["backendFingerprint"],
                     "qualificationSha256": "c" * 64, "before": self.chain["previous"]["slot"],
                     "after": self.chain["active"]["slot"]}
        self.chain["acceptedPlanSha256"] = content_hash(self.plan)
        for side, character in (("active", "a"), ("previous", "b")):
            generation = self.chain[side]
            runtime = generation["slot"]["runtime"]
            generation.update(receiptSha256=character * 64, provenance={"repository": REPOSITORY,
                "revision": runtime["sourceRevision"], "testedConfigDigest": runtime["imageId"],
                **dict.fromkeys(("manifestSha256", "archiveSha256", "authoritySha256"), character * 64)})
        self.pointer = self.state / "accepted-web-generation.json"
        _write_state(self.pointer, _record(self.plan, self.plan["after"]))
        _write_state(self.operations / (self.plan["operationId"] + ".json"), {"plan": self.plan, "state": "accepted"})
        self.roots = [{"name": "caddy-autosave", "path": str(self.autosave)}]
        self.roots.extend({"name": name, "path": str(self.slots.runtime_secret if name == "database_url"
                                                    else self.slots.secrets / name)}
                          for name in sorted(slot_fixture.cold._FILE_INPUTS.values()))

    def route_proof(self):
        side = "before" if self.route.read_bytes() == self.handoff.before_document else "after"
        return HandoffObservation(side, side, True, True, True)

    def set_autosave(self, document):
        self.autosave.write_bytes(json.dumps(document).encode())
        self.autosave.chmod(0o600)

    def read_inventory(self):
        self.reads += 1
        return deepcopy(self.inventory)

    def observe(self, **overrides):
        before_stop = self.slots.preflight()
        inputs = {**self.slots.pins(), "before_stop": before_stop, "before_stop_sha256": content_hash(before_stop),
                  "relay_id": self.relay_id, "relay_image_id": self.image_id, "relay_manifest": self.manifest,
                  "ingress_handoff": self.handoff, "ingress_route_sha256": self.handoff.after_sha256,
                  "ingress_journal_sha256": self.ingress_sha, "expected_roots": self.roots,
                  "observe_inventory": self.read_inventory}
        return recovery.observe_installed_cold_web_recovery(self.original, self.state, **(inputs | overrides))

    def test_two_observations_hold_native_locks_and_return_separate_bytes(self):
        def native():
            for path in (self.production_lock, self.target_lock, self.original):
                with self.assertRaises(SwitchConflict), _existing_lock(path, (0o700,) if path == self.original else (0o600,),
                                                                       directory=path == self.original):
                    self.fail("observer released an installed lock")
            return self.read_inventory()

        with patch.object(recovery, "observe_installed_cold_ingress_route", wraps=ingress.observe_installed_cold_ingress_route) as ingress_reads:
            raw, witness = self.observe(observe_inventory=native)
        self.assertEqual(ingress_reads.call_count, 2)
        self.assertEqual(self.reads, 2)
        self.assertEqual(raw, self.handoff.after_document)
        self.assertEqual(witness["roots"], self.roots)
        self.assertEqual(witness["lineage"]["acceptedOperationId"], self.plan["operationId"])
        self.assertNotIn(str(self.route), [root["path"] for root in witness["roots"]])
        self.assertNotIn("fixture-private-password", json.dumps(witness))
        self.assertEqual(self.observe(), (raw, witness))

    def test_refuses_wrong_pin_and_changed_or_unresolved_accepted_state(self):
        for overrides in ({"chain_sha256": "0" * 64}, {"before_stop_sha256": "0" * 64},
                          {"ingress_journal_sha256": "0" * 64}, {"expected_roots": self.roots[1:]}):
            with self.subTest(overrides=overrides), self.assertRaises(RecoveryError):
                self.observe(**overrides)
        _write_state(self.pointer, _record(self.plan, self.plan["before"]), previous=_record(self.plan, self.plan["after"]))
        with self.assertRaisesRegex(RecoveryError, "current pointer"):
            self.observe()
        _write_state(self.pointer, _record(self.plan, self.plan["after"]), previous=_record(self.plan, self.plan["before"]))
        extra = {**self.plan, "operationId": "unresolved-web"}
        _write_state(self.operations / "unresolved-web.json", {"plan": extra, "state": "switch-intent"})
        with self.assertRaises(RecoveryError):
            self.observe()

    def test_inventory_drift_duplicate_id_and_peer_relay_mount_hold(self):
        def changing_inventory():
            observed = self.read_inventory()
            observed["containers"][-1]["PeerObservation"] = self.reads
            return observed

        with self.assertRaisesRegex(RecoveryError, "changed during readback"):
            self.observe(observe_inventory=changing_inventory)
        duplicate = deepcopy(self.inventory["containers"][0])
        self.inventory["containers"].append(duplicate)
        with self.assertRaisesRegex(RecoveryError, "duplicate container"):
            self.observe()
        duplicate["Id"] = "d" * 64
        duplicate["Mounts"] = [{"Type": "bind", "Source": str(self.autosave)}]
        with self.assertRaisesRegex(RecoveryError, "can access installed relay storage"):
            self.observe()

    def test_distinct_existing_ingress_locks_and_clean_network_are_required(self):
        for path in (self.watched, self.state):
            with self.subTest(path=path), _locked_directory(path), self.assertRaises(RecoveryError):
                self.observe()
        self.relay_row["NetworkSettings"]["Networks"][INGRESS]["EndpointID"] = "1" * 64
        with self.assertRaisesRegex(RecoveryError, "still attached"):
            self.observe()

    def test_foreign_alias_and_writable_source_hold_even_when_peer_name_differs(self):
        identifier, endpoint_id = "d" * 64, "9" * 64
        endpoint = {"EndpointID": endpoint_id, "Aliases": ["different-name"], "DNSNames": ["different-name"]}
        peer = {"Id": identifier, "Name": "/different-name", "Mounts": [],
                "NetworkSettings": {"Networks": {INGRESS: endpoint}}}
        self.inventory["containers"].append(peer)
        members = self.networks[INGRESS]["Containers"]
        members[identifier] = {"Name": "different-name", "EndpointID": endpoint_id}
        self.assertEqual(self.observe()[0], self.handoff.after_document)
        for field, alias in (("Aliases", NEW), ("DNSNames", self.chain["active"]["alias"])):
            with self.subTest(field=field):
                endpoint[field].append(alias.upper() + ".")
                with self.assertRaisesRegex(RecoveryError, "claims an installed Web or relay DNS alias"):
                    self.observe()
                endpoint[field].pop()
        member = members.pop(identifier)
        with self.assertRaisesRegex(RecoveryError, "missing from its bridge"):
            self.observe()
        members[identifier] = member

        for path in (self.slots.secrets, self.watched):
            mount = {"Type": "bind", "Source": str(path), "RW": True}
            peer["Mounts"] = [mount]
            with self.subTest(path=path), self.assertRaisesRegex(RecoveryError, "can write installed Web recovery sources"):
                self.observe()
            mount["RW"] = False
            self.assertEqual(self.observe()[0], self.handoff.after_document)

    def test_current_projected_core_lineage_requires_its_independent_pin_and_no_pending_hold(self):
        historical = deepcopy(self.chain)
        changed = {**self.caddy, "apps": {"http": {"servers": {"web": {}}}}}
        binding = {"schemaVersion": 1, "kind": "warpdrive-installed-core-activation", "targetKey": self.chain["targetKey"],
                   "acceptedChainSha256": content_hash(historical), "coreAuthoritySha256": "d" * 64,
                   "oldBackendFingerprint": self.plan["backendFingerprint"], "newBackendFingerprint": "e" * 64,
                   "oldRouteSha256": self.plan["after"]["route"]["fingerprint"], "newRouteSha256": content_hash(changed)}
        binding_sha = content_hash(binding)
        operation = "core-activation-" + binding_sha[:40]
        pending = {**binding, "state": "route-verified-lineage-pending"}
        projection = project_initial_core_lineage(accepted_plan=self.plan, expected_plan_sha256=content_hash(self.plan),
            accepted_chain=historical, expected_chain_sha256=content_hash(historical), activation_binding=binding,
            activation_record=pending, expected_activation_operation_id=operation, expected_activation_plan_sha256=binding_sha,
            expected_core_authority_sha256=binding["coreAuthoritySha256"], expected_core_backend_fingerprint=binding["newBackendFingerprint"])
        projected_chain_sha = content_hash(projection.chain)
        seal = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-projection", "activationOperationId": operation,
                "activationPlanSha256": binding_sha, "coreAuthoritySha256": binding["coreAuthoritySha256"],
                "originalChainSha256": content_hash(historical), "projectedChainSha256": projected_chain_sha,
                "projectedChain": projection.chain, "projectedPointer": projection.accepted_pointer}
        accepted = initial_core_lineage_acceptance(seal, binding)
        _write_state(self.state / (operation + "-lineage-projection.json"), seal)
        _write_state(self.state / (operation + "-lineage-accepted.json"), accepted)
        _write_state(self.pointer, projection.accepted_pointer, previous=_record(self.plan, self.plan["after"]))
        self.set_autosave(changed)
        self.slots.chain = projection.chain
        with self.assertRaises(RecoveryError):
            self.observe()
        pins = {"core_activation_operation_id": operation, "core_activation_lineage_sha256": content_hash(accepted)}
        self.assertEqual(self.observe(**pins)[1]["lineage"]["chainSha256"], projected_chain_sha)
        _write_state(self.operations / (operation + ".json"), pending)
        with self.assertRaises(RecoveryError):
            self.observe(**pins)


if __name__ == "__main__":
    unittest.main()
