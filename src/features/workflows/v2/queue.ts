import type { PgBoss } from "pg-boss";
import { getBoss } from "@/jobs/boss";

export const WORKFLOW_V2_RUN_QUEUE = "workflow-v2-run";

/** Preserve the existing message/options while keeping execution consumers out of Web imports. */
export async function enqueueWorkflowV2Run(boss: PgBoss, runId: string) {
  return boss.send(
    WORKFLOW_V2_RUN_QUEUE,
    { runId },
    { retryLimit: 2, expireInSeconds: 60, singletonSeconds: 1, singletonKey: runId },
  );
}

export async function nudgeWorkflowV2Run(runId: string): Promise<void> {
  const boss = getBoss();
  if (boss === null) return;
  try {
    await enqueueWorkflowV2Run(boss, runId);
  } catch {
    console.warn("Workflow v2 queue unavailable; durable run awaits reconciliation", { runId });
  }
}
