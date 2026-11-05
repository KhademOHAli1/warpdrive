import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, workflowRunFailures, workflowRuns, workflowSteps } from "@/db/schema";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
async function setupFilter(expectedStatus: string) {
  const test = await setupWorkflowExecution();
  try {
    const [start, read, task] = test.definition.nodes;
    assert(start !== undefined && read !== undefined && task !== undefined);
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        structuredClone(start),
        structuredClone(read),
        {
          id: "guard",
          type: "filter",
          version: 1,
          name: "Only matching opportunities",
          config: {
            defaultPort: "false",
            expression: {
              kind: "group",
              id: "rules",
              operator: "and",
              children: [
                {
                  kind: "predicate",
                  id: "status",
                  operator: "equals",
                  left: { kind: "reference", nodeId: "read", path: ["status"] },
                  right: { kind: "value", value: expectedStatus },
                },
              ],
            },
          },
        },
        structuredClone(task),
      ],
      edges: [
        { from: "start", to: "read", port: "next" },
        { from: "read", to: "guard", port: "next" },
        { from: "guard", to: "task", port: "next" },
      ],
    };
    const created = await createWorkflow(
      test.db,
      test.actor,
      { name: "Filtered follow up", definition },
      signal,
    );
    assert(created.ok, JSON.stringify(created));
    const published = await publishWorkflow(test.db, test.actor, created.value.id, 1, signal);
    assert(published.ok, JSON.stringify(published));
    return { ...test, definition, workflow: created.value, version: published.value };
  } catch (error) {
    await test.close();
    throw error;
  }
}
type FilterFixture = Awaited<ReturnType<typeof setupFilter>>;
async function admit(test: FilterFixture, mode: "live" | "simulation" = "live") {
  const result = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: test.workflow.id,
      recordId: test.deal.id,
      requestKey: crypto.randomUUID(),
      mode,
    },
    signal,
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function advance(test: FilterFixture, runId: string, count: number) {
  for (let index = 0; index < count; index++) {
    const result = await advanceWorkflowRun(test.db, runId, signal);
    assert(result.ok, JSON.stringify(result));
  }
}
async function stored(test: FilterFixture, runId: string) {
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  assert(run !== undefined);
  return run;
}
it.each([
  ["open", true],
  ["won", false],
] as const)(
  "publishes and runs a %s filter with one receipt and no non-match effect",
  async (expectedStatus, matchesFilter) => {
    const test = await setupFilter(expectedStatus);
    try {
      const run = await admit(test);
      await advance(test, run.id, 2);
      await Promise.all([
        advanceWorkflowRun(test.db, run.id, signal),
        advanceWorkflowRun(test.db, run.id, signal),
      ]);
      await advance(test, run.id, 3);
      const result = await stored(test, run.id);
      expect(result).toMatchObject({
        status: "succeeded",
        nextNodeId: null,
        errorId: null,
        versionId: test.version.id,
      });
      expect(result.outputs.guard).toEqual({ matchesFilter });
      const receipts = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.id));
      expect(receipts.filter((step) => step.nodeId === "guard")).toHaveLength(1);
      expect(receipts).toHaveLength(matchesFilter ? 4 : 3);
      const tasks = await test.db.select().from(activities);
      expect(tasks).toHaveLength(matchesFilter ? 1 : 0);
      expect(
        await test.db
          .select()
          .from(workflowRunFailures)
          .where(eq(workflowRunFailures.runId, run.id)),
      ).toEqual([]);
      if (!matchesFilter) expect(result.outputs).not.toHaveProperty("task");
    } finally {
      await test.close();
    }
  },
);
it.each([
  ["open", true],
  ["won", false],
] as const)(
  "keeps a %s simulation side-effect-free while recording filter termination",
  async (expectedStatus, matchesFilter) => {
    const test = await setupFilter(expectedStatus);
    try {
      const run = await admit(test, "simulation");
      await advance(test, run.id, 5);
      expect(await stored(test, run.id)).toMatchObject({
        status: "succeeded",
        outputs: { guard: { matchesFilter } },
      });
      expect(await test.db.select().from(activities)).toEqual([]);
      const receipts = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.id));
      expect(receipts).toHaveLength(matchesFilter ? 4 : 3);
      expect(receipts.every((step) => step.simulated)).toBe(true);
    } finally {
      await test.close();
    }
  },
);
it("fails a needed missing operand without misreporting a non-match or creating the next task", async () => {
  const test = await setupFilter("open");
  try {
    const run = await admit(test);
    await advance(test, run.id, 2);
    const before = await stored(test, run.id);
    const output = { ...before.outputs.read };
    delete output.status;
    await test.db
      .update(workflowRuns)
      .set({ outputs: { ...before.outputs, read: output } })
      .where(eq(workflowRuns.id, run.id));
    const receipts = await test.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, run.id));
    const readReceipt = receipts.find((step) => step.nodeId === "read");
    assert(readReceipt !== undefined);
    await test.db.update(workflowSteps).set({ output }).where(eq(workflowSteps.id, readReceipt.id));
    expect(await advanceWorkflowRun(test.db, run.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    const result = await stored(test, run.id);
    expect(result).toMatchObject({
      status: "failed",
      nextNodeId: "guard",
      errorId: ERROR_IDS.WORKFLOW_BINDING_MISSING,
    });
    expect(result.outputs).not.toHaveProperty("guard");
    expect(await test.db.select().from(activities)).toEqual([]);
    const after = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id));
    expect(after).toHaveLength(2);
  } finally {
    await test.close();
  }
});
it.each([
  ["open", ["start", "read", "guard", "task"]],
  ["won", ["start", "read", "guard"]],
] as const)(
  "draft simulation of %s returns the evaluated prefix and rolls back all writes",
  async (expectedStatus, nodeIds) => {
    const test = await setupFilter(expectedStatus);
    try {
      const result = await simulateWorkflowDraft(
        test.db,
        test.actor,
        {
          workflowId: test.workflow.id,
          recordId: test.deal.id,
          definition: test.definition,
        },
        signal,
      );
      assert(result.ok, JSON.stringify(result));
      expect(result.value.outcome).toBe("completed");
      expect(result.value.steps.map((step) => step.nodeId)).toEqual(nodeIds);
      expect(result.value.steps.find((step) => step.nodeId === "guard")).toMatchObject({
        nodeType: "filter",
        status: "succeeded",
      });
      expect(await test.db.select().from(activities)).toEqual([]);
      expect(await test.db.select().from(workflowRuns)).toEqual([]);
      expect(await test.db.select().from(workflowSteps)).toEqual([]);
    } finally {
      await test.close();
    }
  },
);
