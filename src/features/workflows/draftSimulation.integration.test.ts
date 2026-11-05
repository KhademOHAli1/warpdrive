import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityGuests,
  activityParticipants,
  activityReminderIntents,
  customFieldDefs,
  deals,
  notifications,
  permissionSets,
  persons,
  pipelines,
  users,
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { simulateWorkflowDraft } from "./draftSimulation";
import type { DraftSimulationReceipt } from "./draftSimulationReceipt";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    assert(actor !== null);
    const pipeline = await seedPipelineWithStages(test.db, ["Proposal"]);
    const stage = pipeline.stages[0];
    assert(stage !== undefined);
    const [deal] = await test.db
      .insert(deals)
      .values({
        title: "PRIVATE_CUSTOMER_TITLE_NOT_FOR_DRAFT_RECEIPT",
        ownerId: user.id,
        pipelineId: pipeline.pipeline.id,
        stageId: stage.id,
        visibilityLevel: "owner",
      })
      .returning();
    assert(deal !== undefined);
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
        {
          id: "read",
          type: "record.read",
          version: 1,
          name: "Read selected deal",
          config: {
            entity: "deal",
            recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
          },
        },
        {
          id: "task",
          type: "activity.create",
          version: 1,
          name: "PRIVATE_AUTHORED_STEP_NAME",
          config: {
            subject: { kind: "value", value: "SAVED_SUBJECT_NOT_FOR_RECEIPT" },
            dealId: { kind: "reference", nodeId: "read", path: ["id"] },
          },
        },
      ],
      edges: [
        { from: "start", to: "read", port: "next" },
        { from: "read", to: "task", port: "next" },
      ],
    };
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "Saved inactive draft", definition },
      signal,
    );
    assert(created.ok, JSON.stringify(created));
    return {
      ...test,
      user,
      actor,
      deal,
      pipeline: pipeline.pipeline,
      definition,
      workflow: created.value,
    };
  } catch (error) {
    await test.close();
    throw error;
  }
}

function task(definition: WorkflowDefinition) {
  const node = definition.nodes.find((entry) => entry.type === "activity.create");
  assert(node !== undefined);
  return node;
}

function input(test: Fixture, definition = test.definition) {
  return { workflowId: test.workflow.id, recordId: test.deal.id, definition };
}

async function regularOwner(
  test: Fixture,
  rights: { edit: boolean; run: boolean; activity: boolean },
) {
  const [permissions] = await test.db
    .insert(permissionSets)
    .values({
      name: "Draft simulation operator",
      flags: {
        "workflow.edit": rights.edit,
        "workflow.run": rights.run,
        "activity.create": rights.activity,
      },
    })
    .returning();
  assert(permissions !== undefined);
  await test.db
    .update(users)
    .set({ isAdmin: false, permissionSetId: permissions.id })
    .where(eq(users.id, test.user.id));
}

async function queueSnapshot(test: Fixture) {
  const relation = await test.pool.query<{ relation: string | null }>(
    "SELECT to_regclass('pgboss.job')::text AS relation",
  );
  const row = relation.rows[0];
  assert(row !== undefined);
  if (row.relation === null) return null;
  const jobs = await test.pool.query<{ id: string }>(
    "SELECT id::text AS id FROM pgboss.job ORDER BY id",
  );
  return jobs.rows;
}

async function durableSnapshot(test: Fixture) {
  return {
    workflows: await test.db.select().from(workflows).orderBy(workflows.id),
    versions: await test.db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await test.db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await test.db.select().from(workflowSteps).orderBy(workflowSteps.id),
    failures: await test.db.select().from(workflowRunFailures).orderBy(workflowRunFailures.id),
    activities: await test.db.select().from(activities).orderBy(activities.id),
    guests: await test.db
      .select()
      .from(activityGuests)
      .orderBy(activityGuests.activityId, activityGuests.personId),
    participants: await test.db
      .select()
      .from(activityParticipants)
      .orderBy(activityParticipants.activityId, activityParticipants.userId),
    reminderIntents: await test.db
      .select()
      .from(activityReminderIntents)
      .orderBy(activityReminderIntents.activityId),
    notifications: await test.db.select().from(notifications).orderBy(notifications.id),
    deals: await test.db.select().from(deals).orderBy(deals.id),
    customDefinitions: await test.db.select().from(customFieldDefs).orderBy(customFieldDefs.id),
    queue: await queueSnapshot(test),
  };
}

