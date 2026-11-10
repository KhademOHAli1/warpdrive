import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { activities, workflowRunFailures, workflowSteps } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { readRunDetail } from "./runDetail";
import { retryWorkflowRun } from "./runRetry";
import {
  type RetryFixture,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";
import {
  addCurrentColumnsForLegacyFixture,
  restoreLegacyWorkflowColumns,
} from "./runRetryLegacyMigration.test-helpers";

async function completedPrefix(h: RetryFixture, runId: string) {
  return h.db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(workflowSteps.id);
}

async function durableState(h: RetryFixture, runId: string) {
  return {
    run: await storedRetryRun(h, runId),
    failures: await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, runId))
      .orderBy(workflowRunFailures.id),
    steps: await completedPrefix(h, runId),
    effects: await h.db.select().from(activities).orderBy(activities.id),
  };
}

// Migration-state fixtures, distinct from the engine-generated failures in
// runRetryRead.integration.test.ts. Before0100 there is no failure-history table:
// reproduce only its predecessor status/error save, then run canonical0100 SQL.
// Never patch an origin, cursor, output, or published version into the fixture.
async function migratedFailure(cursor: "read" | "second_task") {
  const db = await freshMigrationDb();
  let candidate: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  const close = async () => {
    try {
      await candidate?.dispose();
    } finally {
      await db.close();
    }
  };
  try {
    await installPrefix(db, 100);
    expect(
      (await db.pool.query("SELECT to_regclass('public.workflow_run_failures') IS NULL AS absent"))
        .rows,
    ).toEqual([{ absent: true }]);
    await addCurrentColumnsForLegacyFixture(db);
    const h = await setupRetryActor(db);
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
    const completed = cursor === "read" ? 1 : 3;
    for (let step = 0; step < completed; step++)
      expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
        ok: true,
        value: "running",
      });
    expect((await storedRetryRun(h, admitted.value.id)).nextNodeId).toBe(cursor);
    const errorId = cursor === "read" ? ERROR_IDS.DEAL_NOT_FOUND : ERROR_IDS.PERM_DENIED;
    await h.pool.query(
      "UPDATE workflow_runs SET status='failed',error_id=$2,resume_at=NULL,updated_at='2026-01-02T03:04:05.123456Z' WHERE id=$1",
      [admitted.value.id, errorId],
    );
    const run = await storedRetryRun(h, admitted.value.id);
    const steps = await completedPrefix(h, run.id);
    const effects = await h.db.select().from(activities).orderBy(activities.id);
    await restoreLegacyWorkflowColumns(db);
    candidate = await migrationFolder(101);
    expect(await applyMigrations(h.db, retrySignal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await h.db.select().from(activities).orderBy(activities.id)).toEqual(effects);
    const [failure] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, run.id));
    if (failure === undefined) throw new Error("Canonical0100 legacy snapshot missing");
    expect(failure).toMatchObject({
      runId: run.id,
      nodeId: cursor,
      errorId,
      origin: "legacy_snapshot",
      retryRequestKey: null,
      retriedBy: null,
      retriedAt: null,
    });
    expect(
      (
        await h.pool.query(
          "SELECT failed_at='2026-01-02T03:04:05.123456Z'::timestamptz AS exact FROM workflow_run_failures WHERE run_id=$1",
          [run.id],
        )
      ).rows,
    ).toEqual([{ exact: true }]);
    expect(await applyMigrations(h.db, retrySignal())).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await storedRetryRun(h, run.id)).toEqual(run);
    expect(await completedPrefix(h, run.id)).toEqual(steps);
    return { h, run, failure, steps, effects, close };
  } catch (error) {
    await close();
    throw error;
  }
}

it("refuses a canonical0100 legacy read snapshot without consuming it or changing stored state", async () => {
  const f = await migratedFailure("read");
  try {
    const detail = await readRunDetail(f.h.db, f.h.actor, f.h.workflow.id, f.run.id, retrySignal());
    if (!detail.ok) throw new Error(detail.error);
    expect(detail.value.recovery).toMatchObject({
      eligible: false,
      reason: "legacy",
      failureId: f.failure.id,
      history: [{ id: f.failure.id, origin: "legacy_snapshot", retriedAt: null }],
    });
    const before = await durableState(f.h, f.run.id);
    const input = retryInput(f.run.id, f.failure.id);
    expect(await retryWorkflowRun(f.h.db, f.h.who, input, retrySignal())).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_NOT_READY,
    });
    expect(await durableState(f.h, f.run.id)).toEqual(before);
  } finally {
    await f.close();
  }
});

it("retains canonical0100 legacy task retry once with its original version and completed effects", async () => {
  const f = await migratedFailure("second_task");
  try {
    const detail = await readRunDetail(f.h.db, f.h.actor, f.h.workflow.id, f.run.id, retrySignal());
    if (!detail.ok) throw new Error(detail.error);
    expect(detail.value.recovery).toMatchObject({
      eligible: true,
      reason: "available",
      failureId: f.failure.id,
      history: [{ id: f.failure.id, origin: "legacy_snapshot" }],
    });
    const input = retryInput(f.run.id, f.failure.id);
    expect(await retryWorkflowRun(f.h.db, f.h.who, input, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: false },
    });
    const queued = await durableState(f.h, f.run.id);
    expect(queued.run).toMatchObject({
      status: "queued",
      nextNodeId: "second_task",
      versionId: f.run.versionId,
      outputs: f.run.outputs,
    });
    expect(queued.steps).toEqual(f.steps);
    expect(queued.effects).toEqual(f.effects);
    expect(queued.failures).toHaveLength(1);
    expect(queued.failures[0]).toMatchObject({
      id: f.failure.id,
      origin: "legacy_snapshot",
      retryRequestKey: input.requestKey,
      retriedBy: f.h.user.id,
      retriedAt: expect.any(Date),
    });
    expect(await retryWorkflowRun(f.h.db, f.h.who, input, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: true },
    });
    expect(await durableState(f.h, f.run.id)).toEqual(queued);
    await advanceWorkflowRun(f.h.db, f.run.id, retrySignal());
    const after = await durableState(f.h, f.run.id);
    expect(after.run).toMatchObject({ status: "succeeded", versionId: f.run.versionId });
    expect(after.steps.filter((step) => step.nodeId !== "second_task")).toEqual(f.steps);
    expect(after.steps.filter((step) => step.nodeId === "second_task")).toHaveLength(1);
    expect(after.effects).toHaveLength(f.effects.length + 1);
    expect(after.effects.filter((effect) => f.effects.some((old) => old.id === effect.id))).toEqual(
      f.effects,
    );
    expect(await retryWorkflowRun(f.h.db, f.h.who, input, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: true },
    });
    expect(await durableState(f.h, f.run.id)).toEqual(after);
  } finally {
    await f.close();
  }
});
