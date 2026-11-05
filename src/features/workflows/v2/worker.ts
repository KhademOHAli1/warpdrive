import type { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { getBoss } from "@/jobs/boss";
import { createWorkflowV2Adapters } from "./adapters";
import { drainWorkflowV2RecordOutbox } from "./recordOutbox";
import { advanceWorkflowV2Run } from "./runner";
import { reconcileWorkflowV2 } from "./scheduling";

const RUN = "workflow-v2-run",
  RECONCILE = "workflow-v2-reconcile";
async function enqueue(boss: PgBoss, runId: string) {
  return boss.send(
    RUN,
    { runId },
    { retryLimit: 2, expireInSeconds: 60, singletonSeconds: 1, singletonKey: runId },
  );
}
export async function nudgeWorkflowV2Run(runId: string): Promise<void> {
  const boss = getBoss();
  if (boss === null) return;
  try {
    await enqueue(boss, runId);
  } catch {
    console.warn("Workflow v2 queue unavailable; durable run awaits reconciliation", { runId });
  }
}
export async function registerWorkflowV2Jobs(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(RUN);
  await boss.createQueue(RECONCILE);
  await boss.work<{ runId: string }>(RUN, async ([job]) => {
    if (job === undefined) return;
    const signal = AbortSignal.timeout(45_000);
    const adapters = createWorkflowV2Adapters();
    let more = false;
    for (let step = 0; step < 20; step++) {
      const result = await advanceWorkflowV2Run(db, job.data.runId, adapters, signal);
      more = result.status === "running" || result.status === "queued";
      if (!more) break;
    }
    if (more) await enqueue(boss, job.data.runId);
  });
  await boss.work(RECONCILE, async () => {
    const signal = AbortSignal.timeout(45_000);
    const adapters = createWorkflowV2Adapters();
    const outbox = await drainWorkflowV2RecordOutbox(db, adapters, signal);
    const ready = await reconcileWorkflowV2(db, adapters, signal);
    for (const id of new Set([...outbox, ...ready])) await enqueue(boss, id);
  });
  await boss.schedule(RECONCILE, "* * * * *", {}, { tz: "UTC" });
  await boss.send(RECONCILE, {});
}
