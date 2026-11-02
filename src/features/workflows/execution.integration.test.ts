import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, users, workflowRuns, workflowSteps } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";

import { setupWorkflowExecution } from "./execution.test-helpers";

const signal = new AbortController().signal;

it("admits once, pins a version, and creates one activity with competing workers", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = {
      workflowId: test.workflow.id,
      requestKey: "8a7ded38-69d4-43b0-b63d-5aa5d88942a8",
      recordId: test.deal.id,
      mode: "live",
    };
    const results = await Promise.all([
      admitManualRun(test.db, test.actor, input, signal),
      admitManualRun(test.db, test.actor, input, signal),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const runs = await test.db.select().from(workflowRuns);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.versionId).toBe(test.version.id);
    for (let i = 0; i < 4; i++)
      await Promise.all([
        advanceWorkflowRun(test.db, run.id, signal),
        advanceWorkflowRun(test.db, run.id, signal),
      ]);
    const tasks = await test.db
      .select()
      .from(activities)
      .where(eq(activities.dealId, test.deal.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.subject).toBe("تماس با مشتری");
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("succeeded");
    expect(await test.db.select().from(workflowSteps)).toHaveLength(3);
  } finally {
    await test.close();
  }
});

it("simulates the activity without writing a customer-facing record", async () => {
  const test = await setupWorkflowExecution();
  try {
    const result = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: "2f6b5ae1-4a90-4e9a-8ad3-19f03ec1d92b",
        recordId: test.deal.id,
        mode: "simulation",
      },
      signal,
    );
    if (!result.ok) throw new Error(result.error);
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, result.value.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    const [run] = await test.db.select().from(workflowRuns);
    expect(run?.status).toBe("succeeded");
    const steps = await test.db.select().from(workflowSteps);
    expect(steps.find((step) => step.nodeId === "task")?.simulated).toBe(true);
  } finally {
    await test.close();
  }
});

it("rehydrates authority after admission and stops an inactive user before effects", async () => {
  const test = await setupWorkflowExecution();
  try {
    const result = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: "f1748c06-3080-427b-ac90-e25de30cba85",
        recordId: test.deal.id,
        mode: "live",
      },
      signal,
    );
    if (!result.ok) throw new Error(result.error);
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.user.id));
    await advanceWorkflowRun(test.db, result.value.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("failed");
  } finally {
    await test.close();
  }
});
