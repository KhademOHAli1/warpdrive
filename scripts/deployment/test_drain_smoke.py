"""Coordination/failure tests only; native CI must establish actual worker drain."""

from __future__ import annotations

import io
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

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


def fixture(directory=Path("unused"), scenario="normal"):
    clock = Clock()
    value = smoke.DrainSmoke(FakeDocker(), Path("bundle"), SHA, directory,
                             clock=clock.now, sleep=clock.sleep, scenario=scenario)
    value.clock_fixture = clock
    value.controller, value.worker = "owned-controller", "owned-worker"
    value.first_job_id = "a" * 8 + "-" + "a" * 4 + "-" + "a" * 4 + "-" + "a" * 4 + "-" + "a" * 12
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


def overrun_proof(value):
    return {"firstJobId": value.first_job_id, "firstState": "failed", "expireInSeconds": 1,
            "retryLimit": 0, "retryCount": 0, "expiredByHandlerDeadline": True,
            "workerQueryWaiting": True}


class OverrunTests(unittest.TestCase):
    def test_scenario_is_admitted_before_any_external_call_and_normal_is_default(self):
        self.assertEqual(fixture().scenario, "normal")
        self.assertEqual(fixture().report["limitations"], smoke.LIMITATIONS)
        self.assertEqual(fixture(scenario="overrun").report["limitations"], smoke.OVERRUN_LIMITATIONS)
        docker = FakeDocker()
        with self.assertRaises(smoke.DrainError):
            smoke.DrainSmoke(docker, Path("bundle"), SHA, Path("out"), scenario="overrun; shell")
        self.assertEqual(docker.calls, [])
        with patch.object(smoke, "IsolatedDocker") as isolated, patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            smoke.main(["--bundle-dir", "bundle", "--expected-revision", SHA,
                        "--output-dir", "out", "--scenario", "unknown"])
        isolated.assert_not_called()

    def test_cli_forwards_only_the_admitted_scenario_and_defaults_to_normal(self):
        for extra, expected in (([], "normal"), (["--scenario", "overrun"], "overrun")):
            with self.subTest(scenario=expected), patch.object(smoke, "IsolatedDocker") as docker, \
                    patch.object(smoke, "DrainSmoke") as runner, patch("sys.stdout", io.StringIO()):
                runner.return_value.run.return_value = True
                self.assertEqual(smoke.main(["--bundle-dir", "bundle", "--expected-revision", SHA,
                                             "--output-dir", "output", *extra]), 0)
                runner.assert_called_once_with(docker.return_value, Path("bundle"), SHA,
                                               Path("output"), scenario=expected)

    def test_failed_state_alone_or_different_job_query_expiry_retry_settings_are_not_proof(self):
        value = fixture(scenario="overrun")
        value.require_overrun_proof(overrun_proof(value))
        for key, wrong in (("firstJobId", "b" * 36), ("firstState", "completed"),
                           ("expiredByHandlerDeadline", False), ("workerQueryWaiting", False),
                           ("expireInSeconds", 60), ("expireInSeconds", True),
                           ("retryLimit", 1), ("retryCount", 1), ("retryCount", False)):
            proof = {**overrun_proof(value), key: wrong}
            with self.subTest(key=key, wrong=wrong), self.assertRaises(smoke.DrainError):
                value.require_overrun_proof(proof)

    def test_active_admission_waits_for_expiry_and_same_blocked_callback_before_any_signal(self):
        value = fixture(scenario="overrun")
        phases, containers = [], []
        value.fixture.prefix = "wd-owned"
        value.fixture.report = {"images": {"worker": {"id": "sha256:" + "1" * 64}}}
        value.fixture.env = {"DATABASE_URL": "owned-synthetic"}
        value.fixture.start_container = lambda *args, **kwargs: containers.append((args, kwargs)) or "controller"
        def phase(name, timeout):
            phases.append(name)
            if name == "active-blocked":
                return {"firstJobId": value.first_job_id, "jobState": "active", "workerQueryWaiting": True}
            return overrun_proof(value)
        value.wait_phase = phase
        proof = value.active_handler()
        self.assertEqual(phases, ["active-blocked", "expired-blocked"])
        self.assertEqual(proof["durableState"], "failed")
        self.assertTrue(proof["expiryBeforeSignal"])
        self.assertEqual(proof["lockDeadmanSeconds"], 35)
        self.assertEqual(containers[0][0][1], "sha256:" + "1" * 64)
        self.assertEqual(containers[0][1]["environment"]["IMAGE_SMOKE_DRAIN_SCENARIO"], "overrun")
        self.assertEqual(value.docker.calls, [])

    def test_post_signal_proof_is_required_before_lock_release_and_first_must_remain_failed(self):
        value = fixture(scenario="overrun")
        commands = []
        value.notify = commands.append
        phases = {
            "second-queued": {**overrun_proof(value), "secondState": "created"},
            "first-remains-failed": {"firstState": "failed", "secondState": "created"},
            "stopped-with-pending-job": {"firstState": "failed", "secondState": "created"},
        }
        value.wait_phase = lambda phase, timeout: phases[phase]
        value.fixture.state = lambda name: {"Running": False, "ExitCode": 0, "OOMKilled": False}
        result = value.drain()
        self.assertFalse(result["inflightCompleted"])
        self.assertEqual(result["firstDurableState"], "failed")
        self.assertTrue(result["expiredRecordPreserved"])
        self.assertEqual(commands, ["enqueue-second", "release", "verify-stopped"])
        for wrong in ({"workerQueryWaiting": False}, {"retryCount": 1}):
            commands.clear()
            phases["second-queued"].update(wrong)
            with self.subTest(wrong=wrong), self.assertRaises(smoke.DrainError):
                value.drain()
            self.assertEqual(commands, ["enqueue-second"])

    def test_overrun_cannot_accept_first_job_completed_or_replayed_after_release(self):
        for invalid_phase in ("first-remains-failed", "stopped-with-pending-job"):
            value = fixture(scenario="overrun")
            value.notify = lambda command: None
            def phase(name, timeout):
                if name == "second-queued":
                    return {**overrun_proof(value), "secondState": "created"}
                return {"firstState": "completed" if name == invalid_phase else "failed", "secondState": "created"}
            value.wait_phase = phase
            value.fixture.state = lambda name: {"Running": False, "ExitCode": 0, "OOMKilled": False}
            with self.subTest(phase=invalid_phase), self.assertRaises(smoke.DrainError):
                value.drain()

    def test_a_worker_that_exits_while_expired_query_is_blocked_fails_before_release(self):
        value = fixture(scenario="overrun")
        checked, commands = [], []
        def running(name):
            checked.append(name)
            if len(checked) > 1:
                raise smoke.DrainError("worker already exited")
        value.fixture.assert_running = running
        value.notify = commands.append
        with self.assertRaises(smoke.DrainError):
            value.drain()
        self.assertEqual(commands, [])
        self.assertEqual(value.docker.calls, [["kill", "--signal", "TERM", value.worker]])

    def test_same_container_restart_requires_second_completed_and_first_failed_with_empty_files(self):
        value = fixture(scenario="overrun")
        commands, finished = [], []
        value.notify = commands.append
        value.fixture.finished = lambda *args: finished.append(args)
        complete = {"phase": "complete", "firstState": "failed", "secondState": "completed", "filesCount": 0}
        value.wait_phase = lambda phase, timeout: complete
        proof = value.restart()
        self.assertEqual(value.docker.calls, [["start", value.worker]])
        self.assertEqual(commands, ["restart"])
        self.assertEqual(finished, [(value.controller, 10)])
        self.assertFalse(proof["firstCompletionPreserved"])
        self.assertTrue(proof["expiredRecordPreserved"])
        for wrong in ({"firstState": "completed"}, {"filesCount": 1}, {"secondState": "created"}):
            value.wait_phase = lambda phase, timeout: {**complete, **wrong}
            with self.subTest(wrong=wrong), self.assertRaises(smoke.DrainError):
                value.restart()

