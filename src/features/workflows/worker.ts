import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  PGBOSS_QUEUE_WORKFLOW_RECONCILE,
  PGBOSS_QUEUE_WORKFLOW_RUN,
  PGBOSS_QUEUE_WORKFLOW_SCHEDULE,
} from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { getBoss } from "@/jobs/boss";
import { advanceWorkflowRun } from "./execution";
import { dispatchWorkflowSchedules } from "./workflowScheduleWorker";

const JOB_OPTIONS = { retryLimit: 3, expireInSeconds: 60, singletonSeconds: 30 };
const RECONCILE_BATCH_SIZE = 100;
const DUE_WAIT_CAPACITY = 50;
const WAKE_LOOKAHEAD_SECONDS = 90;

export async function enqueueWorkflowRun(boss: PgBoss, runId: string, deadline?: Date) {
  return boss.send(
    PGBOSS_QUEUE_WORKFLOW_RUN,
    { runId },
    {
      ...JOB_OPTIONS,
      singletonKey: deadline === undefined ? runId : `${runId}:${deadline.getTime()}`,
      ...(deadline === undefined ? {} : { startAfter: deadline }),
    },
  );
}

// Admission is already durable. A queue outage must not turn a successful admission into a
// misleading failure: boot/minutely reconciliation recovers the persisted cursor.
export async function nudgeWorkflowRun(runId: string): Promise<void> {
  const boss = getBoss();
  if (boss === null) return;
  await nudge(boss, runId);
}

async function nudge(boss: PgBoss, runId: string, deadline?: Date): Promise<void> {
  try {
    await enqueueWorkflowRun(boss, runId, deadline);
  } catch {
    console.warn("Workflow queue unavailable; persisted run awaits reconciliation", { runId });
  }
}

export async function reconcileWorkflowRuns(boss: PgBoss, db: Db, signal: AbortSignal) {
  // Use the database clock and queue only imminent wakes. Earlier deadlines
  // retain priority when waiting and ready backlogs both fill the batch.
  const waiting = await db
    .select({ id: workflowRuns.id, resumeAt: workflowRuns.resumeAt })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.status, "waiting"),
        lte(
          workflowRuns.resumeAt,
          sql`statement_timestamp() + ${WAKE_LOOKAHEAD_SECONDS} * interval '1 second'`,
        ),
      ),
    )
    .orderBy(asc(workflowRuns.resumeAt), asc(workflowRuns.id))
    .limit(DUE_WAIT_CAPACITY);
  signal.throwIfAborted();
  const ready = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        inArray(workflowRuns.status, ["queued", "running"]),
        waiting.length === 0
          ? undefined
          : notInArray(
              workflowRuns.id,
              waiting.map((row) => row.id),
            ),
      ),
    )
    .orderBy(asc(workflowRuns.updatedAt), asc(workflowRuns.id))
    .limit(RECONCILE_BATCH_SIZE - waiting.length);
  signal.throwIfAborted();
  for (const row of waiting) {
    await enqueueWorkflowRun(boss, row.id, row.resumeAt ?? undefined);
    signal.throwIfAborted();
  }
  for (const row of ready) {
    await enqueueWorkflowRun(boss, row.id);
    signal.throwIfAborted();
  }
}

async function advanceQueuedRun(boss: PgBoss, db: Db, runId: string, signal: AbortSignal) {
  try {
    const result = await advanceWorkflowRun(db, runId, signal, async (deadline, now) => {
      if (deadline.getTime() - now.getTime() <= WAKE_LOOKAHEAD_SECONDS * 1000)
        await nudge(boss, runId, deadline);
    });
    if (result.ok) return result.value;
  } catch {
    // pg-boss persists thrown errors. Database error messages can contain private step values.
  }
  throw new AppError(ERROR_IDS.WORKFLOW_WRITE_FAILED, "Workflow advance failed");
}

export async function registerWorkflowJobs(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RUN);
  await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RECONCILE);
  await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_SCHEDULE);
  await boss.work<{ runId: string }>(PGBOSS_QUEUE_WORKFLOW_RUN, async ([job]) => {
    if (job === undefined) return;
    const signal = AbortSignal.any([job.signal, AbortSignal.timeout(45_000)]);
    for (let step = 0; step < 100; step++) {
      const status = await advanceQueuedRun(boss, db, job.data.runId, signal);
      if (status !== "running") return;
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
  let scheduleAfterId: string | null = null;
  await boss.work(PGBOSS_QUEUE_WORKFLOW_SCHEDULE, async ([job]) => {
    if (job === undefined) return;
    const signal = AbortSignal.any([job.signal, AbortSignal.timeout(45_000)]);
    try {
      scheduleAfterId = await dispatchWorkflowSchedules(
        db,
        scheduleAfterId,
        (runId) => nudge(boss, runId),
        signal,
      );
    } catch {
      // Queue failures must not retain a database message or a workflow definition.
      throw new AppError(ERROR_IDS.WORKFLOW_WRITE_FAILED, "Workflow schedule scan failed");
    }
  });
  await boss.schedule(PGBOSS_QUEUE_WORKFLOW_SCHEDULE, "* * * * *");
  await boss.send(PGBOSS_QUEUE_WORKFLOW_RECONCILE);
  await boss.send(PGBOSS_QUEUE_WORKFLOW_SCHEDULE);
}
