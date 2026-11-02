import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { activities, deals, users, workflowRuns, workflowSteps } from "@/db/schema";
import { enterWait, makeDue, setupWaitingCandidate } from "./delay.test-helpers";
import { advanceWorkflowRun } from "./execution";
import { cancelWorkflowRun } from "./runControl";

const signal = new AbortController().signal;

it("persists one wait deadline and ignores early duplicate deliveries without effects", async () => {
  const test = await setupWaitingCandidate();
  try {
    const waiting = await enterWait(test);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect(await test.db.select().from(workflowSteps)).toHaveLength(1);
    await Promise.all([
      advanceWorkflowRun(test.db, test.run.id, signal),
      advanceWorkflowRun(test.db, test.run.id, signal),
    ]);
    expect((await test.db.select().from(workflowRuns))[0]).toEqual(waiting);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect(await test.db.select().from(workflowSteps)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("resumes an expired wait once under competing workers and creates one linked follow-up", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await makeDue(test);
    for (let i = 0; i < 4; i++) {
      await Promise.all([
        advanceWorkflowRun(test.db, test.run.id, signal),
        advanceWorkflowRun(test.db, test.run.id, signal),
      ]);
    }
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({ dealId: test.deal.id, assigneeId: test.actor.id }),
    );
    expect((await test.db.select().from(workflowRuns))[0]).toEqual(
      expect.objectContaining({ status: "succeeded", resumeAt: null, nextNodeId: null }),
    );
    const steps = await test.db.select().from(workflowSteps);
    expect(steps).toHaveLength(4);
    expect(steps.filter((step) => step.nodeId === "wait")).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("cancels a waiting run and rejects stale wakeups without a downstream effect", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    const before = await test.pool.query<{ milliseconds: number }>(
      "SELECT floor(extract(epoch from clock_timestamp()) * 1000)::double precision AS milliseconds",
    );
    const beforeMs = before.rows[0]?.milliseconds ?? Number.NaN;
    expect(Number.isFinite(beforeMs)).toBe(true);
    const cancelSignal = AbortSignal.timeout(5000);
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(beforeMs + 24 * 60 * 60 * 1000);
      expect(await cancelWorkflowRun(test.db, test.actor, test.run.id, cancelSignal)).toEqual({
        ok: true,
        value: "cancelled",
      });
    } finally {
      vi.useRealTimers();
    }
    const after = await test.pool.query<{ milliseconds: number }>(
      "SELECT floor(extract(epoch from clock_timestamp()) * 1000)::double precision AS milliseconds",
    );
    const afterMs = after.rows[0]?.milliseconds ?? Number.NaN;
    expect(Number.isFinite(afterMs)).toBe(true);
    await advanceWorkflowRun(test.db, test.run.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    const [run] = await test.db.select().from(workflowRuns);
    expect(run).toEqual(
      expect.objectContaining({ status: "cancelled", resumeAt: null, cancelledBy: test.actor.id }),
    );
    expect(run?.cancelledAt).toBeInstanceOf(Date);
    expect(run?.updatedAt).toBeInstanceOf(Date);
    const cancelledAtMs = run?.cancelledAt?.getTime() ?? Number.NaN;
    const updatedAtMs = run?.updatedAt.getTime() ?? Number.NaN;
    expect(cancelledAtMs).toBeGreaterThanOrEqual(beforeMs);
    expect(cancelledAtMs).toBeLessThanOrEqual(afterMs);
    expect(updatedAtMs).toBeGreaterThanOrEqual(beforeMs);
    expect(updatedAtMs).toBeLessThanOrEqual(afterMs);
  } finally {
    await test.close();
  }
});

it("rehydrates an inactive initiator on resume and fails without creating a task", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
    await makeDue(test);
    expect(await advanceWorkflowRun(test.db, test.run.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect((await test.db.select().from(workflowRuns))[0]).toEqual(
      expect.objectContaining({ status: "failed", resumeAt: null }),
    );
  } finally {
    await test.close();
  }
});

it("rereads a deal deleted during the wait and refuses the downstream task", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await test.db.update(deals).set({ deletedAt: new Date() }).where(eq(deals.id, test.deal.id));
    await makeDue(test);
    for (let i = 0; i < 3; i++) await advanceWorkflowRun(test.db, test.run.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("failed");
  } finally {
    await test.close();
  }
});

it("previews a delay immediately in simulation and rolls back its downstream task", async () => {
  const test = await setupWaitingCandidate("simulation");
  try {
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, test.run.id, signal);
    expect((await test.db.select().from(workflowRuns))[0]).toEqual(
      expect.objectContaining({ status: "succeeded", resumeAt: null }),
    );
    expect(await test.db.select().from(activities)).toHaveLength(0);
    const steps = await test.db.select().from(workflowSteps);
    expect(steps.find((step) => step.nodeId === "wait")).toEqual(
      expect.objectContaining({ simulated: true, output: { resumeAt: expect.any(String) } }),
    );
  } finally {
    await test.close();
  }
});