function expectSafeReceipt(
  receipt: DraftSimulationReceipt,
  test: Fixture,
  definition: WorkflowDefinition,
) {
  expect(receipt).toMatchObject({
    source: "draft",
    mode: "simulation",
    workflowId: test.workflow.id,
    definitionDigest: createHash("sha256").update(JSON.stringify(definition)).digest("hex"),
  });
  expect(Number.isFinite(Date.parse(receipt.testedAt))).toBe(true);
  expect(Object.keys(receipt).sort()).toEqual(
    ["source", "mode", "workflowId", "definitionDigest", "testedAt", "outcome", "steps"].sort(),
  );
  const allowedStepKeys = new Set([
    "nodeId",
    "nodeType",
    "status",
    "errorId",
    "port",
    "waitResumeAt",
  ]);
  const knownErrors = new Set<string>(Object.values(ERROR_IDS));
  for (const step of receipt.steps) {
    expect(Object.keys(step).every((key) => allowedStepKeys.has(key))).toBe(true);
    expect(
      definition.nodes.some((node) => node.id === step.nodeId && node.type === step.nodeType),
    ).toBe(true);
    if (step.errorId !== undefined) expect(knownErrors.has(step.errorId)).toBe(true);
  }
  const serialized = JSON.stringify(receipt);
  expect(serialized).not.toContain(test.deal.id);
  expect(serialized).not.toContain(test.actor.id);
  expect(serialized).not.toContain(test.deal.title);
  expect(serialized).not.toContain("PRIVATE_AUTHORED_STEP_NAME");
  expect(serialized).not.toContain("SAVED_SUBJECT_NOT_FOR_RECEIPT");
  expect(serialized).not.toContain("UNSAVED_SUBJECT_NOT_FOR_RECEIPT");
}

