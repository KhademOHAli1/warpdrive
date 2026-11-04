import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  deals,
  permissionSets,
  users,
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import {
  admitGroupRun,
  advanceGroupRun,
  type ConditionGroupsFixture,
  groupConfig,
  groupExpression,
  groupPredicate,
  groupReference,
  groupSignal,
  groupValue,
  publishGroupGraph,
  removeLegacyDateReceipt,
  saveGroupGraph,
  seedCorruptGroupRun,
  setupConditionGroups,
  storedGroupRun,
  storedGroupSteps,
  withGroupConfig,
} from "./conditionGroupsRuntime.test-helpers";
import { advanceWorkflowRun } from "./execution";
import { archiveWorkflow } from "./lifecycle";
import { publishWorkflow } from "./persistence";
import { cancelWorkflowRun } from "./runControl";
import { retryFlags } from "./runRetry.test-helpers";

async function currentWorkflow(test: ConditionGroupsFixture) {
  const [workflow] = await test.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, test.workflow.id));
  assert(workflow !== undefined);
  return workflow;
}
async function expectFailedBeforeCondition(
  test: ConditionGroupsFixture,
  runId: string,
  errorId: string,
) {
  const before = await storedGroupRun(test, runId);
  const prefix = await storedGroupSteps(test, runId);
  expect(before.nextNodeId).toBe("check");
  expect(await advanceWorkflowRun(test.db, runId, groupSignal)).toEqual({
    ok: true,
    value: "failed",
  });
  const failed = await storedGroupRun(test, runId);
  expect(failed).toMatchObject({
    status: "failed",
    errorId,
    nextNodeId: "check",
    versionId: before.versionId,
  });
  expect(failed.outputs).toEqual(before.outputs);
  expect(failed.outputs).not.toHaveProperty("check");
  expect(await storedGroupSteps(test, runId)).toEqual(prefix);
  expect(prefix.map((step) => step.nodeId)).toEqual(["read", "start"]);
  expect(await test.db.select().from(activities)).toEqual([]);
  const failures = await test.db
    .select()
    .from(workflowRunFailures)
    .where(eq(workflowRunFailures.runId, runId));
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({ nodeId: "check", errorId });
}
function nullableDateConfig(operator: "and" | "or") {
  return groupConfig(
    groupExpression("guarded", operator, [
      groupPredicate("status", groupReference("status"), "equals", groupValue("open")),
      groupPredicate("date", groupReference("expectedCloseDate"), "exists"),
    ]),
  );
}

it("commits one true-path task for a nested AND/OR match using the actual civil-date read", async () => {
  const test = await setupConditionGroups();
  try {
    const version = await publishGroupGraph(test);
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 6);
    const stored = await storedGroupRun(test, run.id);
    expect(stored).toMatchObject({ status: "succeeded", versionId: version.id });
    expect(stored.outputs.check).toEqual({ result: true });
    expect(stored.outputs.read?.expectedCloseDate).toBe("2028-02-29");
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      subject: "Matched grouped path",
      dealId: test.deal.id,
      ownerId: test.actor.id,
    });
    const steps = await storedGroupSteps(test, run.id);
    expect(steps.map((step) => step.nodeId)).toEqual(["check", "matched", "read", "start"]);
    expect(steps.find((step) => step.nodeId === "check")?.output).toEqual({ result: true });
    expect(
      await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, version.id)),
    ).toEqual([version]);
  } finally {
    await test.close();
  }
});

it("selects only the explicit false/default path when empty text is true but a nullable value does not exist", async () => {
  const test = await setupConditionGroups();
  try {
    await test.db.update(deals).set({ title: "", value: null }).where(eq(deals.id, test.deal.id));
    const config = groupConfig(
      groupExpression("presence", "and", [
        groupPredicate("empty_title", groupReference("title"), "isEmpty"),
        groupPredicate("has_value", groupReference("value"), "exists"),
      ]),
    );
    await publishGroupGraph(test, withGroupConfig(test, config));
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 6);
    const stored = await storedGroupRun(test, run.id);
    expect(stored.status).toBe("succeeded");
    expect(stored.outputs.read).toMatchObject({ title: "", value: null });
    expect(stored.outputs.check).toEqual({ result: false });
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.subject).toBe("Default grouped path");
    expect((await storedGroupSteps(test, run.id)).map((step) => step.nodeId)).toEqual([
      "check",
      "otherwise",
      "read",
      "start",
    ]);
  } finally {
    await test.close();
  }
});

it("short-circuits a real legacy missing date receipt without backfilling or running both branches", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test, withGroupConfig(test, nullableDateConfig("or")));
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 2);
    await removeLegacyDateReceipt(test, run.id);
    const oldRead = structuredClone((await storedGroupRun(test, run.id)).outputs.read);
    await test.db
      .update(deals)
      .set({ expectedCloseDate: "2040-01-01" })
      .where(eq(deals.id, test.deal.id));
    await advanceGroupRun(test, run.id, 4);
    const stored = await storedGroupRun(test, run.id);
    expect(stored.status).toBe("succeeded");
    expect(stored.outputs.check).toEqual({ result: true });
    expect(stored.outputs.read).toEqual(oldRead);
    expect(stored.outputs.read).not.toHaveProperty("expectedCloseDate");
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.subject).toBe("Matched grouped path");
  } finally {
    await test.close();
  }
});

