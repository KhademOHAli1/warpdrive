import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { applyCoreMigrations } from "@/db/migrate";
import {
  newsletterOperationalState,
  operationsIncidents,
  operationsReceipts,
  operationsTransitions,
} from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { OPERATIONAL_ENGINE_KEY } from "@/features/newsletter/delivery/operationalRepository";
import { runtimeQueueOptions } from "@/jobs/schemaContract";
import { makeTestDb } from "@/test/db";
import { submitOperationsBatch } from "./collectorClient";
import { OPERATIONS_COLLECTOR_PATH } from "./collectorSignature";
import { listenOperationsCollector } from "./collectorSocket";
import type { OperationsBatch, OperationsSourceBinding } from "./contracts";
import { recordOperationsBatch } from "./repository";
import { enrollOperationsSource, rotateOperationsSource } from "./storage";
import {
  OPERATIONS_WORKER_HEARTBEAT_SECONDS,
  OPERATIONS_WORKER_INSTANCE_NAME,
} from "./workerHeartbeat";

function submit(
  path: string,
  binding: OperationsSourceBinding,
  key: Buffer,
  batch: OperationsBatch,
) {
  const body = JSON.stringify(batch);
  const timestamp = Date.now().toString();
  const prefix = [
    "warpdrive.operations.collector.v1",
    "POST",
    OPERATIONS_COLLECTOR_PATH,
    binding.installationId,
    binding.sourceId,
    binding.generationId,
    timestamp,
    "",
  ].join("\n");
  const signature = createHmac("sha256", key).update(prefix).update(body).digest("hex");
  const request = [
    `POST ${OPERATIONS_COLLECTOR_PATH} HTTP/1.1`,
    "Host: warpdrive-operations.local",
    "Connection: close",
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    `X-Warpdrive-Collector-Source: ${binding.sourceId}`,
    `X-Warpdrive-Collector-Timestamp: ${timestamp}`,
    `X-Warpdrive-Collector-Signature: v1=${signature}`,
    "",
    body,
  ].join("\r\n");
  return new Promise<number>((resolve, reject) => {
    const socket = createConnection(path);
    let output = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy(new Error("Collector fixture timeout")));
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: string) => {
      output += chunk;
    });
    socket.once("error", reject);
    socket.once("close", () => resolve(Number(/^HTTP\/1\.1 ([0-9]{3})/u.exec(output)?.[1])));
  });
}

