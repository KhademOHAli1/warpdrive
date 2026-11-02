import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { activities, workflowRuns } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { registerWorkflowJobs } from "./worker";

it("recovers a partially executed run on worker boot through real pg-boss", async () => {
  const test = await setupWorkflowExecution();
  const boss = new PgBoss({ connectionString: test.url, maintenanceIntervalSeconds: 1 });
  boss.on("error", () => undefined);
  try {
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: test.deal.id,
        mode: "live",
      },
      AbortSignal.timeout(5000),
    );
    if (!admitted.ok) throw new Error(admitted.error);
    await advanceWorkflowRun(test.db, admitted.value.id, AbortSignal.timeout(5000));
    await boss.start();
    await registerWorkflowJobs(boss, test.db);
    await expect
      .poll(
        async () => {
          const [run] = await test.db
            .select()
            .from(workflowRuns)
            .where(eq(workflowRuns.id, admitted.value.id));
          return run?.status;
        },
        { timeout: 15_000 },
      )
      .toBe("succeeded");
    expect(await test.db.select().from(activities)).toHaveLength(1);
    expect((await boss.getSchedules()).some((row) => row.name === "workflow.reconcile")).toBe(true);
  } finally {
    await boss.stop();
    await test.close();
  }
});
