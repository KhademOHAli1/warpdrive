"""Coordination/failure tests only; native CI must establish actual worker drain."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

try:
    from . import drain_smoke as smoke
    from .image_smoke import ImageSmoke, OWNER_LABEL
except ImportError:
    import drain_smoke as smoke
    from image_smoke import ImageSmoke, OWNER_LABEL


SHA = "a" * 40


class Clock:
    def __init__(self):
        self.value = 0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.log = ""
        self.owner = "foreign"

    def run(self, arguments, **options):
        self.calls.append(arguments)
        output = self.log if arguments[0] == "logs" else json.dumps({OWNER_LABEL: self.owner})
        return subprocess.CompletedProcess(arguments, 0, output, "")

    def json(self, arguments, **options):
        return json.loads(self.run(arguments, **options).stdout)


def fixture(directory=Path("unused")):
    clock = Clock()
    value = smoke.DrainSmoke(FakeDocker(), Path("bundle"), SHA, directory,
                             clock=clock.now, sleep=clock.sleep)
    value.clock_fixture = clock
    value.controller, value.worker = "owned-controller", "owned-worker"
    value.fixture = SimpleNamespace(
        state=lambda name: {"Running": True, "OOMKilled": False, "ExitCode": 0},
        cleanup=lambda: [], failure_diagnostics=lambda: [], assert_running=lambda name: None,
    )
    return value


class ProofTests(unittest.TestCase):
    def test_only_structured_required_phase_counts_as_proof(self):
        self.assertIsNone(smoke.phase_from_logs("Ready\nfirst job completed\n", "active-blocked"))
        self.assertEqual(smoke.phase_from_logs('{"phase":"active-blocked","jobState":"active"}\n',
                                              "active-blocked")["jobState"], "active")

    def test_completed_marker_cannot_mask_exit_failure_or_oom(self):
        for state in ({"Running": False, "ExitCode": 1, "OOMKilled": False},
                      {"Running": True, "ExitCode": 0, "OOMKilled": True}):
            value = fixture()
            value.docker.log = '{"phase":"complete","firstState":"completed","secondState":"completed","filesCount":0}'
            value.fixture.state = lambda name: state
            with self.subTest(state=state), self.assertRaises(smoke.DrainError):
                value.wait_phase("complete", 1)

    def test_intermediate_ready_marker_requires_live_controller(self):
        value = fixture()
        value.docker.log = '{"phase":"active-blocked","jobState":"active","workerQueryWaiting":true}'
        value.fixture.state = lambda name: {"Running": False, "ExitCode": 0, "OOMKilled": False}
        with self.assertRaises(smoke.DrainError):
            value.wait_phase("active-blocked", 1)

    def test_missing_durable_phase_times_out_without_real_sleep(self):
        value = fixture()
        with self.assertRaises(smoke.DrainError):
            value.wait_phase("active-blocked", 1)
        self.assertGreaterEqual(value.clock_fixture.value, 1)
        self.assertLessEqual(value.clock_fixture.value, 1.25)

    def test_shutdown_needs_actual_exit_zero_no_oom_not_a_success_log(self):
        smoke.clean_exit({"Running": False, "ExitCode": 0, "OOMKilled": False})
        for state in ({"Running": False, "ExitCode": 137, "OOMKilled": False},
                      {"Running": False, "ExitCode": 143, "OOMKilled": False},
                      {"Running": True, "ExitCode": 0, "OOMKilled": False},
                      {"Running": False, "ExitCode": 0, "OOMKilled": True},
                      {"Running": False, "ExitCode": False, "OOMKilled": False}, {}):
            with self.subTest(state=state), self.assertRaises(smoke.DrainError):
                smoke.clean_exit(state)

    def test_signal_coordination_checks_durable_completion_and_pending_state_before_restart(self):
        value = fixture()
        commands = []
        value.notify = commands.append
        value.wait_phase = lambda phase, timeout: {
            "second-queued": {"secondState": "created"},
            "first-completed": {"firstState": "completed", "secondState": "created"},
            "stopped-with-pending-job": {"firstState": "completed", "secondState": "created"},
        }[phase]
        value.fixture.state = lambda name: {"Running": False, "ExitCode": 0, "OOMKilled": False}
        result = value.drain()
        self.assertTrue(result["inflightCompleted"])
        self.assertTrue(result["newWorkUnclaimedAfterExit"])
        self.assertEqual(commands, ["enqueue-second", "release", "verify-stopped"])
        self.assertEqual(value.docker.calls[0], ["kill", "--signal", "TERM", value.worker])
        self.assertFalse(any("KILL" in arguments for arguments in value.docker.calls))

    def test_early_consumption_of_new_work_fails_drain(self):
        value = fixture()
        value.notify = lambda command: None
        value.wait_phase = lambda phase, timeout: (
            {"secondState": "created"} if phase == "second-queued"
            else {"firstState": "completed", "secondState": "active"})
        with self.assertRaises(smoke.DrainError):
            value.drain()

    def test_notification_rejects_unrecognized_commands_before_docker(self):
        value = fixture()
        with self.assertRaises(smoke.DrainError):
            value.notify("release'; DROP TABLE files;--")
        self.assertEqual(value.docker.calls, [])


class ReportAndOwnershipTests(unittest.TestCase):
    @staticmethod
    def no_op_phases(value):
        for name in ("load", "setup", "active_handler", "drain", "restart"):
            setattr(value, name, lambda: {"unitFixture": True})

    def test_failure_preserves_diagnostics_then_cleanup_and_does_not_claim_later_gates(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            sequence = []

            def fail():
                raise smoke.DrainError("Actual active job was not proven")

            value.active_handler = fail
            value.fixture.failure_diagnostics = lambda: sequence.append("diagnostics") or []
            value.fixture.cleanup = lambda: sequence.append("cleanup") or []
            self.assertFalse(value.run())
            self.assertEqual(sequence, ["diagnostics", "cleanup"])
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertEqual(report["failure"], "Actual active job was not proven")
            self.assertEqual(report["checks"][-1]["status"], "failed")
            self.assertNotIn("replacement-worker-completes-retained-job", [row["name"] for row in report["checks"]])

    def test_cleanup_failure_prevents_success_even_after_all_coordination_checks_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            value.fixture.cleanup = lambda: ["owned cleanup failed"]
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])
            self.assertTrue(all(row["status"] == "passed" for row in value.report["checks"]))

    def test_actual_shared_cleanup_refuses_foreign_owned_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            base = ImageSmoke(value.docker, {name: f"{name}:test" for name in smoke.COMPONENTS},
                              Path(directory) / "fixture", SHA)
            base.resources = [("container", "foreign-container")]
            value.fixture = base
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])
            self.assertFalse(any(len(args) > 1 and args[1] == "rm" for args in value.docker.calls))

    def test_cannot_overwrite_previous_native_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory))
            with self.assertRaises(FileExistsError):
                value.run()
            self.assertEqual(value.docker.calls, [])


if __name__ == "__main__":
    unittest.main()
