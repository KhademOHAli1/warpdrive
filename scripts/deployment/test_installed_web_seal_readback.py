"""Read back a sealed functional rollout after loss of the operator response."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from installed_web_chain import REPOSITORY, _generation as read_generation
from installed_web_lineage import _generation
from installed_web_seal_readback import observe_functional_seal, read_seal_acknowledgement
from test_web_rollout import slot
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, canonical, content_hash


def generation_bytes(plan, position, provenance):
    return canonical(_generation(plan, position, plan[position]["runtime"]["name"], provenance)) + b"\n"


def source_provenance(source, identity):
    return {"repository": REPOSITORY, "revision": source, "manifestSha256": identity * 64,
            "archiveSha256": identity * 64, "testedConfigDigest": "sha256:" + identity * 64,
            "authoritySha256": identity * 64}


class FunctionalSealReadbackTests(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.state, self.operation = directory / "state", directory / "operation"
        self.journals, self.output = self.state / "web-rollouts", self.operation / "lineage"
        for path in (self.state, self.operation, self.journals, self.output):
            path.mkdir(mode=0o700)
        before, old, current = (slot(number, name, name) for number, name in zip("123", "abc", strict=True))
        for leaf in (before, old, current):
            revision = leaf["runtime"]["sourceRevision"]
            leaf["runtime"]["name"] = "warpdrive-web-" + revision[:12]
        reverse = {**old, "route": {**old["route"], "fingerprint": "d" * 64}}
        common = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "targetKey": "installed",
                  "backendFingerprint": "a" * 64}
        prior = {**common, "operationId": "web-bbbbbbbbbbbb-reapply", "qualificationSha256": "b" * 64,
                 "before": before, "after": old}
        self.journal(prior)
        old_provenance = source_provenance(old["runtime"]["sourceRevision"], "e")
        old_raw = generation_bytes(prior, "after", old_provenance)
        old_pin = sha256(old_raw).hexdigest()
        old_file = directory / "prior.json"
        old_file.write_bytes(old_raw)
        old_file.chmod(0o400)
        predecessor = {"targetKey": "installed", "backendFingerprint": "a" * 64,
                       "acceptedOperationId": prior["operationId"], "acceptedPlanSha256": content_hash(prior),
                       "active": read_generation(old_file, old_pin, prior, "after"),
                       "previous": {"slot": before}}
        self.install = SimpleNamespace(operation=self.operation, state=self.state, chain=predecessor,
                                       chain_sha256=content_hash(predecessor))
        self.revision = current["runtime"]["sourceRevision"]
        new_provenance = source_provenance(self.revision, "f")
        self.authority = new_provenance["authoritySha256"]
        artifact = {key: new_provenance[key] for key in ("manifestSha256", "archiveSha256")}
        self.release = {"revision": self.revision, "image": {"imageId": new_provenance["testedConfigDigest"]},
                        "provenance": {"bundleManifestSha256": artifact["manifestSha256"], "archiveSha256": artifact["archiveSha256"]}}
        self.loaded = {**self.release["provenance"], "sourceRevision": self.revision,
                       "imageId": current["runtime"]["imageId"], "testedConfigDigest": new_provenance["testedConfigDigest"]}
        qualification = content_hash({"installedChainSha256": self.install.chain_sha256,
                                      "releaseQualificationSha256": content_hash(self.release)})
        common["qualificationSha256"] = qualification
        self.plans = {
            "promote": {**common, "operationId": "web-cccccccccccc", "before": old, "after": current},
            "rollback": {**common, "operationId": "web-cccccccccccc-rollback", "before": current, "after": reverse},
            "reapply": {**common, "operationId": "web-cccccccccccc-reapply", "before": reverse, "after": current},
        }
        for plan in self.plans.values():
            self.journal(plan)
        self.controller = SimpleNamespace(plan=lambda phase: deepcopy(self.plans[phase]))
        final = self.plans["reapply"]
        self.plan_pin = content_hash(final)
        _write_state(self.state / "accepted-web-generation.json", _record(final, final["after"]))
        for side, raw in (("active", generation_bytes(final, "after", new_provenance)), ("previous", old_raw)):
            self.seal(side, raw)
        chain = {key: final[key] for key in ("targetKey", "backendFingerprint")}
        chain.update(acceptedOperationId=final["operationId"], acceptedPlanSha256=self.plan_pin)
        for side, position in (("active", "after"), ("previous", "before")):
            path = self.output / (side + ".json")
            chain[side] = read_generation(path, sha256(path.read_bytes()).hexdigest(), final, position)
        self.index = {"schemaVersion": 1, "kind": "warpdrive-functional-installed-web-lineage", **{
            key: chain[key] for key in ("targetKey", "backendFingerprint", "acceptedOperationId", "acceptedPlanSha256")},
            "predecessorChainSha256": self.install.chain_sha256, "liveConfigSha256": current["route"]["fingerprint"],
            "activeSha256": chain["active"]["receiptSha256"], "previousSha256": old_pin, "chainSha256": content_hash(chain)}
        self.seal("chain", canonical(chain))
        self.seal("accepted-plan", canonical(final))
        self.seal("lineage", canonical(self.index) + b"\n")
        self.observed = {"beforeRuntime": old["runtime"], "afterRuntime": current["runtime"],
                         "backendFingerprint": common["backendFingerprint"], "route": current["route"],
                         "aliases": {current["route"]["generation"]: current["runtime"]["name"],
                                     old["route"]["generation"]: old["runtime"]["name"]},
                         "liveConfigSha256": current["route"]["fingerprint"], "autosaveConfigSha256": current["route"]["fingerprint"],
                         "publicSourceRevision": self.revision, "publicHealthy": True, "ingressReady": True}

    def seal(self, name, raw):
        file = self.output / (name + ".json")
        file.write_bytes(raw)
        file.chmod(0o400)

    def journal(self, plan):
        _write_state(self.journals / (plan["operationId"] + ".json"), {"plan": plan, "state": "accepted"})

    def observe(self):
        return read_seal_acknowledgement(self.install, controller=self.controller, expected_plan_sha256=self.plan_pin,
                                        loaded=self.loaded, release=self.release, publication_sha256=self.authority,
                                        observe_installed=lambda: self.observed)

    def test_readback_recovers_exact_terminal_seal_without_writes(self):
        before = {file: (file.stat(), file.read_bytes()) for root in (self.state, self.output)
                  for file in root.rglob("*.json")}
        self.assertEqual(self.observe(), {"state": "sealed", "sourceRevision": self.revision, "lineage": self.index})
        after = {file: (file.stat(), file.read_bytes()) for file in before}
        for file, (status, data) in before.items():
            current, raw = after[file]
            self.assertEqual(raw, data)
            self.assertEqual((current.st_ino, current.st_mtime_ns), (status.st_ino, status.st_mtime_ns))

    def test_missing_index_never_repairs_or_recreates_it(self):
        index = self.output / "lineage.json"
        index.unlink()
        with self.assertRaisesRegex(SwitchConflict, "completed functional Web seal inventory"):
            self.observe()
        self.assertFalse(index.exists())

    def test_wrong_live_route_or_public_identity_refuses_readback(self):
        self.observed["publicSourceRevision"] = "b" * 40
        with self.assertRaisesRegex(SwitchConflict, "Native functional seal observation differs"):
            self.observe()

    def test_native_observer_uses_exact_direct_slots_and_public_get(self):
        plan = self.plans["reapply"]
        document = {"route": "functional"}
        plan["after"]["route"]["fingerprint"] = content_hash(document)
        self.install.inputs = {"networkIds": {}, "runtimeSecret": "fixture", "version": "1.6.1"}
        self.install.network = "fixture-network"
        self.install.relay_dir = self.state / "relay"
        backend = {"schemaSha256": "c" * 64, "backendFingerprint": plan["backendFingerprint"]}
        self.install._retained = Mock(return_value=(backend, {}))
        self.install.admin = SimpleNamespace(config=Mock(return_value=(document, "fixture-etag")))
        slots = (plan["before"], plan["after"])
        rows = {slot["runtime"]["runtimeId"]: {"Id": slot["runtime"]["runtimeId"], "Image": slot["runtime"]["imageId"],
                "State": {"Running": True, "Pid": index + 100, "StartedAt": "fixture",
                          "Health": {"Status": "healthy"}}, "RestartCount": 0}
                for index, slot in enumerate(slots)}
        self.install.docker = SimpleNamespace(inspect=lambda identifier: deepcopy(rows[identifier]))
        module = "installed_web_seal_readback"
        with patch(f"{module}.read_autosave", return_value=document), \
                patch(f"{module}.read_admitted_web_slot") as admitted, \
                patch(f"{module}.network_peer", return_value="127.0.0.1") as peer, \
                patch(f"{module}.read_direct_web", return_value=True) as direct, \
                patch("installed_web_rollout_readback.read_public_web_health", return_value=True) as public:
            result = observe_functional_seal(self.install, plan)
            self.assertEqual(result["publicSourceRevision"], self.revision)
            self.assertEqual(result["liveConfigSha256"], plan["after"]["route"]["fingerprint"])
            self.assertEqual(admitted.call_count, 2)
            self.assertEqual(peer.call_count, 2)
            self.assertEqual(direct.call_count, 2)
            public.assert_called_once_with(self.install, self.revision)
            public.side_effect = lambda *_: rows[plan["after"]["runtime"]["runtimeId"]]["State"].update(Pid=400) or True
            with self.assertRaisesRegex(SwitchConflict, "changed during observation"):
                observe_functional_seal(self.install, plan)