it("fails a needed historical missing value before condition receipt, cursor advance or default effects", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test, withGroupConfig(test, nullableDateConfig("and")));
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 2);
    await removeLegacyDateReceipt(test, run.id);
    await expectFailedBeforeCondition(test, run.id, ERROR_IDS.WORKFLOW_BINDING_MISSING);
  } finally {
    await test.close();
  }
});

it("rejects publication of a static-invalid skipped predicate while preserving the old published pointer and saved draft", async () => {
  const test = await setupConditionGroups();
  try {
    const config = groupConfig(
      groupExpression("invalid_hidden_row", "or", [
        groupPredicate("first", groupValue(true), "equals", groupValue(true)),
        groupPredicate("invalid", groupReference("undeclaredField"), "exists"),
      ]),
    );
    const saved = await saveGroupGraph(test, withGroupConfig(test, config));
    expect(
      await publishWorkflow(test.db, test.actor, saved.id, saved.revision, groupSignal),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(await currentWorkflow(test)).toEqual(saved);
    expect(
      await test.db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, test.workflow.id)),
    ).toEqual([test.version]);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
    expect(await test.db.select().from(workflowSteps)).toEqual([]);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});

it.each(["duplicate-true", "missing-default", "dangling-default"] as const)(
  "fails a separately seeded %s stored graph before committing the condition receipt or cursor",
  async (fault) => {
    const test = await setupConditionGroups();
    try {
      const version = await publishGroupGraph(test);
      const valid = await admitGroupRun(test);
      await advanceGroupRun(test, valid.id, 2);
      const workflow = await currentWorkflow(test);
      const bad = structuredClone(version.definition);
      if (fault === "duplicate-true")
        bad.edges.push({ from: "check", to: "otherwise", port: "true" });
      if (fault === "missing-default")
        bad.edges = bad.edges.filter((edge) => edge.from !== "check" || edge.port !== "false");
      if (fault === "dangling-default")
        bad.edges = bad.edges.map((edge) =>
          edge.from === "check" && edge.port === "false" ? { ...edge, to: "missing_node" } : edge,
        );
      const corrupt = await seedCorruptGroupRun(test, valid.id, bad);
      await expectFailedBeforeCondition(test, corrupt.run.id, ERROR_IDS.WORKFLOW_INVALID);
      expect(await currentWorkflow(test)).toEqual(workflow);
      expect(
        await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, version.id)),
      ).toEqual([version]);
      expect(
        await test.db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, corrupt.version.id)),
      ).toEqual([corrupt.version]);
      expect((await storedGroupRun(test, valid.id)).status).toBe("running");
    } finally {
      await test.close();
    }
  },
);

it("keeps an admitted old version pinned when a new grouped definition is published", async () => {
  const test = await setupConditionGroups();
  try {
    const old = await admitGroupRun(test);
    await advanceGroupRun(test, old.id, 2);
    const prefix = await storedGroupSteps(test, old.id);
    const grouped = await publishGroupGraph(test);
    const current = await admitGroupRun(test);
    await advanceGroupRun(test, old.id, 6);
    await advanceGroupRun(test, current.id, 6);
    const oldStored = await storedGroupRun(test, old.id);
    const newStored = await storedGroupRun(test, current.id);
    expect(oldStored).toMatchObject({ status: "succeeded", versionId: test.version.id });
    expect(oldStored.outputs).not.toHaveProperty("check");
    expect(newStored).toMatchObject({ status: "succeeded", versionId: grouped.id });
    expect(newStored.outputs.check).toEqual({ result: true });
    const oldSteps = await storedGroupSteps(test, old.id);
    expect(oldSteps.filter((step) => step.nodeId === "read" || step.nodeId === "start")).toEqual(
      prefix,
    );
    const tasks = await test.db.select().from(activities);
    expect(tasks.map((task) => task.subject).sort()).toEqual(
      ["Earlier completed task", "Matched grouped path", "Recovered later task"].sort(),
    );
    expect(
      await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, test.version.id)),
    ).toEqual([test.version]);
  } finally {
    await test.close();
  }
});

it("refuses an implicit join at public publication rather than treating exclusive branches as parallel work", async () => {
  const test = await setupConditionGroups();
  try {
    const definition = structuredClone(test.definition);
    definition.edges.push({ from: "otherwise", to: "matched", port: "next" });
    const saved = await saveGroupGraph(test, definition);
    expect(
      await publishWorkflow(test.db, test.actor, saved.id, saved.revision, groupSignal),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(await currentWorkflow(test)).toEqual(saved);
    expect(
      await test.db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, test.workflow.id)),
    ).toEqual([test.version]);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
    expect(await test.db.select().from(workflowSteps)).toEqual([]);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});

