import { asc, inArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_WORKFLOW_RECONCILE, PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { getBoss } from "@/jobs/boss";
import { advanceWorkflowRun } from "./execution";

const JOB_OPTIONS = { retryLimit: 3, expireInSeconds: 60, singletonSeconds: 30 };

export async function enqueueWorkflowRun(boss: PgBoss, runId: string) {
  return boss.send(PGBOSS_QUEUE_WORKFLOW_RUN, { runId }, { ...JOB_OPTIONS, singletonKey: runId });
}

// Admission is already durable. A queue outage must not turn a successful admission into a
// misleading failure: boot/minutely reconciliation recovers the persisted cursor.
export async function nudgeWorkflowRun(runId: string): Promise<void> {
  const boss = getBoss();
  if (boss === null) return;
  try {
    await enqueueWorkflowRun(boss, runId);
  } catch {
    console.warn("Workflow queue unavailable; persisted run awaits reconciliation", { runId });
  }
}

export async function reconcileWorkflowRuns(boss: PgBoss, db: Db, signal: AbortSignal) {
  const rows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(inArray(workflowRuns.status, ["queued", "running"]))
    .orderBy(asc(workflowRuns.updatedAt))
    .limit(100);
  signal.throwIfAborted();
  for (const row of rows) {
    await enqueueWorkflowRun(boss, row.id);
    signal.throwIfAborted();
  }
}

export async function registerWorkflowJobs(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RUN);
  await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RECONCILE);
  await boss.work<{ runId: string }>(PGBOSS_QUEUE_WORKFLOW_RUN, async ([job]) => {
    if (job === undefined) return;
    const signal = AbortSignal.any([job.signal, AbortSignal.timeout(45_000)]);
    for (let step = 0; step < 100; step++) {
      const result = await advanceWorkflowRun(db, job.data.runId, signal);
      if (!result.ok)
        throw new AppError(ERROR_IDS.WORKFLOW_WRITE_FAILED, "Workflow advance failed");
      if (result.value !== "running") return;
    }
    // Graphs are bounded to 100 nodes. Remaining cursors are picked up by reconciliation.
  });
  await boss.work(PGBOSS_QUEUE_WORKFLOW_RECONCILE, async ([job]) => {
    if (job === undefined) return;
    await reconcileWorkflowRuns(
      boss,
      db,
      AbortSignal.any([job.signal, AbortSignal.timeout(45_000)]),
    );
  });
  await boss.schedule(PGBOSS_QUEUE_WORKFLOW_RECONCILE, "* * * * *");
  await boss.send(PGBOSS_QUEUE_WORKFLOW_RECONCILE);
}
