"""Seed/protocol/coordination guards only; native CI must prove actual authenticated WS behavior."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

try:
    from . import ws_drain_smoke as smoke
    from .image_smoke import ImageSmoke, OWNER_LABEL
except ImportError:
    import ws_drain_smoke as smoke
    from image_smoke import ImageSmoke, OWNER_LABEL


SHA = "a" * 40


class Clock:
    def __init__(self):
        self.value = 0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class Docker:
    def __init__(self):
        self.calls, self.log = [], ""
        self.image_id = "sha256:" + "b" * 64

    def run(self, arguments, **options):
        self.calls.append(arguments)
        if arguments[0] == "logs":
            output = self.log
        elif arguments[-1] == "{{.Image}}":
            output = self.image_id
        else:
            output = json.dumps({OWNER_LABEL: "foreign"})
        return subprocess.CompletedProcess(arguments, 0, output, "")

    def json(self, arguments, **options):
        return json.loads(self.run(arguments, **options).stdout)


def fixture(directory=Path("unused")):
    clock = Clock()
    value = smoke.RealtimeDrainSmoke(Docker(), Path("bundle"), SHA, directory,
                                     clock=clock.now, sleep=clock.sleep)
    value.clock_fixture = clock
    value.realtime, value.controller = "owned-realtime", "owned-controller"
    value.fixture = SimpleNamespace(
        state=lambda name: {"Running": True, "ExitCode": 0, "OOMKilled": False},
        assert_running=lambda name: None, failure_diagnostics=lambda: [], cleanup=lambda: [],
        report={"images": {"realtime": {"id": value.docker.image_id}}},
    )
    return value


class SeedGuardTests(unittest.TestCase):
    def environment(self):
        return ImageSmoke(Docker(), {name: name + ":test" for name in smoke.COMPONENTS}, Path("unused"), SHA).env

    def test_actual_generated_fixture_environment_is_admitted(self):
        smoke.admit_seed_environment(self.environment())

    def test_live_database_file_override_external_effects_and_weak_secrets_are_refused(self):
        original = self.environment()
        for key, value in (
            ("DATABASE_URL", "postgres://smoke:unused@127.0.0.1:5432/warpdrive_image_smoke"),
            ("DATABASE_URL", "postgres://production:unused@postgres:5432/live"),
            ("DATABASE_URL", original["DATABASE_URL"] + "?target=live"),
            ("DATABASE_URL_FILE", "/private/production"), ("WS_TICKET_SECRET_FILE", "/private/secret"),
            ("AUTH_GOOGLE_ENABLED", "true"), ("NEWSLETTER_DELIVERY_ENABLED", "true"),
            ("AUTH_SMTP_HOST", "provider.example.com"), ("WS_TICKET_SECRET", "short"),
        ):
            with self.subTest(key=key, value=value), self.assertRaises(smoke.RealtimeDrainError):
                smoke.admit_seed_environment({**original, key: value})


class ProtocolProofTests(unittest.TestCase):
    def test_auth_ok_alone_cannot_qualify_subscription_and_actual_relay_delivery(self):
        required = {"authOk": True, "subscribed": True, "socketOpen": True, "relayEventDelivered": True, "replayRejected": True}
        for missing in required:
            proof = {"phase": "authenticated-open", **required}
            del proof[missing]
            with self.subTest(missing=missing), self.assertRaises(smoke.RealtimeDrainError):
                smoke.require_proof(proof, "authenticated-open", required)
        with self.assertRaises(smoke.RealtimeDrainError):
            smoke.require_proof({"phase": "authenticated-open", **required, "authOk": 1}, "authenticated-open", required)

    def test_mfa_assertion_without_active_verified_live_session_is_insufficient(self):
        required = {"active": True, "emailVerified": True, "sessionLive": True, "assurance": "mfa", "synthetic": True}
        for name in ("active", "emailVerified", "sessionLive"):
            with self.subTest(name=name), self.assertRaises(smoke.RealtimeDrainError):
                smoke.require_proof({"phase": "seeded", **required, name: False}, "seeded", required)

    def test_wrong_close_code_cannot_count_as_cooperative_shutdown(self):
        for code in (1000, 1006, 4401, "1012"):
            value = fixture()
            value.wait_phase = lambda phase, timeout: {"phase": phase, "closeCode": code, "socketClosed": True}
            with self.subTest(code=code), self.assertRaises(smoke.RealtimeDrainError):
                value.shutdown()

    def test_cooperative_peer_close_cannot_hide_server_kill_or_oom(self):
        for code, oom in ((137, False), (143, False), (0, True)):
            value = fixture()
            value.wait_phase = lambda phase, timeout: {"phase": phase, "closeCode": 1012, "socketClosed": True}
            value.fixture.state = lambda name: {"Running": False, "ExitCode": code, "OOMKilled": oom}
            with self.subTest(code=code, oom=oom), self.assertRaises(smoke.RealtimeDrainError):
                value.shutdown()

    def test_controller_failure_cannot_be_masked_by_prior_authentication_marker(self):
        value = fixture()
        value.docker.log = '{"phase":"authenticated-open","authOk":true}'
        value.fixture.state = lambda name: {"Running": False, "ExitCode": 1, "OOMKilled": False}
        with self.assertRaises(smoke.RealtimeDrainError):
            value.wait_phase("authenticated-open", 1)

    def test_missing_protocol_marker_times_out_with_bounded_wait(self):
        value = fixture()
        value.docker.log = "Ready\nauthentication started\n"
        with self.assertRaises(smoke.RealtimeDrainError):
            value.wait_phase("authenticated-open", 1)
        self.assertGreaterEqual(value.clock_fixture.value, 1)
        self.assertLessEqual(value.clock_fixture.value, 1.25)

    def test_restart_cannot_silently_select_a_different_image(self):
        value = fixture()
        value.docker.image_id = "sha256:" + "c" * 64
        with self.assertRaises(smoke.RealtimeDrainError):
            value.same_image()


class ReportAndCleanupTests(unittest.TestCase):
    @staticmethod
    def no_op_phases(value):
        for name in ("load", "setup", "seed", "authenticated", "shutdown", "restart"):
            setattr(value, name, lambda: {"unitFixture": True})

    def test_partial_failure_preserves_scope_and_does_not_claim_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)

            def fail():
                raise smoke.RealtimeDrainError("Authenticated relay proof missing")

            value.authenticated = fail
            self.assertFalse(value.run())
            self.assertEqual(value.report["checks"][-1]["status"], "failed")
            self.assertNotIn("same-image-restart-fresh-authenticated-relay", [row["name"] for row in value.report["checks"]])
            self.assertTrue(any("browser" in text for text in value.report["limitations"]))
            self.assertTrue(any("HTTP ticket" in text for text in value.report["limitations"]))

    def test_cleanup_failure_prevents_success(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            value.fixture.cleanup = lambda: ["owned resource cleanup failed"]
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])

    def test_shared_fixture_cleanup_will_not_remove_foreign_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            base = ImageSmoke(value.docker, {name: name + ":test" for name in smoke.COMPONENTS}, Path(directory) / "base", SHA)
            base.resources = [("container", "foreign-realtime")]
            value.fixture = base
            self.assertFalse(value.run())
            self.assertFalse(any(len(args) > 1 and args[1] == "rm" for args in value.docker.calls))

    def test_previous_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory))
            with self.assertRaises(FileExistsError):
                value.run()
            self.assertEqual(value.docker.calls, [])


if __name__ == "__main__":
    unittest.main()
