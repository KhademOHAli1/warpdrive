import { and, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  customFieldDefs,
  deals,
  permissionSets,
  users,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { readRunHistory } from "./queries";
import { readRunDetail } from "./runDetail";
import { retryFlags, setupRetryActor } from "./runRetry.test-helpers";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

const signal = new AbortController().signal;
type Fixture = Awaited<ReturnType<typeof setupMapping>>;
const ref = (nodeId: string, field: string) => ({
  kind: "reference" as const,
  nodeId,
  path: [field],
});

async function setupMapping() {
  const test = await setupRetryActor();
  try {
    const [dateField, userField] = await test.db
      .insert(customFieldDefs)
      .values([
        {
          targetEntity: "activity",
          type: "date",
          key: "mapped_date",
          name: "Mapped civil date",
          order: 1,
        },
        {
          targetEntity: "activity",
          type: "user",
          key: "mapped_owner",
          name: "Mapped current owner",
          order: 2,
        },
      ])
      .returning();
    assert(dateField !== undefined && userField !== undefined);
    await test.db
      .update(deals)
      .set({ expectedCloseDate: "2028-02-29", value: "123456789012.34" })
      .where(eq(deals.id, test.deal.id));
    const definition: WorkflowDefinition = {
      ...structuredClone(test.definition),
      nodes: test.definition.nodes.filter((node) => node.id !== "second_task"),
      edges: test.definition.edges.filter((edge) => edge.to !== "second_task"),
    };
    return { ...test, definition, dateField, userField };
  } catch (error) {
    await test.close();
    if (error instanceof Error) throw error;
    throw new Error("Mapping runtime fixture setup failed", { cause: error });
  }
}

function mappedDefinition(test: Fixture, owner = false): WorkflowDefinition {
  const fields = {
    [test.dateField.id]: ref("read", "expectedCloseDate"),
    ...(owner ? { [test.userField.id]: ref("read", "ownerId") } : {}),
  };
  return {
    ...structuredClone(test.definition),
    nodes: test.definition.nodes.map((node) =>
      node.id === "task" ? { ...node, config: { ...node.config, customFields: fields } } : node,
    ),
  };
}

async function publish(test: Fixture, definition: WorkflowDefinition) {
  const [current] = await test.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, test.workflow.id));
  assert(current !== undefined);
  const saved = await saveWorkflowDraft(
    test.db,
    test.actor,
    {
      id: current.id,
      revision: current.revision,
      name: "Typed mapping process",
      definition,
    },
    signal,
  );
  assert(saved.ok, JSON.stringify(saved));
  return publishWorkflow(test.db, test.actor, current.id, saved.value.revision, signal);
}

async function admit(
  test: Fixture,
  mode: "live" | "simulation" = "live",
  requestKey = crypto.randomUUID(),
) {
  const run = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: test.workflow.id,
      requestKey,
      recordId: test.deal.id,
      mode,
    },
    signal,
  );
  assert(run.ok, JSON.stringify(run));
  return run.value;
}

async function advance(test: Fixture, runId: string, count: number) {
  for (let index = 0; index < count; index++) {
    const result = await advanceWorkflowRun(test.db, runId, signal);
    assert(result.ok, JSON.stringify(result));
  }
}

async function storedRun(test: Fixture, runId: string) {
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  assert(run !== undefined);
  return run;
}

async function expectNoEffectFailure(test: Fixture, runId: string, errorId?: string) {
  await advance(test, runId, 4);
  const run = await storedRun(test, runId);
  expect(run.status).toBe("failed");
  if (errorId !== undefined) expect(run.errorId).toBe(errorId);
  expect(await test.db.select().from(activities)).toEqual([]);
  const steps = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, runId));
  expect(steps.some((step) => step.nodeId === "task")).toBe(false);
}

