import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { activities, permissionSets, workflowRunFailures, workflowSteps } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow } from "./persistence";
import { retryWorkflowRun } from "./runRetry";
import type { RetryFixture } from "./runRetry.test-helpers";
import {
  repairRetryPermission,
  retryFlags,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";

async function oldFailedWait(h: RetryFixture) {
  await repairRetryPermission(h);
  const definition = structuredClone(h.definition);
  definition.nodes.push({
    id: "wait",
    type: "delay",
    version: 1,
    name: "Old wait",
    config: { minutes: { kind: "value", value: 1 } },
  });
  const start = definition.edges.find((edge) => edge.from === "start");
  if (start === undefined) throw new Error("Missing start edge");
  start.to = "wait";
  definition.edges.push({ from: "wait", to: "read", port: "next" });
  const created = await createWorkflow(
    h.db,
    h.actor,
    { name: "Old waiting customer", definition },
    retrySignal(),
  );
  if (!created.ok) throw new Error(created.error);
  const published = await publishWorkflow(
    h.db,
    h.actor,
    created.value.id,
    created.value.revision,
    retrySignal(),
  );
  if (!published.ok) throw new Error(published.error);
  const admitted = await admitManualRun(
    h.db,
    h.actor,
    {
      workflowId: created.value.id,
      requestKey: crypto.randomUUID(),
      recordId: h.deal.id,
      mode: "live",
    },
    retrySignal(),
  );
  if (!admitted.ok) throw new Error(admitted.error);
  expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
    ok: true,
    value: "running",
  });
  expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
    ok: true,
    value: "waiting",
  });
  expect((await storedRetryRun(h, admitted.value.id)).status).toBe("waiting");
  // The predecessor failure path erased the deadline. Its absence must survive
  // migration honestly; a new duration would change the accepted run's meaning.
  await h.pool.query(
    "UPDATE workflow_runs SET status='failed',error_id='E_WORKFLOW_001',resume_at=NULL,updated_at='2026-01-02T03:04:06.123456Z' WHERE id=$1",
    [admitted.value.id],
  );
  return admitted.value.id;
}

it("upgrades stored failed-task customers without changing old rows and resumes their failed cursor once", async () => {
  const db = await freshMigrationDb();
  await installPrefix(db, 100);
  expect(
    (await db.pool.query("SELECT to_regclass('public.workflow_run_failures') IS NULL AS absent"))
      .rows,
  ).toEqual([{ absent: true }]);
  const h = await setupRetryActor(db);
  const candidate = await migrationFolder(101);
  try {
    const migrations = await readCanonicalMigrations(candidate.folder, retrySignal());
    if (!migrations.ok) throw new Error(migrations.error);
    expect(migrations.value).toHaveLength(101);
    expect(migrations.value[100]?.tag).toBe("0100_workflow_failed_step_retry");
    const admitted = await admitManualRun(
      h.db,
      h.actor,
      {
        workflowId: h.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: h.deal.id,
        mode: "live",
      },
      retrySignal(),
    );
    if (!admitted.ok) throw new Error(admitted.error);
    // Only successful predecessor-compatible steps run before0100. The new
    // failure writer is deliberately never invoked while its table is absent.
    for (let n = 0; n < 3; n++)
      expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
        ok: true,
        value: "running",
      });
    await h.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "activity.create": false } })
      .where(eq(permissionSets.id, h.permissions.id));
    // Exact predecessor shape: the old failure path saved these facts and had no history table.
    await h.pool.query(
      "UPDATE workflow_runs SET status='failed',error_id='E_PERM_001',resume_at=NULL,updated_at='2026-01-02T03:04:05.123456Z' WHERE id=$1",
      [admitted.value.id],
    );
    const waitId = await oldFailedWait(h);
    const before = (
      await h.pool.query("SELECT to_jsonb(r) AS data FROM workflow_runs r ORDER BY id")
    ).rows;
    const steps = (
      await h.pool.query("SELECT to_jsonb(s) AS data FROM workflow_steps s ORDER BY id")
    ).rows;
    const effects = await h.db.select().from(activities);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(100);
    expect(await applyMigrations(h.db, retrySignal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(
      (await h.pool.query("SELECT to_jsonb(r) AS data FROM workflow_runs r ORDER BY id")).rows,
    ).toEqual(before);
    expect(
      (await h.pool.query("SELECT to_jsonb(s) AS data FROM workflow_steps s ORDER BY id")).rows,
    ).toEqual(steps);
    expect(await h.db.select().from(activities)).toEqual(effects);
    const failures = await h.db.select().from(workflowRunFailures);
    const failure = failures.find((row) => row.runId === admitted.value.id);
    expect(failure?.origin).toBe("legacy_snapshot");
    expect(failure?.nodeId).toBe("second_task");
    expect(failure?.errorId).toBe("E_PERM_001");
    expect(
      (
        await h.pool.query(
          "SELECT failed_at='2026-01-02T03:04:05.123456Z'::timestamptz AS exact FROM workflow_run_failures WHERE run_id=$1",
          [admitted.value.id],
        )
      ).rows,
    ).toEqual([{ exact: true }]);
    const receipt = await ledger(h);
    expect(receipt).toHaveLength(101);
    expect(receipt.slice(0, 100)).toEqual(oldLedger);
    expect(receipt[100]).toMatchObject({
      hash: migrations.value[100]?.hash,
      created_at: String(migrations.value[100]?.when),
    });
    expect(await applyMigrations(h.db, retrySignal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(receipt);
    expect(await h.db.select().from(workflowRunFailures)).toEqual(failures);
    await repairRetryPermission(h);
    const lostWait = failures.find((row) => row.runId === waitId);
    if (lostWait === undefined) throw new Error("Legacy wait snapshot absent");
    expect(lostWait).toMatchObject({
      nodeId: "wait",
      origin: "legacy_snapshot",
      originalResumeAt: null,
    });
    const waitBefore = await storedRetryRun(h, waitId);
    expect(
      (await retryWorkflowRun(h.db, h.who, retryInput(waitId, lostWait.id), retrySignal())).ok,
    ).toBe(false);
    expect(await storedRetryRun(h, waitId)).toEqual(waitBefore);
    if (failure === undefined) throw new Error("Legacy failure generation absent");
    const input = retryInput(admitted.value.id, failure.id);
    expect((await retryWorkflowRun(h.db, h.who, input, retrySignal())).ok).toBe(true);
    await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
    expect((await storedRetryRun(h, admitted.value.id)).status).toBe("succeeded");
    expect(await h.db.select().from(activities)).toHaveLength(2);
    expect((await retryWorkflowRun(h.db, h.who, input, retrySignal())).ok).toBe(true);
    expect(await h.db.select().from(activities)).toHaveLength(2);
    expect(
      (
        await h.db.select().from(workflowSteps).where(eq(workflowSteps.runId, admitted.value.id))
      ).filter((step) => step.nodeId !== "second_task"),
    ).toHaveLength(3);
  } finally {
    await candidate.dispose();
    await h.close();
  }
});
