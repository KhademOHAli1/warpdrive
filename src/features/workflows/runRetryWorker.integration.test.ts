import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";
import { activities, workflowSteps } from "@/db/schema";
import { retryWorkflowRun } from "./runRetry";
import {
  failLaterTask,
  repairRetryPermission,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";
import { registerWorkflowJobs } from "./worker";

it("recovers a committed retry on production worker boot and ignores stale duplicate delivery", async () => {
  const h = await setupRetryActor();
  const boss = new PgBoss({ connectionString: h.url, maintenanceIntervalSeconds: 1 });
  boss.on("error", () => undefined);
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    expect(
      (await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal())).ok,
    ).toBe(true);
    // No admission nudge is sent: worker boot must reconcile the durable queued state.
    await boss.start();
    await registerWorkflowJobs(boss, h.db);
    await expect
      .poll(async () => (await storedRetryRun(h, f.run.id)).status, { timeout: 15000 })
      .toBe("succeeded");
    const effects = await h.db.select().from(activities);
    const steps = await h.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, f.run.id))
      .orderBy(workflowSteps.id);
    expect(effects).toHaveLength(2);
    expect(steps.filter((step) => step.nodeId !== "second_task")).toEqual(f.beforeSteps);
    // Force a distinct stale delivery: the production singleton window could
    // suppress another enqueue and give a false duplicate-delivery pass.
    const duplicate = await boss.send(PGBOSS_QUEUE_WORKFLOW_RUN, { runId: f.run.id });
    if (duplicate === null) throw new Error("Duplicate job was not admitted");
    await expect
      .poll(async () => (await boss.getJobById(PGBOSS_QUEUE_WORKFLOW_RUN, duplicate))?.state, {
        timeout: 15000,
      })
      .toBe("completed");
    expect((await storedRetryRun(h, f.run.id)).status).toBe("succeeded");
    expect(await h.db.select().from(activities)).toEqual(effects);
    expect(
      await h.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, f.run.id))
        .orderBy(workflowSteps.id),
    ).toEqual(steps);
  } finally {
    try {
      await boss.stop({ close: true, graceful: true, timeout: 5000 });
    } finally {
      await h.close();
    }
  }
});