function conditionDefinition(
  test: Fixture,
  left: WorkflowNode["config"][string],
  right: WorkflowNode["config"][string],
  operator = "equals",
): WorkflowDefinition {
  const task = test.definition.nodes.find((node) => node.id === "task");
  assert(task !== undefined);
  return {
    ...structuredClone(test.definition),
    nodes: [
      ...test.definition.nodes.filter((node) => node.id !== "task"),
      {
        id: "check",
        name: "Typed comparison",
        type: "condition",
        version: 1,
        config: { left, right, operator },
      },
      {
        ...task,
        id: "matched",
        config: { ...task.config, subject: { kind: "value", value: "Matched typed value" } },
      },
      {
        ...task,
        id: "other",
        config: { ...task.config, subject: { kind: "value", value: "Different typed value" } },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "other", port: "false" },
    ],
  };
}

it("projects the actual visible canonical civil date, exact decimal and owner identity in a completed read receipt", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, test.definition)).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    const current = await storedRun(test, run.id);
    expect(current.outputs.read).toEqual({
      id: test.deal.id,
      title: test.deal.title,
      ownerId: test.actor.id,
      stageId: test.deal.stageId,
      status: test.deal.status,
      value: "123456789012.34",
      currency: test.deal.currency,
      expectedCloseDate: "2028-02-29",
    });
    const [receipt] = await test.db
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.runId, run.id), eq(workflowSteps.nodeId, "read")));
    expect(receipt?.output).toEqual(current.outputs.read);
    expect(await test.db.select().from(activities)).toEqual([]);
    const history = await readRunHistory(test.db, test.actor, test.workflow.id, signal);
    const detail = await readRunDetail(test.db, test.actor, test.workflow.id, run.id, signal);
    assert(history.ok && detail.ok);
    expect(history.value).toHaveLength(1);
    expect(history.value[0]).not.toHaveProperty("outputs");
    expect(history.value[0]).not.toHaveProperty("trigger");
    expect(detail.value).not.toHaveProperty("outputs");
    expect(detail.value.definition).toEqual(test.definition);
    for (const step of [...history.value[0]!.steps, ...detail.value.steps]) {
      expect(step).not.toHaveProperty("output");
      expect(step).not.toHaveProperty("expectedCloseDate");
    }
    const safe = JSON.stringify({ history: history.value, detail: detail.value });
    expect(safe).not.toContain("2028-02-29");
    expect(safe).not.toContain("123456789012.34");
  } finally {
    await test.close();
  }
});

it("writes date and current user identity mappings through the actual canonical custom task pipeline", async () => {
  const test = await setupMapping();
  try {
    const published = await publish(test, mappedDefinition(test, true));
    assert(published.ok, JSON.stringify(published));
    const pinned = structuredClone(published.value);
    const run = await admit(test);
    await advance(test, run.id, 4);
    expect((await storedRun(test, run.id)).status).toBe("succeeded");
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerId: test.actor.id,
      dealId: test.deal.id,
      customFields: { mapped_date: "2028-02-29", mapped_owner: test.actor.id },
    });
    expect(
      await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, pinned.id)),
    ).toEqual([pinned]);
  } finally {
    await test.close();
  }
});

it("retains nullable date output as null and fails an optional but nonnullable custom target before effects", async () => {
  const test = await setupMapping();
  try {
    await test.db.update(deals).set({ expectedCloseDate: null }).where(eq(deals.id, test.deal.id));
    const published = await publish(test, mappedDefinition(test));
    assert(published.ok, JSON.stringify(published));
    const run = await admit(test);
    await advance(test, run.id, 2);
    expect((await storedRun(test, run.id)).outputs.read?.expectedCloseDate).toBeNull();
    await expectNoEffectFailure(test, run.id, ERROR_IDS.WORKFLOW_INVALID);
  } finally {
    await test.close();
  }
});

it("treats a legacy completed read without the date property as missing, without fetching today's value", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    const current = await storedRun(test, run.id);
    const read = { ...current.outputs.read };
    delete read.expectedCloseDate;
    // A stored pre-WF020 receipt has all the original real fields but no new column.
    await test.db
      .update(workflowRuns)
      .set({ outputs: { ...current.outputs, read } })
      .where(eq(workflowRuns.id, run.id));
    await test.db
      .update(workflowSteps)
      .set({ output: read })
      .where(and(eq(workflowSteps.runId, run.id), eq(workflowSteps.nodeId, "read")));
    await test.db
      .update(deals)
      .set({ expectedCloseDate: "2040-01-01" })
      .where(eq(deals.id, test.deal.id));
    await expectNoEffectFailure(test, run.id, ERROR_IDS.WORKFLOW_BINDING_MISSING);
    expect((await storedRun(test, run.id)).outputs.read).not.toHaveProperty("expectedCloseDate");
  } finally {
    await test.close();
  }
});