it.each(["inactive", "run-revoked"] as const)(
  "rehydrates the original %s actor before grouped evaluation",
  async (change) => {
    const test = await setupConditionGroups();
    try {
      await publishGroupGraph(test);
      const run = await admitGroupRun(test);
      await advanceGroupRun(test, run.id, 2);
      if (change === "inactive")
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
      else
        await test.db
          .update(permissionSets)
          .set({ flags: { ...retryFlags, "workflow.run": false } })
          .where(eq(permissionSets.id, test.permissions.id));
      await expectFailedBeforeCondition(test, run.id, ERROR_IDS.WORKFLOW_DENIED);
    } finally {
      await test.close();
    }
  },
);

it("fails archived work before group evaluation while preserving real completed prefix receipts", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test);
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 2);
    const workflow = await currentWorkflow(test);
    const archived = await archiveWorkflow(
      test.db,
      test.actor,
      { id: workflow.id, revision: workflow.revision },
      groupSignal,
    );
    assert(archived.ok, JSON.stringify(archived));
    await expectFailedBeforeCondition(test, run.id, ERROR_IDS.WORKFLOW_DENIED);
  } finally {
    await test.close();
  }
});

it("preserves cancellation without evaluating the condition or creating a default effect", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test);
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 2);
    const prefix = await storedGroupSteps(test, run.id);
    expect(await cancelWorkflowRun(test.db, test.actor, run.id, groupSignal)).toEqual({
      ok: true,
      value: "cancelled",
    });
    expect(await advanceWorkflowRun(test.db, run.id, groupSignal)).toEqual({
      ok: true,
      value: "cancelled",
    });
    const stored = await storedGroupRun(test, run.id);
    expect(stored).toMatchObject({
      status: "cancelled",
      cancelledBy: test.actor.id,
      nextNodeId: "check",
    });
    expect(stored.outputs).not.toHaveProperty("check");
    expect(await storedGroupSteps(test, run.id)).toEqual(prefix);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});

it("serializes competing group deliveries and replayed admission into one condition receipt and one effect", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test);
    const key = crypto.randomUUID();
    const run = await admitGroupRun(test, "live", key);
    expect((await admitGroupRun(test, "live", key)).id).toBe(run.id);
    await advanceGroupRun(test, run.id, 2);
    const deliveries = await Promise.all([
      advanceWorkflowRun(test.db, run.id, groupSignal),
      advanceWorkflowRun(test.db, run.id, groupSignal),
    ]);
    expect(deliveries.every((result) => result.ok)).toBe(true);
    await advanceGroupRun(test, run.id, 3);
    expect((await storedGroupRun(test, run.id)).status).toBe("succeeded");
    const steps = await storedGroupSteps(test, run.id);
    expect(steps).toHaveLength(4);
    expect(steps.filter((step) => step.nodeId === "check")).toHaveLength(1);
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.subject).toBe("Matched grouped path");
  } finally {
    await test.close();
  }
});

it("evaluates the same grouped pipeline in simulation and rolls back every CRM task and linked deal write", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test);
    const before = await test.db.select().from(deals).where(eq(deals.id, test.deal.id));
    const run = await admitGroupRun(test, "simulation");
    await advanceGroupRun(test, run.id, 6);
    const stored = await storedGroupRun(test, run.id);
    expect(stored.status).toBe("succeeded");
    expect(stored.outputs.check).toEqual({ result: true });
    expect(await test.db.select().from(activities)).toEqual([]);
    expect(await test.db.select().from(deals).where(eq(deals.id, test.deal.id))).toEqual(before);
    const steps = await storedGroupSteps(test, run.id);
    expect(steps).toHaveLength(4);
    expect(steps.every((step) => step.simulated)).toBe(true);
  } finally {
    await test.close();
  }
});

it("rereads current linked-record visibility before the effect after a condition used its completed receipt", async () => {
  const test = await setupConditionGroups();
  try {
    await publishGroupGraph(test);
    const run = await admitGroupRun(test);
    await advanceGroupRun(test, run.id, 3);
    expect((await storedGroupRun(test, run.id)).outputs.check).toEqual({ result: true });
    const prefix = await storedGroupSteps(test, run.id);
    const other = await seedUser(test.db);
    await test.db
      .update(deals)
      .set({ ownerId: other.id, visibilityLevel: "owner" })
      .where(eq(deals.id, test.deal.id));
    expect(await advanceWorkflowRun(test.db, run.id, groupSignal)).toEqual({
      ok: true,
      value: "failed",
    });
    const failed = await storedGroupRun(test, run.id);
    expect(failed.status).toBe("failed");
    expect(failed.nextNodeId).toBe("matched");
    expect(failed.outputs.check).toEqual({ result: true });
    expect(await storedGroupSteps(test, run.id)).toEqual(prefix);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});
