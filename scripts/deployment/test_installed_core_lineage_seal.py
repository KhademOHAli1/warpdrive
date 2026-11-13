"""Exercise durable Core projection sealing without publishing an accepted pointer."""

from copy import deepcopy
import unittest
from unittest.mock import patch

from installed_core_lineage_seal import accept_initial_core_lineage, initial_core_lineage_acceptance, seal_initial_core_lineage
from installed_web_chain import _admit_journals, _state
from installed_web_stage import write_record
import test_installed_core_activation as fixtures
from web_rollout import _write_state
from web_switch import SwitchConflict, _envelope, content_hash


class InstalledCoreLineageSealTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture = fixtures.InstalledCoreActivationTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.activation = fixture.run_activation()
        self.operations = fixture.state / "web-rollouts"
        self.pending = self.operations / (self.activation["operationId"] + ".json")
        self.output = fixture.state / (self.activation["operationId"] + "-lineage-projection.json")
        self.binding = _state(self.pending)
        self.binding.pop("state")

    def seal(self):
        fixture = self.fixture
        return seal_initial_core_lineage(
            fixture.original, fixture.state, accepted_plan=fixture.predecessor,
            expected_plan_sha256=content_hash(fixture.predecessor), accepted_chain=fixture.chain,
            expected_chain_sha256=content_hash(fixture.chain), activation_binding=self.binding,
            expected_activation_operation_id=self.activation["operationId"], expected_activation_plan_sha256=self.activation["planSha256"],
            expected_core_authority_sha256="d" * 64, expected_core_backend_fingerprint="c" * 64,
            admin=fixture.admin, read_durable_config=lambda: fixture.admin.persisted,
            verify_authority=lambda binding: binding == self.binding and fixture.authority,
            observe_core=lambda: fixture.live_backend, observe_public=fixture.observe_public,
        )

    def test_repeat_seals_exact_projection_and_retains_hold_and_old_pointer(self):
        fixture = self.fixture
        original = self.pending.read_bytes()
        result = self.seal()
        self.assertEqual(_state(self.output), result)
        self.assertEqual(self.seal(), result)
        self.assertEqual(self.pending.read_bytes(), original)
        expected_slot = deepcopy(fixture.chain["active"]["slot"])
        expected_slot["route"]["fingerprint"] = content_hash(fixture.after)
        self.assertEqual(result["projectedPointer"], fixture.pointer | {"slot": expected_slot, "backendFingerprint": "c" * 64})
        self.assertEqual(result["projectedChain"]["previous"], fixture.chain["previous"])
        self.assertEqual(_state(fixture.state / "accepted-web-generation.json"), fixture.pointer)
        self.assertEqual(fixture.admin.writes, [fixture.after])
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            _admit_journals(self.operations, fixture.predecessor)

    def test_lost_seal_response_requires_exact_readback_without_rewriting(self):
        def lose_response(path, value):
            write_record(path, value)
            raise OSError("sealed response lost")

        with patch("installed_core_lineage_seal.write_record", side_effect=lose_response):
            with self.assertRaisesRegex(OSError, "response lost"):
                self.seal()
        inode = self.output.stat().st_ino
        self.assertEqual(self.seal(), _state(self.output))
        self.assertEqual(self.output.stat().st_ino, inode)
        self.assertTrue(self.pending.exists())

    def test_changed_durable_route_or_authority_refuses_sealing(self):
        fixture = self.fixture
        fixture.admin.persisted = fixture.before
        with self.assertRaisesRegex(SwitchConflict, "live and durable Core route"):
            self.seal()
        fixture.admin.persisted = fixture.after
        fixture.authority = False
        with self.assertRaisesRegex(SwitchConflict, "lineage authority changed"):
            self.seal()
        self.assertFalse(self.output.exists())

    def test_different_existing_seal_is_never_replaced(self):
        write_record(self.output, _envelope({"unexpected": True}))
        original = self.output.read_bytes()
        with self.assertRaisesRegex(SwitchConflict, "projection differs"):
            self.seal()
        self.assertEqual(self.output.read_bytes(), original)
        self.assertTrue(self.pending.exists())

    def accept(self, **overrides):
        fixture = self.fixture
        sealed = _state(self.output)
        acceptance = initial_core_lineage_acceptance(sealed, self.binding)
        options = {"activation_operation_id": self.activation["operationId"],
                   "expected_projection_seal_sha256": content_hash(sealed),
                   "expected_activation_lineage_sha256": content_hash(acceptance), "binding": self.binding,
                   "admin": fixture.admin, "read_durable_config": lambda: fixture.admin.persisted,
                   "verify_authority": lambda binding: binding == self.binding and fixture.authority,
                   "observe_core": lambda: fixture.live_backend, "observe_public": fixture.observe_public}
        return accept_initial_core_lineage(fixture.original, fixture.state, **(options | overrides))

    def test_acceptance_moves_pointer_and_clears_hold_without_another_route_write(self):
        fixture = self.fixture
        sealed = self.seal()
        result = self.accept()
        self.assertEqual(result, self.accept())
        self.assertEqual(_state(fixture.state / "accepted-web-generation.json"), sealed["projectedPointer"])
        self.assertFalse(self.pending.exists())
        _admit_journals(self.operations, fixture.predecessor)
        self.assertEqual(fixture.admin.writes, [fixture.after])

    def test_lost_acknowledgements_reconcile_with_the_hold_until_both_records_verify(self):
        self.seal()

        def lose_acceptance_ack(path, value):
            write_record(path, value)
            raise OSError("acceptance publication lost")

        def lose_pointer_ack(path, value, *, previous):
            _write_state(path, value, previous=previous)
            raise OSError("pointer publication lost")

        with patch("installed_core_lineage_seal.write_record", side_effect=lose_acceptance_ack):
            with self.assertRaisesRegex(OSError, "acceptance publication lost"):
                self.accept()
        self.assertTrue(self.pending.exists())
        self.assertEqual(_state(self.fixture.state / "accepted-web-generation.json"), self.fixture.pointer)
        with patch("installed_core_lineage_seal._write_state", side_effect=lose_pointer_ack):
            with self.assertRaisesRegex(OSError, "pointer publication lost"):
                self.accept()
        self.assertTrue(self.pending.exists())
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            _admit_journals(self.operations, self.fixture.predecessor)
        self.assertEqual(self.accept()["state"], "accepted")
        self.assertFalse(self.pending.exists())

    def test_acceptance_rejects_wrong_pin_or_another_pending_operation(self):
        fixture = self.fixture
        self.seal()
        with self.assertRaisesRegex(SwitchConflict, "independently admitted"):
            self.accept(expected_activation_lineage_sha256="0" * 64)
        write_record(self.operations / "another.json", _envelope({"state": "switch-intent"}))
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.accept()
        self.assertEqual(_state(fixture.state / "accepted-web-generation.json"), fixture.pointer)
        self.assertTrue(self.pending.exists())