it("checks the original runner's current deal visibility before projecting any date or owner output", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 1);
    const other = await seedUser(test.db);
    await test.db
      .update(deals)
      .set({ ownerId: other.id, visibilityLevel: "owner" })
      .where(eq(deals.id, test.deal.id));
    await expectNoEffectFailure(test, run.id);
    expect((await storedRun(test, run.id)).outputs).not.toHaveProperty("read");
  } finally {
    await test.close();
  }
});

it("rereads visibility at the task boundary after a real date receipt was completed", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    const read = structuredClone((await storedRun(test, run.id)).outputs.read);
    const other = await seedUser(test.db);
    await test.db
      .update(deals)
      .set({ ownerId: other.id, visibilityLevel: "owner" })
      .where(eq(deals.id, test.deal.id));
    await expectNoEffectFailure(test, run.id);
    expect((await storedRun(test, run.id)).outputs.read).toEqual(read);
  } finally {
    await test.close();
  }
});

it("does not use a retained actor's revoked activity permission for a mapped task", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "activity.create": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    await expectNoEffectFailure(test, run.id, ERROR_IDS.PERM_DENIED);
  } finally {
    await test.close();
  }
});

it("rehydrates an inactive original actor before a mapped task, preserving its completed date receipt", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    const read = structuredClone((await storedRun(test, run.id)).outputs.read);
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
    await expectNoEffectFailure(test, run.id, ERROR_IDS.WORKFLOW_DENIED);
    expect((await storedRun(test, run.id)).outputs.read).toEqual(read);
  } finally {
    await test.close();
  }
});

it("checks a projected owner user is still active before a canonical user custom-field write", async () => {
  const test = await setupMapping();
  try {
    const owner = await seedUser(test.db);
    await test.db
      .update(deals)
      .set({ ownerId: owner.id, visibilityLevel: "all" })
      .where(eq(deals.id, test.deal.id));
    assert((await publish(test, mappedDefinition(test, true))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    expect((await storedRun(test, run.id)).outputs.read?.ownerId).toBe(owner.id);
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
    await expectNoEffectFailure(test, run.id, ERROR_IDS.WORKFLOW_DENIED);
    const [runner] = await test.db.select().from(users).where(eq(users.id, test.actor.id));
    expect(runner?.isActive).toBe(true);
  } finally {
    await test.close();
  }
});

it("uses fresh metadata after admission and refuses a date reference whose actual target became numeric", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test))).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    await test.db
      .update(customFieldDefs)
      .set({ type: "numeric" })
      .where(eq(customFieldDefs.id, test.dateField.id));
    await expectNoEffectFailure(test, run.id, ERROR_IDS.WORKFLOW_INVALID);
  } finally {
    await test.close();
  }
});

it("commits one mapped task under repeated admission and competing live deliveries", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test, true))).ok);
    const key = crypto.randomUUID();
    const run = await admit(test, "live", key);
    expect((await admit(test, "live", key)).id).toBe(run.id);
    await advance(test, run.id, 2);
    const results = await Promise.all([
      advanceWorkflowRun(test.db, run.id, signal),
      advanceWorkflowRun(test.db, run.id, signal),
    ]);
    expect(results).toEqual([
      { ok: true, value: "succeeded" },
      { ok: true, value: "succeeded" },
    ]);
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customFields).toEqual({
      mapped_date: "2028-02-29",
      mapped_owner: test.actor.id,
    });
    const steps = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id));
    expect(steps).toHaveLength(3);
    expect(steps.filter((step) => step.nodeId === "task")).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("uses the same typed custom pipeline in simulation while rolling back every CRM task and deal write", async () => {
  const test = await setupMapping();
  try {
    assert((await publish(test, mappedDefinition(test, true))).ok);
    const before = await test.db.select().from(deals).where(eq(deals.id, test.deal.id));
    const run = await admit(test, "simulation");
    await advance(test, run.id, 4);
    expect((await storedRun(test, run.id)).status).toBe("succeeded");
    expect(await test.db.select().from(activities)).toEqual([]);
    expect(await test.db.select().from(deals).where(eq(deals.id, test.deal.id))).toEqual(before);
    const steps = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id));
    expect(steps).toHaveLength(3);
    expect(steps.every((step) => step.simulated)).toBe(true);
    expect(steps.find((step) => step.nodeId === "task")?.output.id).toEqual(expect.any(String));
  } finally {
    await test.close();
  }
});

