"""Exercise readback against the existing native-plan and exact Caddy adapters."""

from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from caddy_web_config import PROBE_REQUEST_HEADER, PROBE_RESPONSE_HEADER
from installed_web_probe import HEALTH_PATH, IDENTITY_PATH, Response
from installed_web_rollout_readback import read_accepted_web_rollout, read_public_web_health
import test_installed_web_successor as fixtures
from test_caddy_web_repeat import D
from web_rollout import _record, _write_state
from web_switch import SwitchConflict, SwitchHeld, _read, canonical


class InstalledWebRolloutReadbackTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.InstalledWebSuccessorTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.fixture = fixture
        self.install = fixture.install
        self.controller = self.install.controller(**fixture.options(), verify_release=self.qualify)
        self.calls = []
        self.allowed = True
        self.request_hook = None
        self.identity_override = None

    def qualify(self, _plan, *, initialize):
        return self.allowed and not initialize

    def apply(self, phase):
        return self.controller.run(phase, clock=self.fixture.clock.monotonic, sleep=self.fixture.clock.sleep)

    def read(self, phase):
        def get(method, path, headers, *, read_body):
            self.calls.append((method, path))
            self.assertEqual(method, "GET")
            self.assertIs(read_body, True)
            if self.request_hook is not None:
                self.request_hook(path)
            if path == HEALTH_PATH:
                return Response(200, (("Content-Type", "application/json"),), b'{"ok":true}')
            self.assertEqual(path, IDENTITY_PATH)
            self.assertEqual(headers[PROBE_REQUEST_HEADER], self.install.relay_alias)
            if self.identity_override is not None:
                return self.identity_override
            return self.identity(phase)

        with patch.object(self.install, "web", get), patch.object(self.controller, "run",
                side_effect=AssertionError("Readback cannot run a mutation")), patch.object(self.fixture.admin, "compare_and_swap",
                side_effect=AssertionError("Readback cannot write a route")):
            return read_accepted_web_rollout(self.install, self.controller, phase,
                clock=self.fixture.clock.monotonic, sleep=self.fixture.clock.sleep)

    def identity(self, phase):
        revision = self.controller.plan(phase)["after"]["runtime"]["sourceRevision"]
        return Response(200, (
            ("Cache-Control", "no-store"), ("Content-Type", "application/json"),
            (PROBE_RESPONSE_HEADER, self.install.relay_alias),
        ), canonical({"component": "web", "contract": "warpdrive.web.identity.v1",
                      "sourceRevision": revision, "version": self.install.inputs["version"]}))

    def journal(self, phase):
        return self.install.state / "web-rollouts" / (self.controller.plan(phase)["operationId"] + ".json")

    def state_bytes(self):
        return {path.relative_to(self.install.state): path.read_bytes()
                for path in self.install.state.rglob("*") if path.is_file()}

    def test_readback_matches_each_exact_receipt_and_preserves_native_state(self):
        for phase in ("promote", "rollback", "reapply"):
            accepted = self.apply(phase)
            before = self.state_bytes()
            self.calls.clear()
            self.assertEqual(self.read(phase), accepted)
            self.assertEqual(self.state_bytes(), before)
            self.assertEqual(self.calls, [("GET", HEALTH_PATH), ("GET", IDENTITY_PATH)] * 3)
        self.assertEqual(len(self.fixture.admin.writes), 3)

    def test_uncertain_or_later_journal_cannot_be_reported_as_requested_acceptance(self):
        self.apply("promote")
        journal = self.journal("promote")
        accepted = _read(journal)
        pending = {**accepted, "state": "switch-intent"}
        _write_state(journal, pending, previous=accepted)
        with self.assertRaises(SwitchConflict):
            self.read("promote")
        self.assertEqual(self.calls, [])
        self.assertEqual(_read(journal), pending)
        _write_state(journal, accepted, previous=pending)
        self.apply("rollback")
        self.apply("reapply")
        with self.assertRaisesRegex(SwitchConflict, "later Web phase"):
            self.read("promote")
        self.assertEqual(len(self.fixture.admin.writes), 3)

    def test_reapply_requires_the_original_exact_promotion_journal(self):
        for phase in ("promote", "rollback", "reapply"):
            self.apply(phase)
        journal = self.journal("promote")
        accepted = _read(journal)
        forged = deepcopy(accepted)
        forged["plan"]["qualificationSha256"] = "1" * 64
        _write_state(journal, forged, previous=accepted)
        with self.assertRaisesRegex(SwitchConflict, "earlier and selected"):
            self.read("reapply")
        self.assertEqual(self.calls, [])
        self.assertEqual(len(self.fixture.admin.writes), 3)

    def test_pointer_or_qualification_cannot_change_during_the_public_probe(self):
        self.apply("promote")
        path = self.install.state / "accepted-web-generation.json"
        accepted = _read(path)
        plan = self.controller.plan("promote")
        retained = _record(plan, plan["before"])

        def replace_pointer(endpoint):
            if endpoint == IDENTITY_PATH and _read(path) == accepted:
                _write_state(path, retained, previous=accepted)

        self.request_hook = replace_pointer
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            self.read("promote")
        _write_state(path, accepted, previous=retained)

        def revoke(_path):
            self.allowed = False

        self.request_hook = revoke
        with self.assertRaisesRegex(SwitchConflict, "qualification changed"):
            self.read("promote")
        self.assertEqual(len(self.fixture.admin.writes), 1)

    def test_live_autosave_and_exact_native_runtime_are_required(self):
        accepted = self.apply("promote")
        durable = self.fixture.admin.persisted
        self.fixture.admin.persisted = self.fixture.current
        with self.assertRaisesRegex(SwitchHeld, "durable Caddy"):
            self.read("promote")
        self.fixture.admin.persisted = durable
        self.fixture.rows["d" * 64]["RestartCount"] += 1
        with self.assertRaisesRegex(SwitchConflict, "runtime changed"):
            self.read("promote")
        self.fixture.rows["d" * 64]["RestartCount"] -= 1
        self.assertEqual(self.read("promote"), accepted)
        self.assertEqual(len(self.fixture.admin.writes), 1)

    def test_missing_relay_marker_or_unhealthy_retained_runtime_holds(self):
        self.apply("promote")
        identity = self.identity("promote")
        self.identity_override = Response(identity.status, identity.headers[:2], identity.body)
        with self.assertRaisesRegex(SwitchHeld, "public GET health"):
            self.read("promote")
        self.identity_override = None
        with patch.object(fixtures.successor, "read_direct_web", return_value=False):
            with self.assertRaisesRegex(SwitchHeld, "Retained Web direct health"):
                self.read("promote")
        self.assertEqual(len(self.fixture.admin.writes), 1)

    def test_public_get_proof_rejects_nonboolean_and_duplicate_health_data(self):
        revision = D.deployment_id.removeprefix("wd-")
        for raw in (b'{"ok":1}', b'{"ok":true,"ok":true}', b'{"ok":true,"extra":null}', b"\xff"):
            with self.subTest(raw=raw):
                def get(method, path, _headers, *, read_body):
                    self.assertEqual((method, path, read_body), ("GET", HEALTH_PATH, True))
                    return Response(200, (("Content-Type", "application/json"),), raw)

                install = SimpleNamespace(web=get)
                self.assertFalse(read_public_web_health(install, revision))

    def test_wrong_phase_or_controller_state_holds_without_any_observation(self):
        with self.assertRaisesRegex(SwitchConflict, "phase and shared target"):
            self.read("recover")
        other = SimpleNamespace(_state_dir=self.install.state.parent)
        with self.assertRaisesRegex(SwitchConflict, "phase and shared target"):
            read_accepted_web_rollout(self.install, other, "promote")
        self.assertEqual(self.calls, [])
        self.assertEqual(self.fixture.admin.writes, [])


if __name__ == "__main__":
    unittest.main()
