#!/usr/bin/env python3
"""Qualify bounded in-flight worker drain using exact retained final images.

Uses the real file.reaper handler against an empty, isolated database. A separate
fixture transaction briefly blocks its ordinary SELECT; no test handler, provider,
object, source mount, production credential or production target is involved.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import tempfile
import time
from typing import Callable

try:
    from .bundle import load_bundle
    from .image_smoke import ImageSmoke, SmokeError, COMPONENTS, utc_now, validate_revision
    from .registry_smoke import IsolatedDocker
except ImportError:
    from bundle import load_bundle
    from image_smoke import ImageSmoke, SmokeError, COMPONENTS, utc_now, validate_revision
    from registry_smoke import IsolatedDocker


LIMITATIONS = [
    "Disposable native final-image worker drain/restart only; no production deployment acceptance.",
    "One real file.reaper handler with an empty files table; no object/provider/mail operation is qualified.",
    "No forced-kill recovery, expired lease/redrive, large import, SMTP submission or workflow drain is qualified.",
    "No authenticated realtime/browser reconnect, traffic-switch rollback, populated upgrade or data recovery is qualified.",
]


class DrainError(SmokeError):
    pass


CONTROLLER = r"""
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
const channel = process.env.IMAGE_SMOKE_DRAIN_CHANNEL;
if (!/^[a-z0-9_]{1,63}$/.test(channel || '')) throw Error('Invalid fixture channel');
const control = new Client({connectionString:process.env.DATABASE_URL,application_name:'wd-drain-control',connectionTimeoutMillis:3000,query_timeout:5000});
const blocker = new Client({connectionString:process.env.DATABASE_URL,application_name:'wd-drain-blocker',connectionTimeoutMillis:3000,query_timeout:5000});
const boss = new PgBoss({connectionString:process.env.DATABASE_URL,max:1,schedule:false,supervise:false,application_name:'wd-drain-producer'});
const commands = [];
let backgroundError = false, transaction = false;
boss.on('error',()=> {backgroundError=true;});
control.on('notification',msg=> {if(msg.channel===channel) commands.push(msg.payload);});
const emit = (phase, detail={})=>console.log(JSON.stringify({phase,...detail}));
const hardDeadline = setTimeout(()=> {console.error('native drain fixture deadline');process.exit(2);},90000);
async function until(predicate, milliseconds, reason) {
  const deadline=Date.now()+milliseconds;
  while(true) {
    if(backgroundError) throw Error('Fixture database connection failed');
    const result=await predicate();
    if(result) return result;
    if(Date.now()>=deadline) throw Error(reason);
    await Bun.sleep(100);
  }
}
async function command(expected, milliseconds=15000) {
  await until(()=> {
    const next=commands.shift();
    if(next===undefined) return false;
    if(next!==expected) throw Error('Unexpected fixture command');
    return true;
  },milliseconds,'Fixture command timed out');
}
const jobState = async id=>(await boss.findJobs('file.reaper',{id,limit:1}))[0]?.state;
try {
  await control.connect(); await blocker.connect(); await boss.start();
  await control.query('LISTEN "'+channel+'"');
  const files=await control.query('SELECT count(*)::int AS count FROM public.files');
  if(files.rows[0]?.count!==0) throw Error('Drain fixture requires empty files');
  if(!(await boss.getQueue('file.reaper'))) throw Error('Real application handler not registered');
  // This database is fresh and fixture-owned. Avoid an hourly cron racing this exact job.
  await boss.unschedule('file.reaper');
  await boss.deleteQueuedJobs('file.reaper');
  await blocker.query('BEGIN'); transaction=true;
  await blocker.query("SET LOCAL lock_timeout='2s'");
  await blocker.query("SET LOCAL idle_in_transaction_session_timeout='35s'");
  await blocker.query('LOCK TABLE public.files IN ACCESS EXCLUSIVE MODE');
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const first=await boss.send('file.reaper',{nativeDrainFixture:true},{retryLimit:0});
  if(!first) throw Error('First application job was not persisted');
  await until(async()=> {
    if(await jobState(first)!=='active') return false;
    const waiting=await control.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a
      WHERE a.datname=current_database() AND a.wait_event_type='Lock'
      AND $1::integer=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE '%files%') AS waiting`,[pid]);
    return waiting.rows[0]?.waiting===true;
  },15000,'Real application job never became active and blocked');
  emit('active-blocked',{firstJobId:first,jobState:'active',workerQueryWaiting:true});
  await command('enqueue-second');
  const second=await boss.send('file.reaper',{nativeDrainFixture:true},{retryLimit:0});
  if(!second || await jobState(second)!=='created' || await jobState(first)!=='active') throw Error('Post-signal queued job not safely retained');
  emit('second-queued',{firstJobId:first,secondJobId:second,secondState:'created'});
  await command('release');
  await blocker.query('COMMIT'); transaction=false;
  await until(async()=> {
    const secondState=await jobState(second);
    if(secondState!=='created') throw Error('Draining worker claimed new work after SIGTERM');
    return await jobState(first)==='completed';
  },20000,'In-flight real application job did not complete');
  emit('first-completed',{firstJobId:first,firstState:'completed',secondState:'created'});
  await command('verify-stopped');
  if(await jobState(first)!=='completed' || await jobState(second)!=='created') throw Error('Durable state changed before replacement worker');
  emit('stopped-with-pending-job',{firstState:'completed',secondState:'created'});
  await command('restart');
  await until(async()=> {
    const state=await jobState(second);
    if(['failed','cancelled'].includes(state)) throw Error('Replacement worker rejected retained job');
    return state==='completed';
  },25000,'Replacement worker did not complete retained job');
  if(await jobState(first)!=='completed') throw Error('First job completion was not durable');
  const finalFiles=await control.query('SELECT count(*)::int AS count FROM public.files');
  if(finalFiles.rows[0]?.count!==0) throw Error('Fixture unexpectedly changed files');
  emit('complete',{firstState:'completed',secondState:'completed',filesCount:0});
} catch {
  console.error('native worker drain fixture failed'); process.exitCode=1;
} finally {
  if(transaction) await blocker.query('ROLLBACK').catch(()=>{});
  await boss.stop({graceful:false,timeout:1000}).catch(()=> {process.exitCode=1;});
  await blocker.end().catch(()=> {process.exitCode=1;});
  await control.end().catch(()=> {process.exitCode=1;});
  clearTimeout(hardDeadline);
}
"""

NOTIFY = r"""
import { Client } from 'pg';
const command=process.env.IMAGE_SMOKE_DRAIN_COMMAND;
if(!['enqueue-second','release','verify-stopped','restart'].includes(command)) throw Error('Invalid fixture command');
const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:5000});
try {
  await client.connect();
  await client.query('SELECT pg_notify($1,$2)',[process.env.IMAGE_SMOKE_DRAIN_CHANNEL,command]);
  console.log(JSON.stringify({notified:command}));
} finally {await client.end();}
"""


def phase_from_logs(text: str, expected: str):
    found = None
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict) and value.get("phase") == expected:
            found = value
    return found


def clean_exit(state):
    if (not isinstance(state, dict) or state.get("Running") is not False
            or state.get("OOMKilled") is not False or type(state.get("ExitCode")) is not int
            or state["ExitCode"] != 0):
        raise DrainError("Worker did not finish graceful shutdown with exit zero and no OOM")


class DrainSmoke:
    def __init__(self, docker, bundle_dir: Path, expected_revision: str, output_dir: Path,
                 *, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.docker, self.bundle_dir, self.output_dir = docker, bundle_dir, output_dir
        self.revision = validate_revision(expected_revision)
        self.clock, self.sleep = clock, sleep
        self.fixture = None
        self.report = {"schemaVersion": 1, "kind": "warpdrive-native-worker-drain-smoke",
                       "success": False, "revision": self.revision, "startedAt": utc_now(),
                       "checks": [], "images": {}, "limitations": LIMITATIONS,
                       "failure": None, "diagnostics": [], "cleanup": {"success": False, "errors": []}}

    def check(self, name, operation):
        try:
            detail = operation()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed"})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def load(self):
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        candidate = loaded["candidate"]
        images = {name: candidate["components"][name]["imageId"] for name in COMPONENTS}
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.output_dir / "fixture",
                                  expected_revision=self.revision, clock=self.clock, sleep=self.sleep)
        identities = self.fixture.inspect_images()
        self.report["images"] = self.fixture.report["images"]
        return {**identities, "archiveSha256": loaded["provenance"]["archiveSha256"], "rebuilds": 0}

    def setup(self):
        isolation = self.fixture.create_environment()
        migrations = self.fixture.migrations()
        self.worker = self.fixture.start_container("worker", self.fixture.report["images"]["worker"]["id"],
                                                   ["bun", "dist/worker.mjs"], memory="1024m")
        if self.fixture.queue_helper("registered") != {"registered": True}:
            raise DrainError("Packaged worker did not register the real application queue")
        self.fixture.assert_running(self.worker)
        return {"isolation": isolation, "migrations": migrations, "queue": "file.reaper", "filesEmpty": True}

    def wait_phase(self, phase: str, timeout: int = 25):
        deadline = self.clock() + timeout
        while True:
            state = self.fixture.state(self.controller)
            if state.get("OOMKilled") or (state.get("Running") is False and state.get("ExitCode") != 0):
                raise DrainError("Native drain controller failed before proving the required phase")
            logs = self.docker.run(["logs", "--tail", "40", self.controller], timeout=5)
            value = phase_from_logs(logs.stdout, phase)
            if value is not None:
                if phase != "complete" and state.get("Running") is not True:
                    raise DrainError("Native drain controller exited before the coordinated phase finished")
                return value
            if state.get("Running") is not True:
                raise DrainError("Native drain controller exited without the required durable proof")
            if self.clock() >= deadline:
                raise DrainError("Timed out waiting for bounded native drain phase")
            self.sleep(0.25)

    def active_handler(self):
        channel = self.fixture.prefix.replace("-", "_") + "_drain"
        self.controller = self.fixture.start_container(
            "drain-controller", self.fixture.report["images"]["worker"]["id"],
            ["bun", "--no-env-file", "-e", CONTROLLER],
            environment={**self.fixture.env, "IMAGE_SMOKE_DRAIN_CHANNEL": channel}, memory="384m")
        phase = self.wait_phase("active-blocked", 25)
        if (phase.get("jobState") != "active" or phase.get("workerQueryWaiting") is not True
                or not re.fullmatch(r"[0-9a-f-]{36}", str(phase.get("firstJobId", "")))):
            raise DrainError("Actual active application job and blocked query were not proven")
        self.fixture.assert_running(self.worker)
        return {"queue": "file.reaper", "durableState": "active", "actualQueryBlocked": True,
                "lockDeadmanSeconds": 35, "productionTestHandler": False}

    def notify(self, command: str):
        if command not in {"enqueue-second", "release", "verify-stopped", "restart"}:
            raise DrainError("Invalid native drain coordination command")
        result = self.docker.json([
            "exec", "--env", f"IMAGE_SMOKE_DRAIN_COMMAND={command}", self.controller,
            "bun", "--no-env-file", "-e", NOTIFY,
        ], timeout=10)
        if result != {"notified": command}:
            raise DrainError("Native drain coordination was not acknowledged")

    def drain(self):
        self.fixture.assert_running(self.worker)
        self.docker.run(["kill", "--signal", "TERM", self.worker], timeout=10)
        # The ordinary handler must still be alive while its in-flight query is held.
        for _ in range(4):
            self.sleep(0.25)
            self.fixture.assert_running(self.worker)
        self.notify("enqueue-second")
        queued = self.wait_phase("second-queued", 5)
        if queued.get("secondState") != "created":
            raise DrainError("Post-SIGTERM work was not durably pending")
        self.notify("release")
        completed = self.wait_phase("first-completed", 25)
        if completed.get("firstState") != "completed" or completed.get("secondState") != "created":
            raise DrainError("In-flight completion or retained post-signal job was not proven")
        deadline = self.clock() + 35
        while True:
            state = self.fixture.state(self.worker)
            if state.get("Running") is False:
                clean_exit(state)
                break
            if self.clock() >= deadline:
                raise DrainError("Packaged worker did not exit within the bounded drain window")
            self.sleep(0.25)
        self.notify("verify-stopped")
        stopped = self.wait_phase("stopped-with-pending-job", 5)
        if stopped.get("firstState") != "completed" or stopped.get("secondState") != "created":
            raise DrainError("Post-exit durable job state was not preserved")
        return {"signal": "SIGTERM", "aliveWhileInflightBlocked": True, "inflightCompleted": True,
                "workerExitCode": 0, "oomKilled": False, "newWorkUnclaimedAfterExit": True}

    def restart(self):
        self.docker.run(["start", self.worker], timeout=10)
        self.fixture.assert_running(self.worker)
        self.notify("restart")
        complete = self.wait_phase("complete", 30)
        if complete != {"phase": "complete", "firstState": "completed", "secondState": "completed", "filesCount": 0}:
            raise DrainError("Replacement worker completion and empty files state were not proven")
        self.fixture.finished(self.controller, 10)
        self.fixture.assert_running(self.worker)
        return {"sameImageRestarted": True, "pendingJobCompleted": True,
                "firstCompletionPreserved": True, "filesCount": 0, "externalSideEffects": 0}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("verified-bundle-and-exact-image-identities", self.load)
            self.check("isolated-fresh-database-and-real-worker", self.setup)
            self.check("real-active-handler-held-by-bounded-lock", self.active_handler)
            self.check("sigterm-drains-inflight-and-stops-consuming", self.drain)
            self.check("replacement-worker-completes-retained-job", self.restart)
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
            if self.fixture is not None:
                self.report["diagnostics"] = self.fixture.failure_diagnostics()
        finally:
            errors = self.fixture.cleanup() if self.fixture is not None else []
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--expected-revision", type=validate_revision, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(arguments)
    try:
        with tempfile.TemporaryDirectory(prefix="wd-drain-auth-") as directory:
            docker = IsolatedDocker(Path(directory) / "docker")
            passed = DrainSmoke(docker, args.bundle_dir, args.expected_revision, args.output_dir).run()
    except (SmokeError, ValueError, OSError) as error:
        print(f"Native worker drain smoke rejected: {error}", file=sys.stderr)
        return 1
    print(f"Native worker drain smoke {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