it.each(["2028-02-29", "2028-03-01"])(
  "uses the actual canonical date receipt to choose only the correct date-equality branch for %s",
  async (right) => {
    const test = await setupMapping();
    try {
      const graph = conditionDefinition(test, ref("read", "expectedCloseDate"), {
        kind: "value",
        value: right,
        literalType: "date",
      });
      const published = await publish(test, graph);
      assert(published.ok, JSON.stringify(published));
      const run = await admit(test);
      await advance(test, run.id, 6);
      expect((await storedRun(test, run.id)).status).toBe("succeeded");
      const rows = await test.db.select().from(activities);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.subject).toBe(
        right === "2028-02-29" ? "Matched typed value" : "Different typed value",
      );
    } finally {
      await test.close();
    }
  },
);

it("retains exact-decimal-string contains on an actual read and condition without numeric conversion", async () => {
  const test = await setupMapping();
  try {
    assert(
      (
        await publish(
          test,
          conditionDefinition(
            test,
            ref("read", "value"),
            { kind: "value", value: "9012.34" },
            "contains",
          ),
        )
      ).ok,
    );
    const run = await admit(test);
    await advance(test, run.id, 6);
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("Matched typed value");
    expect((await storedRun(test, run.id)).outputs.read?.value).toBe("123456789012.34");
  } finally {
    await test.close();
  }
});

it("compares a real completed wait deadline to an equivalent offset instant before a single task effect", async () => {
  const test = await setupMapping();
  try {
    const graph = conditionDefinition(test, ref("wait", "resumeAt"), {
      kind: "value",
      literalType: "instant",
      value: "2000-01-01T01:00:00+01:00",
    });
    graph.nodes = graph.nodes
      .filter((node) => node.id !== "read")
      .map((node) =>
        node.type === "activity.create"
          ? { ...node, config: { ...node.config, dealId: ref("start", "recordId") } }
          : node,
      );
    graph.nodes.push({
      id: "wait",
      name: "Elapsed real wait",
      type: "delay",
      version: 1,
      config: { minutes: { kind: "value", value: 1 } },
    });
    graph.edges = [
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "other", port: "false" },
    ];
    assert((await publish(test, graph)).ok);
    const run = await admit(test);
    await advance(test, run.id, 2);
    expect((await storedRun(test, run.id)).status).toBe("waiting");
    await test.db
      .update(workflowRuns)
      .set({ resumeAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(workflowRuns.id, run.id));
    await advance(test, run.id, 4);
    expect((await storedRun(test, run.id)).outputs.wait).toEqual({
      resumeAt: "2000-01-01T00:00:00.000Z",
    });
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("Matched typed value");
  } finally {
    await test.close();
  }
});

it("retains a known invalid tagged draft but refuses publication before any run or activity exists", async () => {
  const test = await setupMapping();
  try {
    const graph = conditionDefinition(
      test,
      { kind: "value", value: 0 },
      { kind: "value", value: "12", literalType: "number" },
    );
    expect(await publish(test, graph)).toMatchObject({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    const [draft] = await test.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, test.workflow.id));
    expect(draft?.draft.nodes.find((node) => node.id === "check")?.config.right).toEqual({
      kind: "value",
      value: "12",
      literalType: "number",
    });
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});
