import { createHash } from "node:crypto";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { seedDurationUpgradeData } from "@/features/workflows/durationWaitMigration.test-helpers";
import { QUEUE_NAMES } from "@/jobs/queueManifest";
import { assertRuntimeQueueSchema } from "@/jobs/schemaContract";
import type { TestDb } from "@/test/db";
import { applyCoreMigrations } from "./migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "./migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "./migrationAdmissionSource";

const LEGACY_MIGRATION_COUNT = 110;
// Ordered timestamp/SQL-hash pairs observed on the installed 1.5.1 release.
const LEGACY_LEDGER_SHA256 = "fbca5f423139b75edd00541f6370d708cf76fc1e7e8e865be3a72740fb451a3e";
const LEGACY_QUEUES = [
  "__pgboss__send-it",
  "activity.reminder",
  "activity.reminder.native.v1",
  "activity.reminder.reconcile.v1",
  "auth-maintenance",
  "email.recovery",
  "email.send.process",
  "email.sync",
  "file.reaper",
  "import.commit",
  "import.prepare",
  "import.undo",
  "import.validate",
  "notification.email",
  "workflow.reconcile",
  "workflow.run",
  "workflow-v2-reconcile",
  "workflow-v2-run",
];

async function businessSnapshot(h: TestDb) {
  return (
    await h.pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM deals d) AS deals,
    (SELECT jsonb_agg(jsonb_build_array(id,subject,due_at,owner_id,assignee_id,deal_id) ORDER BY id)
      FROM activities) AS activities,
    (SELECT jsonb_agg(jsonb_build_array(id,workflow_id,version_id,status,next_node_id,outputs) ORDER BY id)
      FROM workflow_runs) AS runs,
    (SELECT jsonb_agg(jsonb_build_array(id,run_id,node_id,simulated,output) ORDER BY id)
      FROM workflow_steps) AS steps,
    (SELECT jsonb_agg(jsonb_build_array(id,name,state,data) ORDER BY id) FROM pgboss.job) AS jobs`)
  ).rows;
}

it("upgrades the 1.5.1 migration prefix with populated CRM, workflow and queue data", async () => {
  const signal = AbortSignal.timeout(45_000);
  const h = await freshMigrationDb();
  const boss = new PgBoss({ connectionString: h.url, schedule: false, supervise: false });
  const queueErrors: Error[] = [];
  boss.on("error", (error) => queueErrors.push(error));
  try {
    await installPrefix(h, LEGACY_MIGRATION_COUNT);
    const beforeLedger = await ledger(h);
    expect(beforeLedger).toHaveLength(LEGACY_MIGRATION_COUNT);
    const baselineHashes = beforeLedger.map(({ created_at, hash }) => {
      if (typeof created_at !== "string" || typeof hash !== "string")
        throw new TypeError("Invalid migration ledger row");
      return `${created_at}|${hash}\n`;
    });
    expect(createHash("sha256").update(baselineHashes.join("")).digest("hex")).toBe(
      LEGACY_LEDGER_SHA256,
    );
    const data = await seedDurationUpgradeData(h, signal);

    // Recreate the incumbent queue inventory with vendor defaults and leave a pending job.
    await boss.start();
    try {
      expect(await boss.schemaVersion()).toBe(46);
      for (const name of LEGACY_QUEUES) await boss.createQueue(name);
      expect(await boss.send("workflow.run", { runId: data.runs.queued })).toEqual(
        expect.any(String),
      );
    } finally {
      await boss.stop({ graceful: true });
    }
    const beforeBusiness = await businessSnapshot(h);
    expect(beforeBusiness[0]).toMatchObject({
      deals: [expect.any(Object)],
      activities: [expect.any(Array)],
      runs: expect.arrayContaining([expect.any(Array)]),
      steps: expect.arrayContaining([expect.any(Array)]),
      jobs: [[expect.any(String), "workflow.run", "created", { runId: data.runs.queued }]],
    });
    const target = await readCanonicalMigrations(canonicalFolder, signal);
    if (!target.ok) throw new Error(target.error);

    const success = { ok: true, value: { applied: true } };
    expect(await applyCoreMigrations(h.db, h.url, signal)).toEqual(success);
    const upgradedLedger = await ledger(h);
    expect(upgradedLedger.slice(0, LEGACY_MIGRATION_COUNT)).toEqual(beforeLedger);
    expect(upgradedLedger.map(({ hash, created_at }) => ({ hash, created_at }))).toEqual(
      target.value.map(({ hash, when }) => ({ hash, created_at: String(when) })),
    );
    expect(await businessSnapshot(h)).toEqual(beforeBusiness);
    expect(
      (await h.pool.query("SELECT DISTINCT iteration_index,outcome FROM workflow_steps")).rows,
    ).toEqual([{ iteration_index: -1, outcome: "succeeded" }]);
    expect(
      (await h.pool.query("SELECT DISTINCT version,reminder_engine FROM activities")).rows,
    ).toEqual([{ version: 1, reminder_engine: "legacy" }]);
    await assertRuntimeQueueSchema(h.url, signal);
    expect(
      (
        await h.pool.query<{ name: string }>("SELECT name FROM pgboss.queue ORDER BY name")
      ).rows.map(({ name }) => name),
    ).toEqual([...QUEUE_NAMES].sort());

    expect(await applyCoreMigrations(h.db, h.url, signal)).toEqual(success);
    expect(await ledger(h)).toEqual(upgradedLedger);
    expect(await businessSnapshot(h)).toEqual(beforeBusiness);
    expect(queueErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