# Execute the exact controller body against in-memory queue/SQL adapters. This verifies its
# coordination decisions and refusal paths, not installed pg-boss/Postgres/native image behavior.
CONTROLLER_ADAPTER = r"""
let now=0, firstReads=0, waitingReads=0, released=false, restarted=false, notification;
const phases=[], options=[], statements=[], jobs=new Map();
let connections=0, endings=0, hardDeadline=0, deadlineCleared=false;
const ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
class Client {
  constructor(options) {this.kind=options.application_name;}
  on(event, callback) {if(event==='notification') notification=callback;}
  async connect() {connections++;}
  async end() {endings++;}
  async query(sql) {
    statements.push(sql);
    if(sql.includes('count(*)')) return {rows:[{count:FAULT==='files-not-empty'?1:0}]};
    if(sql.includes('pg_stat_activity')) {
      waitingReads++;
      const deadman=FAULT==='lock-deadman' && waitingReads>1;
      const started=FAULT==='query-restarted' && waitingReads>1?'2026-11-11 12:00:00.654321+00':'2026-11-11 12:00:00.123456+00';
      return {rows:released || deadman?[]:[{pid:FAULT==='query-replaced' && waitingReads>1?78:77,started}]};
    }
    if(sql.includes('pg_backend_pid')) return {rows:[{pid:99}]};
    if(sql==='COMMIT') {
      released=true;
      if(SCENARIO==='normal' || FAULT==='completed-after-release') jobs.get(ids[0]).state='completed';
    }
    return {rows:[]};
  }
}
class PgBoss {
  on() {}
  async start() {}
  async stop() {}
  async getQueue() {return {name:'file.reaper'};}
  async unschedule() {}
  async deleteQueuedJobs() {}
  async send(name,data,settings) {
    if(name!=='file.reaper' || data.nativeDrainFixture!==true) throw Error('Wrong application queue');
    options.push(settings);
    const id=ids[options.length-1];
    jobs.set(id,{id,state:'created',expireInSeconds:settings.expireInSeconds??900,retryLimit:settings.retryLimit,
      retryCount:0,output:{message:'handler execution exceeded 1s'}});
    return id;
  }
  async findJobs(name,{id}) {
    const job=jobs.get(id);
    if(id===ids[0] && !released) {
      firstReads++;
      job.state=SCENARIO==='overrun' && firstReads>1?'failed':'active';
      if(FAULT==='wrong-expiry') job.output={message:'unrelated handler failure'};
      if(FAULT==='retry-first' && firstReads>1) job.retryCount=1;
    }
    if(id===ids[1] && (restarted || FAULT==='second-claimed')) job.state=restarted?'completed':'active';
    return [job];
  }
}
const processFixture={env:{IMAGE_SMOKE_DRAIN_SCENARIO:SCENARIO,IMAGE_SMOKE_DRAIN_CHANNEL:'owned_fixture',DATABASE_URL:'synthetic-only'},exitCode:0,
  exit(){throw Error('deadline');}};
const consoleFixture={
  log(line) {
    const phase=JSON.parse(line); phases.push(phase);
    let command;
    if(phase.phase===(SCENARIO==='overrun'?'expired-blocked':'active-blocked')) command='enqueue-second';
    if(phase.phase==='second-queued') command='release';
    if(['first-completed','first-remains-failed'].includes(phase.phase)) command='verify-stopped';
    if(phase.phase==='stopped-with-pending-job') {command='restart';restarted=true;}
    if(command) notification({channel:'owned_fixture',payload:command});
  },error(){}
};
class ClockDate extends Date {static now(){return now;}}
const body=CONTROLLER.replace("import { Client } from 'pg';",'').replace("import { PgBoss } from 'pg-boss';",'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
let thrown=false;
try {
  await new AsyncFunction('Client','PgBoss','process','console','Bun','setTimeout','clearTimeout','Date',body)(
    Client,PgBoss,processFixture,consoleFixture,{sleep:async ms=>{now+=ms;}},
    (callback,milliseconds)=>{hardDeadline=milliseconds;return 1;},()=>{deadlineCleared=true;},ClockDate);
} catch {thrown=true;processFixture.exitCode=1;}
console.log(JSON.stringify({exitCode:processFixture.exitCode,thrown,phases,options,statements,connections,endings,hardDeadline,deadlineCleared}));
"""


