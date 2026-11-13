import type { PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";
import { getBoss } from "@/jobs/boss";

const JOB_OPTIONS = { retryLimit: 3, expireInSeconds: 60, singletonSeconds: 30 };

/** Producer contract shared by Web admission and worker reconciliation. No consumer imports. */
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
  await nudgeWorkflowRunWithBoss(boss, runId);
}

export async function nudgeWorkflowRunWithBoss(
  boss: PgBoss,
  runId: string,
  deadline?: Date,
): Promise<void> {
  try {
    await enqueueWorkflowRun(boss, runId, deadline);
  } catch {
    console.warn("Workflow queue unavailable; persisted run awaits reconciliation", { runId });
  }
}