it("authenticates enrolled sources and durably records deduplicated failure and recovery", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", AbortSignal.timeout(5_000));
    const key = randomBytes(32);
    const directory = await mkdtemp(join(await realpath(tmpdir()), "wd-ops-"));
    const path = join(directory, "collector.sock");
    try {
      const server = await listenOperationsCollector(path, {
        lookupAuthority: (sourceId) =>
          sourceId === binding.sourceId
            ? {
                installationId: binding.installationId,
                binding,
                signingKey: key.toString("base64url"),
              }
            : null,
        write: (source, body, signal) => recordOperationsBatch(db, source, body, signal),
      });
      try {
        const batch: OperationsBatch = {
          schemaVersion: 2,
          generationId: binding.generationId,
          sequence: 1,
          observedAtMs: Date.now(),
          observations: [
            {
              kind: "observer",
              observer: "host_collector",
              state: "failed",
              reason: "check_failed",
            },
          ],
        };
        expect(await submit(path, binding, randomBytes(32), batch)).toBe(404);
        expect(await db.select().from(operationsReceipts)).toHaveLength(0);
        expect(
          await Promise.all([submit(path, binding, key, batch), submit(path, binding, key, batch)]),
        ).toEqual([204, 204]);
        expect(await db.select().from(operationsReceipts)).toHaveLength(1);
        expect(await db.select().from(operationsTransitions)).toHaveLength(1);
        expect(
          await submit(path, binding, key, {
            ...batch,
            observations: [
              { kind: "observer", observer: "host_collector", state: "healthy", reason: "ok" },
            ],
          }),
        ).toBe(409);
        const recovered: OperationsBatch = {
          ...batch,
          sequence: 2,
          observedAtMs: Date.now(),
          observations: [
            { kind: "observer", observer: "host_collector", state: "healthy", reason: "ok" },
          ],
        };
        expect(
          await submitOperationsBatch(
            path,
            {
              installationId: binding.installationId,
              binding,
              signingKey: key.toString("base64url"),
            },
            JSON.stringify(recovered),
            AbortSignal.timeout(5_000),
          ),
        ).toBe("accepted");
        expect(
          (await db.select().from(operationsTransitions)).map((row) => row.kind).sort(),
        ).toEqual(["opened", "recovered"]);
        const incidents = await db.select().from(operationsIncidents);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]?.recoveredAt).not.toBeNull();
        expect(
          await rotateOperationsSource(db, binding, AbortSignal.timeout(5_000)),
        ).not.toBeNull();
        expect(await submit(path, binding, key, { ...batch, sequence: 3 })).toBe(404);
        expect(await db.select().from(operationsReceipts)).toHaveLength(2);
      } finally {
        await server.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("starts the packaged collector with a restricted role and preserves observations through restart", async () => {
  const fixture = await makeTestDb();
  // A CI job's TMPDIR can already occupy most of sockaddr_un.sun_path.
  const directory = await mkdtemp(join(await realpath("/tmp"), "wd-ops-"));
  const path = join(directory, "collector.sock");
  const config = join(directory, "config.json");
  const role = `ops_${randomBytes(12).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  const key = randomBytes(32);
  let roleCreated = false;
  let boss: PgBoss | undefined;
  try {
    const run = promisify(execFile);
    const runtime = join(directory, "runtime");
    const entrypoint = join(runtime, "operations-collector.mjs");
    await mkdir(runtime, { mode: 0o700 });
    await symlink(await realpath("node_modules"), join(runtime, "node_modules"), "dir");
    await run(
      "bun",
      ["--no-env-file", "scripts/build-operations-collector.mjs", "--output", entrypoint],
      {
        timeout: 15_000,
        maxBuffer: 8192,
      },
    );
    const binding = await enrollOperationsSource(
      fixture.db,
      "host_collector",
      AbortSignal.timeout(5000),
    );
    const newsletterSource = await enrollOperationsSource(
      fixture.db,
      "application_sampler",
      AbortSignal.timeout(5000),
    );
    const queueSource = await enrollOperationsSource(
      fixture.db,
      "application_sampler",
      AbortSignal.timeout(5000),
    );
    const recoverySource = await enrollOperationsSource(
      fixture.db,
      "recovery_verifier",
      AbortSignal.timeout(5000),
    );
    const recoveryKey = randomBytes(32).toString("base64url");
    expect(await applyCoreMigrations(fixture.db, fixture.url)).toMatchObject({ ok: true });
    boss = new PgBoss({
      connectionString: fixture.url,
      ...runtimeQueueOptions("worker"),
      instanceName: OPERATIONS_WORKER_INSTANCE_NAME,
      instanceHeartbeatSeconds: OPERATIONS_WORKER_HEARTBEAT_SECONDS,
      superviseIntervalSeconds: 120,
    });
    boss.on("error", () => undefined);
    await boss.start();
    const registry = await fixture.pool.query<{ id: string; beat: Date }>(
      "SELECT id, heartbeat_on AS beat FROM pgboss.instance WHERE name = $1 AND stopped_on IS NULL",
      [OPERATIONS_WORKER_INSTANCE_NAME],
    );
    expect(registry.rowCount).toBe(1);
    const cache = await fixture.pool.query<{ sampled_at: Date }>(`
      UPDATE pgboss.queue SET monitor_on = clock_timestamp() - interval '7 seconds',
        queued_count = 2, ready_count = 1, active_count = 1, ready_oldest_seconds = 350
      WHERE name = 'file.reaper' RETURNING monitor_on AS sampled_at
    `);
    expect(cache.rowCount).toBe(1);
    await fixture.db.insert(newsletterOperationalState).values({
      engineKey: OPERATIONAL_ENGINE_KEY,
      fingerprint: "ready",
      checkedAt: new Date(Date.now() - 1000),
      lastPolledAt: new Date(Date.now() - 2000),
    });
    await fixture.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${password}'`);
    roleCreated = true;
    await fixture.pool.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        operations_current, operations_incidents, operations_receipts, operations_sources, operations_transitions
        TO ${role};
      GRANT SELECT ON operations_installation TO ${role};
      GRANT SELECT ON newsletter_operational_state TO ${role};
      GRANT USAGE ON SCHEMA pgboss TO ${role};
      GRANT SELECT ON pgboss.queue TO ${role};
      GRANT SELECT (id, name, version, supervise, schedule, migrate, started_on, heartbeat_on,
        heartbeat_seconds, stopped_on) ON pgboss.instance TO ${role};
    `);
    const url = new URL(fixture.url);
    url.username = role;
    url.password = password;
    const create = (databaseUrl: string) =>
      writeFile(
        config,
        JSON.stringify({
          databaseUrl,
          socketPath: path,
          queueSamplerSourceId: queueSource.sourceId,
          workerHeartbeat: true,
          newsletterSamplerSourceId: newsletterSource.sourceId,
          sources: [
            { binding, signingKey: key.toString("base64url") },
            { binding: queueSource, signingKey: randomBytes(32).toString("base64url") },
            { binding: newsletterSource, signingKey: randomBytes(32).toString("base64url") },
            { binding: recoverySource, signingKey: recoveryKey },
          ],
        }),
        { mode: 0o600 },
      );
    const launch = () => {
      const child = spawn(process.execPath, ["--no-env-file", entrypoint, config], {
        cwd: runtime,
        env: { NODE_ENV: "production" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let diagnostic = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-1024);
      });
      const watchdog = setTimeout(() => child.kill("SIGKILL"), 25_000);
      const exit = new Promise<number | null>((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
      }).finally(() => clearTimeout(watchdog));
      return { child, exit, diagnostic: () => diagnostic };
    };
    await create(fixture.url);
    const rejected = launch();
    expect(await rejected.exit).toBe(1);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    await create(url.toString());
    const awaitSocket = async (collector: ReturnType<typeof launch>) => {
      const deadline = performance.now() + 8000;
      for (;;) {
        const info = await lstat(path).catch(() => null);
        if (info?.isSocket() === true && (info.mode & 0o7777) === 0o600) return;
        expect(collector.child.exitCode, collector.diagnostic()).toBeNull();
        expect(performance.now()).toBeLessThan(deadline);
        await delay(50);
      }
    };
    const stop = async (collector: ReturnType<typeof launch>) => {
      collector.child.kill("SIGTERM");
      expect(await collector.exit, collector.diagnostic()).toBe(0);
      await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    };
    const observerBatch = {
      schemaVersion: 2,
      generationId: binding.generationId,
      sequence: 2,
      observedAtMs: Date.now(),
      observations: [
        { kind: "observer", observer: "host_collector", state: "healthy", reason: "ok" },
      ],
    } satisfies OperationsBatch;
    const admitted = launch();
    try {
      await awaitSocket(admitted);
      const python = (args: string[], input?: string) => {
        const execution = run("python3", ["-B", ...args], {
          cwd: join(process.cwd(), "scripts/deployment"),
          timeout: 12_000,
          maxBuffer: 8192,
        });
        if (input !== undefined) execution.child.stdin?.end(input);
        return execution;
      };
      const script = `
import sys
from pathlib import Path
from test_web_rollout import FakeClock, Target, slot
from web_rollout import rollout_web
from web_switch import content_hash
root = Path(sys.argv[1])
original = root / "original"
original.mkdir(mode=0o700)
(original / "production-operation.lock").touch(mode=0o600)
(root / "outbox").mkdir(mode=0o700)
plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deployment-a",
        "targetKey": "fixture", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
        "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
target, clock = Target(plan), FakeClock()
target.candidate_healthy = False
assert rollout_web(plan, state_dir=root / "release", target=target, initialize=True,
                   clock=clock.monotonic, sleep=clock.sleep)["state"] == "rolled-back"
print(content_hash(plan))
`;
      const plan = (await python(["-c", script, directory])).stdout.trim();
      const reporterConfig = join(directory, "reporter.json");
      await writeFile(
        reporterConfig,
        JSON.stringify({
          socketPath: path,
          binding,
          signingKey: key.toString("base64url"),
        }),
        { mode: 0o600 },
      );
      const selection = ["--operation-id", "deployment-a", "--plan-sha256", plan];
      const handoff = await python([
        "web_rollout_monitor.py",
        "extract",
        "--original",
        join(directory, "original"),
        "--state",
        join(directory, "release"),
        ...selection,
      ]);
      const scheduledHandoff = await python([
        "installed_web_monitor_schedule.py",
        "extract-current",
        "--original",
        join(directory, "original"),
        "--state",
        join(directory, "release"),
        "--target-key",
        "fixture",
      ]);
      expect(scheduledHandoff.stdout).toBe(handoff.stdout);
      const reporter = [
        "web_rollout_monitor.py",
        "submit",
        "--outbox",
        join(directory, "outbox"),
        "--reporter-config",
        reporterConfig,
        ...selection,
      ];
      const lostReply = await python(
        [
          "-c",
          `import io, sys
from pathlib import Path
from web_rollout_monitor import _send, read_handoff, report_observation
event = read_handoff(io.BytesIO(sys.stdin.buffer.read()), "deployment-a", sys.argv[3])
def lost_reply(*args):
    assert _send(*args) == "accepted"
    return "unknown"
print(report_observation(Path(sys.argv[1]), Path(sys.argv[2]), lambda: event,
                         plan_sha256=sys.argv[3], send=lost_reply))`,
          join(directory, "outbox"),
          reporterConfig,
          plan,
        ],
        handoff.stdout,
      );
      expect(lostReply.stdout.trim()).toBe("unknown");
      const scheduledReporter = [
        "-c",
        `import sys
from pathlib import Path
from installed_web_monitor_schedule import submit_current
print(submit_current(Path(sys.argv[1]), Path(sys.argv[2]), sys.stdin.buffer.read()))`,
        join(directory, "outbox"),
        reporterConfig,
      ];
      expect((await python(scheduledReporter, scheduledHandoff.stdout)).stdout.trim()).toBe(
        "accepted",
      );
      expect((await python(reporter, handoff.stdout)).stdout.trim()).toBe("unchanged");
      const receipts = await fixture.db
        .select()
        .from(operationsReceipts)
        .where(eq(operationsReceipts.sourceId, binding.sourceId));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.payload.observations).toMatchObject([
        { kind: "deployment", outcome: "rolled_back", sourceRevision: "a".repeat(40) },
      ]);
      const restoreOutbox = join(directory, "recovery-outbox");
      const restoreConfig = join(directory, "recovery-reporter.json");
      const restoreHandoff = join(directory, "restore-handoff.json");
      await mkdir(restoreOutbox, { mode: 0o700 });
      await writeFile(
        restoreConfig,
        JSON.stringify({ socketPath: path, binding: recoverySource, signingKey: recoveryKey }),
        { mode: 0o600 },
      );
      const completedAtMs = Date.now();
      const receiptSha256 = "c".repeat(64);
      await python([
        "-c",
        `import os, sys
from recovery_restore_monitor import build_restore_handoff
result = {"schemaVersion": 1, "kind": "warpdrive-independent-recovery-restore",
          "snapshotId": "a" * 64, "manifestSha256": "b" * 64, "receiptSha256": sys.argv[4],
          "verifiedBytes": 123, "verifiedEntries": 4, "durationMs": 56, "isolatedRestoreBytesVerified": True,
          "applicationRecoveryAccepted": False, "offHostAccepted": False, "keyCustodyAccepted": False,
          "writerResumptionAuthorized": False}
with os.fdopen(os.open(sys.argv[1], os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as stream:
    stream.write(build_restore_handoff(result, installation_id=sys.argv[2], repository_id="d" * 64,
                                      completed_at_ms=int(sys.argv[3])))`,
        restoreHandoff,
        recoverySource.installationId,
        String(completedAtMs),
        receiptSha256,
      ]);
      const restoreReporter = [
        "recovery_restore_monitor.py",
        "report",
        "--outbox",
        restoreOutbox,
        "--config",
        restoreConfig,
        "--handoff-sha256",
        createHash("sha256")
          .update(await readFile(restoreHandoff))
          .digest("hex"),
        "--receipt-sha256",
        receiptSha256,
      ];
      expect((await python([...restoreReporter, "--handoff", restoreHandoff])).stdout.trim()).toBe(
        "accepted",
      );
      expect((await python([...restoreReporter, "--retry-pending"])).stdout.trim()).toBe(
        "unchanged",
      );
      const restoreReceipts = await fixture.db
        .select()
        .from(operationsReceipts)
        .where(eq(operationsReceipts.sourceId, recoverySource.sourceId));
      expect(restoreReceipts).toHaveLength(1);
      expect(restoreReceipts[0]?.payload.observations).toMatchObject([
        {
          kind: "recovery",
          stage: "restore_bytes_verified",
          completedAtMs,
          bytes: 123,
          durationMs: 56,
          encrypted: true,
          contentSha256: "b".repeat(64),
        },
      ]);
      let samplerReceipt: typeof operationsReceipts.$inferSelect | undefined;
      const samplingDeadline = performance.now() + 5000;
      while (samplerReceipt === undefined) {
        [samplerReceipt] = await fixture.db
          .select()
          .from(operationsReceipts)
          .where(eq(operationsReceipts.sourceId, newsletterSource.sourceId));
        if (samplerReceipt === undefined) {
          expect(performance.now(), admitted.diagnostic()).toBeLessThan(samplingDeadline);
          await delay(50);
        }
      }
      expect(samplerReceipt.payload.observations).toMatchObject([
        { kind: "feature", feature: "newsletter_event_sync", state: "healthy" },
        { kind: "provider", provider: "newsletter_delivery", state: "healthy" },
      ]);
      const [queueReceipt] = await fixture.db
        .select()
        .from(operationsReceipts)
        .where(eq(operationsReceipts.sourceId, queueSource.sourceId));
      expect(queueReceipt?.payload.observations).toContainEqual(
        expect.objectContaining({
          kind: "queue",
          queue: "file.reaper",
          state: "degraded",
          readyOldestAgeMs: 350_000,
          sampledAtMs: cache.rows[0]?.sampled_at.getTime(),
        }),
      );
      expect(queueReceipt?.payload.observations).toContainEqual(
        expect.objectContaining({
          kind: "heartbeat",
          component: "worker",
          state: "healthy",
          processGeneration: registry.rows[0]?.id,
          sampledAtMs: registry.rows[0]?.beat.getTime(),
          activeCallbacks: null,
        }),
      );
      expect(await submit(path, binding, key, observerBatch)).toBe(204);
    } finally {
      await stop(admitted);
    }
    await boss.stop({ graceful: false, timeout: 1_000 });
    boss = undefined;
    const restarted = launch();
    try {
      await awaitSocket(restarted);
      expect(await submit(path, binding, key, observerBatch)).toBe(204);
      const receipts = await fixture.db
        .select({ sequence: operationsReceipts.sequence })
        .from(operationsReceipts)
        .where(eq(operationsReceipts.sourceId, binding.sourceId))
        .orderBy(operationsReceipts.sequence);
      expect(receipts).toEqual([{ sequence: 1 }, { sequence: 2 }]);
      const heartbeatDeadline = performance.now() + 5000;
      for (;;) {
        const [stoppedReceipt] = await fixture.db
          .select()
          .from(operationsReceipts)
          .where(
            and(
              eq(operationsReceipts.sourceId, queueSource.sourceId),
              eq(operationsReceipts.sequence, 2),
            ),
          );
        if (stoppedReceipt !== undefined) {
          expect(stoppedReceipt.payload.observations).toContainEqual(
            expect.objectContaining({
              kind: "heartbeat",
              state: "unknown",
              processGeneration: null,
            }),
          );
          break;
        }
        expect(performance.now(), restarted.diagnostic()).toBeLessThan(heartbeatDeadline);
        await delay(50);
      }
    } finally {
      await stop(restarted);
    }
  } finally {
    try {
      await boss?.stop({ graceful: false, timeout: 1_000 });
      if (roleCreated) await fixture.pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