class ControllerTests(unittest.TestCase):
    def execute(self, scenario="overrun", fault=""):
        runtime = shutil.which("node")
        self.assertIsNotNone(runtime, "Node is required for the deployment tooling/controller unit contract")
        source = ("const SCENARIO=" + json.dumps(scenario) + ";const FAULT=" + json.dumps(fault)
                  + ";const CONTROLLER=" + json.dumps(smoke.CONTROLLER) + ";" + CONTROLLER_ADAPTER)
        result = subprocess.run([runtime, "--input-type=module"], input=source, capture_output=True,
                                text=True, check=False, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_exact_controller_keeps_normal_completion_and_overrun_failure_distinct(self):
        for scenario, terminal in (("normal", "completed"), ("overrun", "failed")):
            with self.subTest(scenario=scenario):
                result = self.execute(scenario)
                self.assertEqual(result["exitCode"], 0)
                self.assertEqual(result["options"][0], {"expireInSeconds": 1, "retryLimit": 0}
                                 if scenario == "overrun" else {"retryLimit": 0})
                self.assertEqual(result["options"][1], {"retryLimit": 0})
                self.assertEqual(result["phases"][-1], {"phase": "complete", "firstState": terminal,
                                                       "secondState": "completed", "filesCount": 0})
                self.assertEqual(result["hardDeadline"], 90_000)
                self.assertTrue(result["deadlineCleared"])
                self.assertIn("SET LOCAL idle_in_transaction_session_timeout='35s'", result["statements"])
                self.assertEqual(result["endings"], 2)
                if scenario == "overrun":
                    phases = result["phases"]
                    self.assertEqual([phase["phase"] for phase in phases], ["active-blocked", "expired-blocked",
                        "second-queued", "first-remains-failed", "stopped-with-pending-job", "complete"])
                    self.assertTrue(phases[1]["workerQueryWaiting"])
                    self.assertTrue(phases[2]["workerQueryWaiting"])
                    self.assertTrue(phases[1]["expiredByHandlerDeadline"])
                    self.assertEqual(phases[1]["retryCount"], 0)

    def test_controller_refuses_unrelated_failure_replaced_query_retries_early_claim_and_state_drift(self):
        for fault in ("files-not-empty", "wrong-expiry", "query-replaced", "query-restarted", "lock-deadman", "retry-first",
                      "second-claimed", "completed-after-release"):
            with self.subTest(fault=fault):
                result = self.execute(fault=fault)
                self.assertEqual(result["exitCode"], 1)
                self.assertNotIn("complete", [row["phase"] for row in result["phases"]])
                if fault != "completed-after-release":
                    self.assertNotIn("COMMIT", result["statements"])
                if "BEGIN" in result["statements"] and fault != "completed-after-release":
                    self.assertIn("ROLLBACK", result["statements"])
                self.assertEqual(result["endings"], 2)

    def test_controller_scenario_admission_precedes_database_connections(self):
        result = self.execute(scenario="overrun;malicious")
        self.assertEqual(result["exitCode"], 1)
        self.assertTrue(result["thrown"])
        self.assertEqual(result["connections"], 0)
        self.assertEqual(result["statements"], [])


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

    def test_overrun_report_names_its_narrow_expired_record_proof_and_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "overrun", scenario="overrun")
            self.no_op_phases(value)
            self.assertTrue(value.run())
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertEqual(report["scenario"], "overrun")
            names = [check["name"] for check in report["checks"]]
            self.assertIn("real-expired-job-and-still-blocked-callback", names)
            self.assertIn("sigterm-waits-for-expired-callback-without-completing-or-replaying-job", names)
            self.assertEqual(report["limitations"], smoke.OVERRUN_LIMITATIONS)


if __name__ == "__main__":
    unittest.main()
