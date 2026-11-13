"""Verify a same-generation Core projection preserves original Web evidence."""

from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from installed_core_activation import reconcile_initial_core_route
from installed_core_lineage import project_initial_core_lineage, verify_projected_core_predecessor
from installed_web_chain import REPOSITORY, _state, admit_installed_web_chain
from test_caddy_web_repeat import A, B, HOST, PEER, RELAY, installed_after_first_switch
from test_installed_web_target import Admin
from test_web_rollout import slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, _lock, canonical, content_hash


class InitialCoreLineageTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.state = root / "state"
        self.state.mkdir(mode=0o700)
        self.operations = self.state / "web-rollouts"
        self.operations.mkdir(mode=0o700)
        self.pointer = self.state / "accepted-web-generation.json"
        self.journal = self.operations / "web-first-reapply.json"
        self.config = installed_after_first_switch()
        before, after = slot("1", "a", "a"), slot("2", "b", "b")
        after["route"]["fingerprint"] = content_hash(self.config)
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "web-first-reapply",
                     "targetKey": "installed", "before": before, "after": after,
                     "backendFingerprint": "c" * 64, "qualificationSha256": "d" * 64}
        _write_state(self.pointer, _record(self.plan, after))
        _write_state(self.journal, {"plan": self.plan, "state": "accepted"})
        self.active_path, self.previous_path = root / "active.json", root / "previous.json"
        self.active_hash = self.receipt(self.active_path, after, B.target, "b")
        self.previous_hash = self.receipt(self.previous_path, before, A.target, "a")
        self.chain = admit_installed_web_chain(
            self.state, plan=self.plan, active=self.active_path, previous=self.previous_path,
            expected_active_sha256=self.active_hash, expected_previous_sha256=self.previous_hash,
        )
        self.plan_hash, self.chain_hash = content_hash(self.plan), content_hash(self.chain)
        self.authority_hash, self.backend_hash, self.route_hash = "e" * 64, "f" * 64, "3" * 64
        self.binding = {"schemaVersion": 1, "kind": "warpdrive-installed-core-activation", "targetKey": "installed",
                        "acceptedChainSha256": self.chain_hash, "coreAuthoritySha256": self.authority_hash,
                        "oldBackendFingerprint": self.plan["backendFingerprint"], "newBackendFingerprint": self.backend_hash,
                        "oldRouteSha256": after["route"]["fingerprint"], "newRouteSha256": self.route_hash}
        self.terminal = {**self.binding, "state": "route-verified-lineage-pending"}
        self.activation_hash = content_hash(self.binding)
        self.activation_id = "core-activation-" + self.activation_hash[:40]

    def receipt(self, path, slot, alias, digest):
        runtime = slot["runtime"]
        record = {"schemaVersion": 1, "kind": "warpdrive-installed-web-generation", "targetKey": "installed",
                  "backendFingerprint": self.plan["backendFingerprint"], "runtime": runtime, "alias": alias,
                  "provenance": {"repository": REPOSITORY, "revision": runtime["sourceRevision"],
                                 "manifestSha256": digest * 64, "archiveSha256": digest * 64,
                                 "testedConfigDigest": "sha256:" + digest * 64, "authoritySha256": digest * 64}}
        raw = json.dumps(record, indent=2).encode() + b"\n"
        path.write_bytes(raw)
        path.chmod(0o400)
        self.assertNotEqual(raw, canonical(record) + b"\n")
        return sha256(raw).hexdigest()

    def project(self, **overrides):
        arguments = {"accepted_plan": self.plan, "expected_plan_sha256": self.plan_hash,
                     "accepted_chain": self.chain, "expected_chain_sha256": self.chain_hash,
                     "activation_binding": self.binding, "activation_record": self.terminal,
                     "expected_activation_operation_id": self.activation_id,
                     "expected_activation_plan_sha256": self.activation_hash,
                     "expected_core_authority_sha256": self.authority_hash,
                     "expected_core_backend_fingerprint": self.backend_hash}
        return project_initial_core_lineage(**(arguments | overrides))

    def test_changes_only_active_route_and_backend_without_mutating_inputs_or_raw_receipts(self):
        evidence = (self.active_path, self.previous_path, self.pointer, self.journal)
        raw = [path.read_bytes() for path in evidence]
        result = self.project()
        expected_chain = deepcopy(self.chain)
        expected_chain["backendFingerprint"] = self.backend_hash
        expected_chain["active"]["slot"]["route"]["fingerprint"] = self.route_hash
        self.assertEqual(result.chain, expected_chain)
        self.assertEqual(result.accepted_pointer, _record(expected_chain, expected_chain["active"]["slot"]))
        self.assertEqual(result.chain["active"]["receiptSha256"], self.active_hash)
        self.assertEqual(result.chain["previous"]["receiptSha256"], self.previous_hash)
        self.assertEqual(result.original_chain_sha256, self.chain_hash)
        self.assertEqual(content_hash(self.plan), self.plan_hash)
        self.assertEqual(content_hash(self.chain), self.chain_hash)
        self.assertEqual(content_hash(self.binding), self.activation_hash)
        self.assertEqual([path.read_bytes() for path in evidence], raw)
        result.accepted_pointer["slot"]["runtime"]["running"] = False
        self.assertTrue(result.chain["active"]["slot"]["runtime"]["running"])
        result.chain["active"]["slot"]["runtime"]["running"] = False
        self.assertTrue(self.chain["active"]["slot"]["runtime"]["running"])

    def test_rejects_unpinned_history_and_protected_activation_ids(self):
        for field in ("expected_plan_sha256", "expected_chain_sha256", "expected_activation_plan_sha256",
                      "expected_activation_operation_id", "expected_core_authority_sha256", "expected_core_backend_fingerprint"):
            with self.subTest(field=field), self.assertRaises(SwitchConflict):
                self.project(**{field: "0" * 64})

    def test_refuses_lookalike_or_nonterminal_activation_record(self):
        for record in ({**self.terminal, "state": "switch-intent"},
                       {**self.terminal, "state": "accepted"},
                       {**self.terminal, "newRouteSha256": "4" * 64},
                       {**self.terminal, "schemaVersion": True},
                       {**self.terminal, "operationId": self.activation_id},
                       {"payload": self.terminal, "sha256": content_hash(self.terminal)}):
            with self.subTest(record=record), self.assertRaisesRegex(SwitchConflict, "lineage-pending journal"):
                self.project(activation_record=record)

    def test_refuses_bindings_that_change_scope_or_reuse_the_old_route_even_when_rehashed(self):
        for change in ({"targetKey": "another-target"}, {"acceptedChainSha256": "4" * 64},
                       {"oldBackendFingerprint": "4" * 64}, {"oldRouteSha256": "4" * 64},
                       {"newRouteSha256": self.binding["oldRouteSha256"]},
                       {"newRouteSha256": self.plan["before"]["route"]["fingerprint"]},
                       {"coreAuthoritySha256": "4" * 64}, {"newBackendFingerprint": self.plan["backendFingerprint"]}):
            binding = self.binding | change
            digest = content_hash(binding)
            with self.subTest(change=change), self.assertRaisesRegex(SwitchConflict, "activation binding"):
                self.project(activation_binding=binding, activation_record={**binding, "state": self.terminal["state"]},
                             expected_activation_plan_sha256=digest, expected_activation_operation_id="core-activation-" + digest[:40])

    def test_refuses_forged_legacy_receipt_alias_slot_or_artifact_provenance(self):
        active = self.chain["active"]
        for changed, message in (
            ({**active, "receiptSha256": "x" * 64}, "receipt pin"),
            ({**active, "receiptSha256": self.previous_hash}, "Distinct historical Web"),
            ({**active, "receiptSha256": "4" * 64}, "chain digest differs"),
            ({**active, "alias": A.target}, "Distinct historical Web"),
            ({**active, "alias": "bad/alias"}, "invalid alias"),
            ({**active, "slot": self.plan["before"]}, "slot differs"),
            ({**active, "slot": {**active["slot"], "runtime": {**active["slot"]["runtime"], "running": 1}}}, "runtime identity"),
            ({**active, "provenance": {**active["provenance"], "repository": "untrusted/warpdrive"}}, "artifact provenance"),
            ({**active, "provenance": {**active["provenance"], "revision": "c" * 40}}, "artifact provenance"),
            ({**active, "provenance": {**active["provenance"], "testedConfigDigest": "4" * 64}}, "artifact provenance"),
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(SwitchConflict, message):
                self.project(accepted_chain={**self.chain, "active": changed})

    def test_consumes_the_actual_activation_journal_without_accepting_or_replaying(self):
        original = self.state.parent / "original"
        original.mkdir(mode=0o700)
        (original / "production-operation.lock").touch(mode=0o600)
        clock, admin = FakeClock(), Admin(self.config)
        receipt = reconcile_initial_core_route(
            original, self.state, predecessor=self.plan, chain=self.chain, expected_chain_sha256=self.chain_hash,
            installed_bytes=canonical(self.config), core_backend_fingerprint=self.backend_hash,
            core_authority_sha256=self.authority_hash, host=HOST, traefik_ip=PEER, relay_alias=RELAY,
            core_alias="warpdrive-core-fixture", admin=admin, read_durable_config=lambda: admin.persisted,
            verify_authority=lambda _: True, observe_core=lambda: self.backend_hash, observe_public=lambda *_: True,
            clock=clock.monotonic, sleep=clock.sleep,
        )
        journal = self.operations / (receipt["operationId"] + ".json")
        terminal = _state(journal)
        record = journal.read_bytes()
        binding = {key: terminal[key] for key in self.binding}
        result = self.project(activation_binding=binding, activation_record=terminal,
                              expected_activation_operation_id=receipt["operationId"],
                              expected_activation_plan_sha256=receipt["planSha256"])
        self.assertEqual(result.accepted_pointer["slot"]["route"]["fingerprint"], content_hash(admin.live))
        self.assertEqual(admin.writes, [admin.live])
        self.assertEqual(_state(self.pointer), _record(self.plan, self.plan["after"]))
        self.assertEqual(journal.read_bytes(), record)

    def accept_fixture(self):
        projection = self.project()
        self.accepted_path = self.state / (self.activation_id + "-lineage-accepted.json")
        self.seal_path = self.state / (self.activation_id + "-lineage-projection.json")
        self.pending_path = self.operations / (self.activation_id + ".json")
        self.seal = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-projection",
                     "activationOperationId": self.activation_id, "activationPlanSha256": self.activation_hash,
                     "coreAuthoritySha256": self.authority_hash, "originalChainSha256": self.chain_hash,
                     "projectedChainSha256": content_hash(projection.chain), "projectedChain": projection.chain,
                     "projectedPointer": projection.accepted_pointer}
        self.acceptance = {"schemaVersion": 1, "kind": "warpdrive-installed-core-lineage-accepted",
                           "activationBinding": self.binding, "projectionSealSha256": content_hash(self.seal),
                           "projectedChainSha256": content_hash(projection.chain), "activationOperationId": self.activation_id}
        _write_state(self.seal_path, self.seal)
        _write_state(self.accepted_path, self.acceptance)
        _write_state(self.pending_path, self.terminal)
        self.projected = projection

    def verify(self, **overrides):
        options = {"chain": self.projected.chain, "activation_operation_id": self.activation_id,
                   "expected_activation_lineage_sha256": content_hash(self.acceptance)}
        with _lock(self.state):
            return verify_projected_core_predecessor(self.state, **(options | overrides))

    def test_reads_accepted_lineage_with_and_without_exact_pending_hold_independently_of_pointer(self):
        self.accept_fixture()
        paths = (self.accepted_path, self.seal_path, self.pending_path, self.journal, self.active_path, self.previous_path)
        raw = [path.read_bytes() for path in paths]
        self.assertEqual(self.verify(), self.projected)
        self.assertEqual(_state(self.pointer), _record(self.plan, self.plan["after"]))
        self.assertEqual([path.read_bytes() for path in paths], raw)
        self.pending_path.unlink()
        self.pointer.unlink()
        self.assertEqual(self.verify(), self.projected)

    def test_refuses_missing_or_unpinned_acceptance_and_untrusted_operation_name(self):
        self.accept_fixture()
        for overrides in ({"expected_activation_lineage_sha256": "a" * 64},
                          {"activation_operation_id": "../" + self.activation_id},
                          {"activation_operation_id": "core-activation-" + "F" * 40},
                          {"chain": self.chain}):
            with self.subTest(overrides=overrides), self.assertRaises(SwitchConflict):
                self.verify(**overrides)
        self.accepted_path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_refuses_rechecksummed_seal_and_fully_repinned_inconsistent_seal(self):
        self.accept_fixture()
        forged = deepcopy(self.seal)
        forged["projectedPointer"]["slot"]["route"]["fingerprint"] = "4" * 64
        _write_state(self.seal_path, forged, previous=self.seal)
        with self.assertRaisesRegex(SwitchConflict, "projection seal differs"):
            self.verify()
        repinned = self.acceptance | {"projectionSealSha256": content_hash(forged)}
        _write_state(self.accepted_path, repinned, previous=self.acceptance)
        with self.assertRaisesRegex(SwitchConflict, "projection differs from the historical rollout"):
            self.verify(expected_activation_lineage_sha256=content_hash(repinned))

    def test_refuses_forged_or_nonterminal_original_journals(self):
        self.accept_fixture()
        pending = {**self.terminal, "state": "switch-intent"}
        _write_state(self.pending_path, pending, previous=self.terminal)
        with self.assertRaisesRegex(SwitchConflict, "lineage-pending journal"):
            self.verify()
        self.pending_path.unlink()
        old = {"plan": self.plan, "state": "accepted"}
        nonterminal = old | {"state": "switch-intent"}
        _write_state(self.journal, nonterminal, previous=old)
        with self.assertRaisesRegex(SwitchConflict, "never accepted"):
            self.verify()
        edited = {"plan": {**self.plan, "qualificationSha256": "0" * 64}, "state": "accepted"}
        _write_state(self.journal, edited, previous=nonterminal)
        with self.assertRaisesRegex(SwitchConflict, "historical Web plan digest differs"):
            self.verify()

    def test_refuses_rebound_acceptance_id_and_unapproved_protected_paths(self):
        self.accept_fixture()
        forged = self.acceptance | {"activationBinding": self.binding | {"newRouteSha256": "4" * 64}}
        _write_state(self.accepted_path, forged, previous=self.acceptance)
        with self.assertRaisesRegex(SwitchConflict, "operation differs from its binding"):
            self.verify(expected_activation_lineage_sha256=content_hash(forged))
        _write_state(self.accepted_path, self.acceptance, previous=forged)
        link = self.state / "other-acceptance.json"
        os.link(self.accepted_path, link)
        with self.assertRaisesRegex(SwitchConflict, "private installed Web chain file"):
            self.verify()
        link.unlink()
        self.pending_path.unlink()
        self.pending_path.symlink_to(self.state / "missing")
        with self.assertRaises(OSError):
            self.verify()


if __name__ == "__main__":
    unittest.main()