it("simulates the exact unsaved inactive and unpublished draft without saving or retaining effects", async () => {
  const test = await setup();
  try {
    const unsaved = structuredClone(test.definition);
    task(unsaved).id = "unsaved_task";
    task(unsaved).config.subject = { kind: "value", value: "UNSAVED_SUBJECT_NOT_FOR_RECEIPT" };
    unsaved.edges[1]!.to = "unsaved_task";
    // Authored JSON order is deliberate: its cut digest is not a parsed/reordered graph digest.
    const definition: WorkflowDefinition = {
      edges: unsaved.edges,
      nodes: unsaved.nodes,
      schemaVersion: unsaved.schemaVersion,
    };
    const before = await durableSnapshot(test);
    expect(test.workflow).toMatchObject({ active: false, publishedNumber: null, revision: 1 });
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expectSafeReceipt(result.value, test, definition);
    expect(result.value.outcome).toBe("completed");
    expect(result.value.steps.map((step) => [step.nodeId, step.status])).toEqual([
      ["start", "succeeded"],
      ["read", "succeeded"],
      ["unsaved_task", "succeeded"],
    ]);
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("tests unsaved input while preserving an existing active publication and stored draft", async () => {
  const test = await setup();
  try {
    const published = await publishWorkflow(test.db, test.actor, test.workflow.id, 1, signal);
    assert(published.ok, JSON.stringify(published));
    const definition = structuredClone(test.definition);
    task(definition).id = "only_in_unsaved_input";
    definition.edges[1]!.to = "only_in_unsaved_input";
    const before = await durableSnapshot(test);
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expect(result.value.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "read",
      "only_in_unsaved_input",
    ]);
    expect(result.value.outcome).toBe("completed");
    expect(await durableSnapshot(test)).toEqual(before);
    expect(before.versions).toEqual([published.value]);
  } finally {
    await test.close();
  }
});

it("rolls back an earlier task preview when a later reached task has a hidden linked deal", async () => {
  const test = await setup();
  try {
    const other = await seedUser(test.db);
    const [hidden] = await test.db
      .insert(deals)
      .values({
        title: "HIDDEN_DEAL_NAME",
        ownerId: other.id,
        pipelineId: test.pipeline.id,
        stageId: test.deal.stageId,
        visibilityLevel: "owner",
      })
      .returning();
    assert(hidden !== undefined);
    await regularOwner(test, { edit: true, run: true, activity: true });
    const definition = structuredClone(test.definition);
    definition.nodes.push({
      ...structuredClone(task(definition)),
      id: "hidden_task",
      config: {
        subject: { kind: "value", value: "HIDDEN_TASK_SUBJECT" },
        dealId: { kind: "value", value: hidden.id },
      },
    });
    definition.edges.push({ from: "task", to: "hidden_task", port: "next" });
    const before = await durableSnapshot(test);
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expectSafeReceipt(result.value, test, definition);
    expect(result.value).toMatchObject({ outcome: "failed" });
    expect(result.value.steps).toEqual([
      expect.objectContaining({ nodeId: "start", status: "succeeded" }),
      expect.objectContaining({ nodeId: "read", status: "succeeded" }),
      expect.objectContaining({ nodeId: "task", status: "succeeded" }),
      expect.objectContaining({
        nodeId: "hidden_task",
        status: "failed",
        errorId: ERROR_IDS.DEAL_NOT_FOUND,
      }),
    ]);
    expect(JSON.stringify(result.value)).not.toContain(hidden.id);
    expect(JSON.stringify(result.value)).not.toContain("HIDDEN_DEAL_NAME");
    expect(JSON.stringify(result.value)).not.toContain("HIDDEN_TASK_SUBJECT");
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("returns the reached task's current activity permission failure without retaining a run", async () => {
  const test = await setup();
  try {
    await regularOwner(test, { edit: true, run: true, activity: false });
    const before = await durableSnapshot(test);
    const result = await simulateWorkflowDraft(test.db, test.actor, input(test), signal);
    assert(result.ok, JSON.stringify(result));
    expect(result.value.outcome).toBe("failed");
    expect(result.value.steps.at(-1)).toMatchObject({
      nodeId: "task",
      status: "failed",
      errorId: ERROR_IDS.PERM_DENIED,
    });
    expectSafeReceipt(result.value, test, test.definition);
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("propagates an already aborted signal and leaves no durable simulation evidence", async () => {
  const test = await setup();
  try {
    const controller = new AbortController();
    controller.abort(new Error("Draft test stopped"));
    const before = await durableSnapshot(test);
    await expect(
      simulateWorkflowDraft(test.db, test.actor, input(test), controller.signal),
    ).rejects.toThrow("Draft test stopped");
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rolls back and propagates an unexpected canonical activity database failure", async () => {
  const test = await setup();
  try {
    const definition = structuredClone(test.definition);
    task(definition).config.subject = { kind: "value", value: "FORCE_DRAFT_DATABASE_FAILURE" };
    await test.pool.query(
      "ALTER TABLE activities ADD CONSTRAINT draft_test_database_failure CHECK (subject <> 'FORCE_DRAFT_DATABASE_FAILURE')",
    );
    const before = await durableSnapshot(test);
    await expect(
      simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).rejects.toThrow();
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it.each([
  { edit: false, run: true },
  { edit: true, run: false },
])("requires current owner edit=$edit and run=$run despite a stale admin actor", async (rights) => {
  const test = await setup();
  try {
    await regularOwner(test, { ...rights, activity: true });
    const before = await durableSnapshot(test);
    expect(await simulateWorkflowDraft(test.db, test.actor, input(test), signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("denies an archived workflow even when its caller still has admin authority", async () => {
  const test = await setup();
  try {
    await test.db
      .update(workflows)
      .set({ archivedAt: new Date() })
      .where(eq(workflows.id, test.workflow.id));
    const before = await durableSnapshot(test);
    expect(await simulateWorkflowDraft(test.db, test.actor, input(test), signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rehydrates actor deactivation before permitting draft execution", async () => {
  const test = await setup();
  try {
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.user.id));
    const before = await durableSnapshot(test);
    expect(await simulateWorkflowDraft(test.db, test.actor, input(test), signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("checks selected-deal visibility even when the submitted graph only has a manual trigger", async () => {
  const test = await setup();
  try {
    const other = await seedUser(test.db);
    await regularOwner(test, { edit: true, run: true, activity: true });
    await test.db.update(deals).set({ ownerId: other.id }).where(eq(deals.id, test.deal.id));
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [structuredClone(test.definition.nodes[0]!)],
      edges: [],
    };
    const before = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.DEAL_NOT_FOUND,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it.each([
  { expected: "true", status: "open", reached: "matched" },
  { expected: "false", status: "won", reached: "other" },
])(
  "evaluates only the $expected branch of the unsaved draft",
  async ({ expected, status, reached }) => {
    const test = await setup();
    try {
      const definition: WorkflowDefinition = {
        ...structuredClone(test.definition),
        nodes: [
          structuredClone(test.definition.nodes[0]!),
          structuredClone(test.definition.nodes[1]!),
          {
            id: "check",
            type: "condition",
            version: 1,
            name: "Private status comparison",
            config: {
              left: { kind: "reference", nodeId: "read", path: ["status"] },
              operator: "equals",
              right: { kind: "value", value: status },
            },
          },
          { ...structuredClone(task(test.definition)), id: "matched" },
          { ...structuredClone(task(test.definition)), id: "other" },
        ],
        edges: [
          { from: "start", to: "read", port: "next" },
          { from: "read", to: "check", port: "next" },
          { from: "check", to: "matched", port: "true" },
          { from: "check", to: "other", port: "false" },
        ],
      };
      const before = await durableSnapshot(test);
      const result = await simulateWorkflowDraft(
        test.db,
        test.actor,
        input(test, definition),
        signal,
      );
      assert(result.ok, JSON.stringify(result));
      expect(result.value.outcome).toBe("completed");
      expect(result.value.steps.map((step) => step.nodeId)).toEqual([
        "start",
        "read",
        "check",
        reached,
      ]);
      expect(result.value.steps.find((step) => step.nodeId === "check")).toMatchObject({
        status: "succeeded",
        port: expected,
      });
      expectSafeReceipt(result.value, test, definition);
      expect(await durableSnapshot(test)).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

it("advances delays immediately and projects each wait from its own step clock without accumulating virtual time", async () => {
  const test = await setup();
  try {
    const definition = structuredClone(test.definition);
    definition.nodes.push(
      {
        id: "first_wait",
        type: "delay",
        version: 1,
        name: "First projected wait",
        config: { minutes: { kind: "value", value: 10 } },
      },
      {
        id: "second_wait",
        type: "delay",
        version: 1,
        name: "Second projected wait",
        config: { minutes: { kind: "value", value: 20 } },
      },
    );
    definition.edges = [
      { from: "start", to: "first_wait", port: "next" },
      { from: "first_wait", to: "second_wait", port: "next" },
      { from: "second_wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ];
    const before = await durableSnapshot(test);
    const began = await test.pool.query<{ at: Date }>("SELECT clock_timestamp() AS at");
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    const ended = await test.pool.query<{ at: Date }>("SELECT clock_timestamp() AS at");
    assert(result.ok, JSON.stringify(result));
    assert(began.rows[0] !== undefined && ended.rows[0] !== undefined);
    expect(result.value.outcome).toBe("completed");
    expect(result.value.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "first_wait",
      "second_wait",
      "read",
      "task",
    ]);
    const first = result.value.steps.find((step) => step.nodeId === "first_wait");
    const second = result.value.steps.find((step) => step.nodeId === "second_wait");
    assert(first?.waitResumeAt !== undefined && second?.waitResumeAt !== undefined);
    const firstAt = Date.parse(first.waitResumeAt);
    const secondAt = Date.parse(second.waitResumeAt);
    expect(firstAt).toBeGreaterThanOrEqual(began.rows[0].at.getTime() + 10 * 60_000 - 1);
    expect(firstAt).toBeLessThanOrEqual(ended.rows[0].at.getTime() + 10 * 60_000 + 1);
    expect(secondAt).toBeGreaterThanOrEqual(began.rows[0].at.getTime() + 20 * 60_000 - 1);
    expect(secondAt).toBeLessThanOrEqual(ended.rows[0].at.getTime() + 20 * 60_000 + 1);
    expect(secondAt - firstAt).toBeLessThan(11 * 60_000);
    expectSafeReceipt(result.value, test, definition);
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("uses fresh canonical required custom metadata, retains numeric zero and rejects a newly archived field", async () => {
  const test = await setup();
  try {
    const [field] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: "numeric",
        key: "draft_required_numeric",
        name: "Private required draft field",
        isRequired: true,
      })
      .returning();
    assert(field !== undefined);
    const before = await durableSnapshot(test);
    expect(await simulateWorkflowDraft(test.db, test.actor, input(test), signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    expect(await durableSnapshot(test)).toEqual(before);
    const definition = structuredClone(test.definition);
    task(definition).config.customFields = { [field.id]: { kind: "value", value: 0 } };
    const complete = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    assert(complete.ok, JSON.stringify(complete));
    expect(complete.value.outcome).toBe("completed");
    expectSafeReceipt(complete.value, test, definition);
    expect(JSON.stringify(complete.value)).not.toContain(field.id);
    expect(await durableSnapshot(test)).toEqual(before);
    await test.db
      .update(customFieldDefs)
      .set({ archivedAt: new Date() })
      .where(eq(customFieldDefs.id, field.id));
    const archived = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    expect(await durableSnapshot(test)).toEqual(archived);
  } finally {
    await test.close();
  }
});

it("applies current visibility to custom task references without returning the hidden value", async () => {
  const test = await setup();
  try {
    const other = await seedUser(test.db);
    const [hidden] = await test.db
      .insert(persons)
      .values({ name: "HIDDEN_CUSTOM_PERSON", ownerId: other.id, visibilityLevel: "owner" })
      .returning();
    const [field] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: "person",
        key: "draft_private_person",
        name: "Private person field",
      })
      .returning();
    assert(hidden !== undefined && field !== undefined);
    await regularOwner(test, { edit: true, run: true, activity: true });
    const definition = structuredClone(test.definition);
    task(definition).config.customFields = { [field.id]: { kind: "value", value: hidden.id } };
    const before = await durableSnapshot(test);
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, definition),
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expect(result.value.outcome).toBe("failed");
    expect(result.value.steps.at(-1)).toMatchObject({
      nodeId: "task",
      status: "failed",
      errorId: ERROR_IDS.WORKFLOW_DENIED,
    });
    expectSafeReceipt(result.value, test, definition);
    expect(JSON.stringify(result.value)).not.toContain(hidden.id);
    expect(JSON.stringify(result.value)).not.toContain(field.id);
    expect(JSON.stringify(result.value)).not.toContain("HIDDEN_CUSTOM_PERSON");
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("allows a visible archived selected deal for reads while retaining the canonical reached-task archive gate", async () => {
  const test = await setup();
  try {
    await test.db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, test.deal.id));
    const readOnly: WorkflowDefinition = {
      ...structuredClone(test.definition),
      nodes: test.definition.nodes
        .filter((node) => node.type !== "activity.create")
        .map((node) => structuredClone(node)),
      edges: [{ from: "start", to: "read", port: "next" }],
    };
    const before = await durableSnapshot(test);
    const readable = await simulateWorkflowDraft(
      test.db,
      test.actor,
      input(test, readOnly),
      signal,
    );
    assert(readable.ok, JSON.stringify(readable));
    expect(readable.value.outcome).toBe("completed");
    const linkedTask = await simulateWorkflowDraft(test.db, test.actor, input(test), signal);
    assert(linkedTask.ok, JSON.stringify(linkedTask));
    expect(linkedTask.value.outcome).toBe("failed");
    expect(linkedTask.value.steps.at(-1)).toMatchObject({
      nodeId: "task",
      status: "failed",
      errorId: ERROR_IDS.DEAL_ARCHIVED_NO_ACTIVITY,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("refuses a selected deal from an archived pipeline before executing a trigger-only graph", async () => {
  const test = await setup();
  try {
    await test.db
      .update(pipelines)
      .set({ isArchived: true })
      .where(eq(pipelines.id, test.pipeline.id));
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [structuredClone(test.definition.nodes[0]!)],
      edges: [],
    };
    const before = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.DEAL_NOT_FOUND,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rejects a declared notification profile instead of executing it as a draft simulation", async () => {
  const test = await setup();
  try {
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        structuredClone(test.definition.nodes[0]!),
        {
          id: "notification",
          type: "notification",
          version: 1,
          name: "No qualified notification handler",
          config: { title: { kind: "value", value: "PRIVATE_NOTIFICATION_LITERAL" } },
        },
      ],
      edges: [{ from: "start", to: "notification", port: "next" }],
    };
    const before = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_NOT_READY,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rejects a fixed-instant wait at the draft server boundary", async () => {
  const test = await setup();
  try {
    const definition = structuredClone(test.definition);
    definition.nodes.push({
      id: "fixed_wait",
      type: "delay",
      version: 1,
      name: "Fixed wait",
      nameMode: "automatic",
      config: {
        until: {
          kind: "value",
          literalType: "instant",
          value: "2030-03-20T12:00:00.000Z",
        },
      },
    });
    definition.edges = [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "fixed_wait", port: "next" },
      { from: "fixed_wait", to: "task", port: "next" },
    ];
    const before = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_NOT_READY });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rejects over-limit and cyclic authored input before hashing or retaining execution state", async () => {
  const test = await setup();
  try {
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        structuredClone(test.definition.nodes[0]!),
        ...Array.from({ length: 100 }, (_, index) => ({
          id: "task_" + index,
          type: "activity.create" as const,
          version: 1 as const,
          name: "Bounded task",
          config: {
            subject: { kind: "value", value: "Bounded" },
            dealId: { kind: "value", value: test.deal.id },
          },
        })),
      ],
      edges: Array.from({ length: 100 }, (_, index) => ({
        from: index === 0 ? "start" : "task_" + (index - 1),
        to: "task_" + index,
        port: "next",
      })),
    };
    const before = await durableSnapshot(test);
    expect(
      await simulateWorkflowDraft(test.db, test.actor, input(test, definition), signal),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    const cyclic = structuredClone(test.definition);
    Object.assign(task(cyclic).config, { cycle: cyclic });
    expect(await simulateWorkflowDraft(test.db, test.actor, input(test, cyclic), signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    expect(await durableSnapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});
