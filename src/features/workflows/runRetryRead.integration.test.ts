import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityTypes,
  authUsers,
  deals,
  permissionSets,
  sessions,
  users,
  workflowRunFailures,
  workflowSteps,
  workflows,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { initialDefinition } from "./editorModel";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { readRunHistory } from "./queries";
import { cancelWorkflowRun } from "./runControl";
import { readRunDetail } from "./runDetail";
import { retryWorkflowRun } from "./runRetry";
import {
  activeTaskType,
  type RetryFixture,
  retryFlags,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type ReadShape = "normal" | "literalRecord" | "customTask" | "indirectTask" | "pureRead";

function nodeById(definition: WorkflowDefinition, id: string): WorkflowNode {
  const node = definition.nodes.find((item) => item.id === id);
  if (node === undefined) throw new Error("Missing read-retry fixture node");
  return node;
}

function readDefinition(h: RetryFixture, shape: ReadShape, priorTask: boolean) {
  const definition = initialDefinition({
    start: "Start",
    read: "Recover this deal read",
    task: "Recovered read follow-up",
    subject: "Original pinned read follow-up",
  });
  const read = nodeById(definition, "read");
  const task = nodeById(definition, "task");
  if (priorTask) {
    definition.nodes.push({
      ...structuredClone(task),
      id: "earlier_task",
      name: "Already completed effect",
      config: {
        subject: { kind: "value", value: "Keep the earlier completed effect" },
        dealId: { kind: "reference", nodeId: "start", path: ["recordId"] },
      },
    });
    definition.edges = [
      { from: "start", to: "earlier_task", port: "next" },
      { from: "earlier_task", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ];
  }
  if (shape === "literalRecord") read.config.recordId = { kind: "value", value: h.deal.id };
  if (shape === "customTask") task.config.customFields = {};
  if (shape === "indirectTask") {
    definition.nodes.push({ ...structuredClone(read), id: "another_read", name: "Another read" });
    definition.edges = [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "another_read", port: "next" },
      { from: "another_read", to: "task", port: "next" },
    ];
  }
  if (shape === "pureRead") {
    definition.nodes = definition.nodes.filter((node) => node.id !== "task");
    definition.edges = [{ from: "start", to: "read", port: "next" }];
  }
  return definition;
}

async function publishReadWorkflow(h: RetryFixture, definition: WorkflowDefinition) {
  const created = await createWorkflow(
    h.db,
    h.actor,
    { name: "Failed read recovery", definition },
    retrySignal(),
  );
  if (!created.ok) throw new Error(created.error);
  const published = await publishWorkflow(
    h.db,
    h.actor,
    created.value.id,
    created.value.revision,
    retrySignal(),
  );
  if (!published.ok) throw new Error(published.error);
  return { workflow: created.value, version: published.value };
}

async function hideDeal(h: RetryFixture, ownerId: string) {
  await h.db
    .update(deals)
    .set({ ownerId, visibilityLevel: "owner", visibleToUserIds: [] })
    .where(eq(deals.id, h.deal.id));
}

async function repairReadAccess(h: RetryFixture) {
  await hideDeal(h, h.user.id);
}

async function storedSteps(h: RetryFixture, runId: string) {
  return h.db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(workflowSteps.id);
}

async function storedEffects(h: RetryFixture) {
  return h.db.select().from(activities).orderBy(activities.id);
}

async function durableState(h: RetryFixture, runId: string) {
  return {
    run: await storedRetryRun(h, runId),
    failures: await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, runId))
      .orderBy(workflowRunFailures.id),
    steps: await storedSteps(h, runId),
    effects: await storedEffects(h),
  };
}

async function failRead(
  h: RetryFixture,
  priorTask = false,
  shape: ReadShape = "normal",
  mode: "live" | "simulation" = "live",
) {
  const definition = readDefinition(h, shape, priorTask);
  const publication = await publishReadWorkflow(h, definition);
  const admitted = await admitManualRun(
    h.db,
    h.actor,
    {
      workflowId: publication.workflow.id,
      requestKey: crypto.randomUUID(),
      recordId: h.deal.id,
      mode,
    },
    retrySignal(),
  );
  if (!admitted.ok) throw new Error(admitted.error);
  for (let step = 0; step < (priorTask ? 2 : 1); step++)
    expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
      ok: true,
      value: "running",
    });
  const hiddenOwner = await seedUser(h.db, { isAdmin: false });
  await hideDeal(h, hiddenOwner.id);
  expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
    ok: true,
    value: "failed",
  });
  const run = await storedRetryRun(h, admitted.value.id);
  expect(run.nextNodeId).toBe("read");
  expect(run.errorId).toBe(ERROR_IDS.DEAL_NOT_FOUND);
  expect(run.mode).toBe(mode);
  const [failure] = await h.db
    .select()
    .from(workflowRunFailures)
    .where(and(eq(workflowRunFailures.runId, run.id), isNull(workflowRunFailures.retriedAt)));
  if (failure === undefined) throw new Error("Canonical read failure was not recorded");
  expect(failure.nodeId).toBe("read");
  expect(failure.origin).toBe("recorded");
  expect(failure.originalResumeAt).toBeNull();
  const beforeSteps = await storedSteps(h, run.id);
  const beforeEffects = await storedEffects(h);
  expect(beforeEffects).toHaveLength(priorTask ? 1 : 0);
  return { ...publication, definition, run, failure, beforeSteps, beforeEffects, hiddenOwner };
}

type FailedRead = Awaited<ReturnType<typeof failRead>>;

async function expectRefusal(h: RetryFixture, f: FailedRead, error: string) {
  const before = await durableState(h, f.run.id);
  expect(
    await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
  ).toEqual({ ok: false, error });
  expect(await durableState(h, f.run.id)).toEqual(before);
}

async function expectPreservedCompletion(h: RetryFixture, f: FailedRead) {
  const done = await storedRetryRun(h, f.run.id);
  expect(done.status).toBe("succeeded");
  expect(done.versionId).toBe(f.run.versionId);
  expect(done.actorId).toBe(f.run.actorId);
  expect(done.requestKey).toBe(f.run.requestKey);
  expect(done.trigger).toEqual(f.run.trigger);
  for (const [nodeId, output] of Object.entries(f.run.outputs))
    expect(done.outputs[nodeId]).toEqual(output);
  const prefixIds = new Set(f.beforeSteps.map((step) => step.id));
  const steps = await storedSteps(h, f.run.id);
  expect(steps.filter((step) => prefixIds.has(step.id))).toEqual(f.beforeSteps);
  expect(steps.filter((step) => step.nodeId === "read")).toHaveLength(1);
  expect(steps.filter((step) => step.nodeId === "task")).toHaveLength(1);
  const effects = await storedEffects(h);
  expect(effects).toHaveLength(f.beforeEffects.length + 1);
  for (const effect of f.beforeEffects)
    expect(effects.find((row) => row.id === effect.id)).toEqual(effect);
  expect(effects.filter((row) => row.subject === "Original pinned read follow-up")).toHaveLength(1);
}

async function finishRead(h: RetryFixture, f: FailedRead) {
  expect(await advanceWorkflowRun(h.db, f.run.id, retrySignal())).toEqual({
    ok: true,
    value: "running",
  });
  expect(await advanceWorkflowRun(h.db, f.run.id, retrySignal())).toEqual({
    ok: true,
    value: "succeeded",
  });
  await expectPreservedCompletion(h, f);
}

it("offers a repaired failed read in actual history/detail and continues the same execution", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h);
    const denied = await readRunDetail(h.db, h.actor, f.workflow.id, f.run.id, retrySignal());
    if (!denied.ok) throw new Error(denied.error);
    expect(denied.value.recovery?.eligible).toBe(false);
    await expectRefusal(h, f, ERROR_IDS.WORKFLOW_NOT_READY);
    await repairReadAccess(h);
    const detail = await readRunDetail(h.db, h.actor, f.workflow.id, f.run.id, retrySignal());
    const history = await readRunHistory(h.db, h.actor, f.workflow.id, retrySignal());
    if (!detail.ok || !history.ok) throw new Error("Recovery projections failed");
    expect(detail.value.recovery).toMatchObject({
      eligible: true,
      failureId: f.failure.id,
      reason: "available",
    });
    expect(history.value[0]?.recovery).toEqual(detail.value.recovery);
    const command = retryInput(f.run.id, f.failure.id);
    expect(await retryWorkflowRun(h.db, h.who, command, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: false },
    });
    expect(await storedSteps(h, f.run.id)).toEqual(f.beforeSteps);
    await finishRead(h, f);
    const after = await durableState(h, f.run.id);
    expect(after.failures).toHaveLength(1);
    expect(after.failures[0]).toMatchObject({
      id: f.failure.id,
      retryRequestKey: command.requestKey,
      retriedBy: h.user.id,
      retriedAt: expect.any(Date),
    });
    for (const field of ["trigger", "outputs", "stored"])
      expect(detail.value).not.toHaveProperty(field);
    expect(detail.value.steps.every((step) => !Object.hasOwn(step, "output"))).toBe(true);
    expect(detail.value.recovery?.history[0]).not.toHaveProperty("retryRequestKey");
  } finally {
    await h.close();
  }
});

it("retains earlier task effects and the pinned publication under competing workers", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const newer = structuredClone(f.definition);
    nodeById(newer, "task").config.subject = { kind: "value", value: "A newer publication" };
    const saved = await saveWorkflowDraft(
      h.db,
      h.actor,
      {
        id: f.workflow.id,
        revision: f.workflow.revision,
        name: "Newer read draft",
        definition: newer,
      },
      retrySignal(),
    );
    if (!saved.ok) throw new Error(saved.error);
    const published = await publishWorkflow(
      h.db,
      h.actor,
      f.workflow.id,
      saved.value.revision,
      retrySignal(),
    );
    if (!published.ok) throw new Error(published.error);
    expect(published.value.id).not.toBe(f.run.versionId);
    expect(
      (await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal())).ok,
    ).toBe(true);
    const results = await Promise.all([
      advanceWorkflowRun(h.db, f.run.id, retrySignal()),
      advanceWorkflowRun(h.db, f.run.id, retrySignal()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    await expectPreservedCompletion(h, f);
    expect((await storedEffects(h)).some((row) => row.subject === "A newer publication")).toBe(
      false,
    );
    expect(await advanceWorkflowRun(h.db, f.run.id, retrySignal())).toEqual({
      ok: true,
      value: "succeeded",
    });
    await expectPreservedCompletion(h, f);
  } finally {
    await h.close();
  }
});

it("consumes a failed-read generation once for parallel identical retry requests", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const command = retryInput(f.run.id, f.failure.id);
    const results = await Promise.all([
      retryWorkflowRun(h.db, h.who, command, retrySignal()),
      retryWorkflowRun(h.db, h.who, command, retrySignal()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && !result.value.replayed)).toHaveLength(1);
    expect(await storedSteps(h, f.run.id)).toEqual(f.beforeSteps);
    await finishRead(h, f);
  } finally {
    await h.close();
  }
});

it("conflicts when two tabs use different keys for one failed-read generation", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const results = await Promise.all([
      retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
      retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error === ERROR_IDS.WORKFLOW_CONFLICT),
    ).toHaveLength(1);
    await finishRead(h, f);
  } finally {
    await h.close();
  }
});

it("replays a lost acknowledgement without consuming a newer read failure", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const first = retryInput(f.run.id, f.failure.id);
    expect((await retryWorkflowRun(h.db, h.who, first, retrySignal())).ok).toBe(true);
    await hideDeal(h, f.hiddenOwner.id);
    expect(await advanceWorkflowRun(h.db, f.run.id, retrySignal())).toEqual({
      ok: true,
      value: "failed",
    });
    const [next] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(and(eq(workflowRunFailures.runId, f.run.id), isNull(workflowRunFailures.retriedAt)));
    if (next === undefined) throw new Error("Missing second canonical read failure");
    expect(next.id).not.toBe(f.failure.id);
    await repairReadAccess(h);
    const before = await durableState(h, f.run.id);
    expect(await retryWorkflowRun(h.db, h.who, first, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: true },
    });
    expect(await durableState(h, f.run.id)).toEqual(before);
    expect(
      await retryWorkflowRun(h.db, h.who, { ...first, failureId: next.id }, retrySignal()),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    expect(
      await retryWorkflowRun(
        h.db,
        h.who,
        { ...first, requestKey: crypto.randomUUID() },
        retrySignal(),
      ),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    expect(await durableState(h, f.run.id)).toEqual(before);
    expect(
      (await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, next.id), retrySignal())).ok,
    ).toBe(true);
    await finishRead(h, f);
  } finally {
    await h.close();
  }
});

it.each(["revoked", "expired", "inactive", "view", "run", "task"] as const)(
  "refuses the %s requester without consuming its read failure or changing completed effects",
  async (cause) => {
    const h = await setupRetryActor();
    try {
      const f = await failRead(h, true);
      await repairReadAccess(h);
      if (cause === "revoked")
        await h.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, h.session.id));
      if (cause === "expired")
        await h.db
          .update(sessions)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(sessions.id, h.session.id));
      if (cause === "inactive")
        await h.db.update(users).set({ isActive: false }).where(eq(users.id, h.user.id));
      if (cause === "view" || cause === "run" || cause === "task") {
        const flag = cause === "task" ? "activity.create" : `workflow.${cause}`;
        await h.db
          .update(permissionSets)
          .set({ flags: { ...retryFlags, [flag]: false } })
          .where(eq(permissionSets.id, h.permissions.id));
      }
      await expectRefusal(
        h,
        f,
        cause === "task" ? ERROR_IDS.WORKFLOW_NOT_READY : ERROR_IDS.WORKFLOW_DENIED,
      );
    } finally {
      await h.close();
    }
  },
);

it.each(["paused", "archived", "archivedDeal", "inactiveTask"] as const)(
  "does not reactivate a failed read with the %s prerequisite",
  async (cause) => {
    const h = await setupRetryActor();
    try {
      const f = await failRead(h, true);
      await repairReadAccess(h);
      if (cause === "paused")
        await h.db.update(workflows).set({ active: false }).where(eq(workflows.id, f.workflow.id));
      if (cause === "archived")
        await h.db
          .update(workflows)
          .set({ active: false, archivedAt: new Date() })
          .where(eq(workflows.id, f.workflow.id));
      if (cause === "archivedDeal")
        await h.db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, h.deal.id));
      if (cause === "inactiveTask") {
        const type = await activeTaskType(h);
        await h.db
          .update(activityTypes)
          .set({ archivedAt: new Date() })
          .where(eq(activityTypes.id, type.id));
      }
      await expectRefusal(
        h,
        f,
        cause === "archived" ? ERROR_IDS.WORKFLOW_DENIED : ERROR_IDS.WORKFLOW_NOT_READY,
      );
    } finally {
      await h.close();
    }
  },
);

it("does not let a different native administrator take over the failed read", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const other = await seedUser(h.db, { isAdmin: true });
    await h.db
      .insert(authUsers)
      .values({ id: other.id, email: other.email, name: other.name, emailVerified: true });
    const [session] = await h.db
      .insert(sessions)
      .values({
        userId: other.id,
        tokenHash: crypto.randomUUID(),
        authMethod: "password",
        assurance: "mfa",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    if (session === undefined) throw new Error("Missing independent native session");
    const before = await durableState(h, f.run.id);
    expect(
      await retryWorkflowRun(
        h.db,
        { userId: other.id, sessionId: session.id },
        retryInput(f.run.id, f.failure.id),
        retrySignal(),
      ),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_DENIED });
    expect(await durableState(h, f.run.id)).toEqual(before);
  } finally {
    await h.close();
  }
});

it.each(["literalRecord", "customTask", "indirectTask", "pureRead"] as const)(
  "keeps a real %s read failure outside this recovery increment",
  async (shape) => {
    const h = await setupRetryActor();
    try {
      const f = await failRead(h, false, shape);
      await repairReadAccess(h);
      await expectRefusal(h, f, ERROR_IDS.WORKFLOW_NOT_READY);
    } finally {
      await h.close();
    }
  },
);

it("does not turn a failed simulation read into a live task", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, false, "normal", "simulation");
    await repairReadAccess(h);
    await expectRefusal(h, f, ERROR_IDS.WORKFLOW_NOT_READY);
    expect(await storedEffects(h)).toHaveLength(0);
  } finally {
    await h.close();
  }
});

it("retains the real failed-wait deadline and refuses to restart it as read recovery", async () => {
  const h = await setupRetryActor();
  try {
    const definition = readDefinition(h, "normal", false);
    definition.nodes.push({
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait once",
      config: { minutes: { kind: "value", value: 1 } },
    });
    definition.edges = [
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ];
    const publication = await publishReadWorkflow(h, definition);
    const admitted = await admitManualRun(
      h.db,
      h.actor,
      {
        workflowId: publication.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: h.deal.id,
        mode: "live",
      },
      retrySignal(),
    );
    if (!admitted.ok) throw new Error(admitted.error);
    await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
    expect(await advanceWorkflowRun(h.db, admitted.value.id, retrySignal())).toEqual({
      ok: true,
      value: "waiting",
    });
    const waiting = await storedRetryRun(h, admitted.value.id);
    expect(waiting.resumeAt).toBeInstanceOf(Date);
    await h.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.run": false } })
      .where(eq(permissionSets.id, h.permissions.id));
    expect(await advanceWorkflowRun(h.db, waiting.id, retrySignal())).toEqual({
      ok: true,
      value: "failed",
    });
    await h.db
      .update(permissionSets)
      .set({ flags: retryFlags })
      .where(eq(permissionSets.id, h.permissions.id));
    const [failure] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, waiting.id));
    if (failure === undefined) throw new Error("Missing canonical wait failure");
    expect(failure.nodeId).toBe("wait");
    expect(failure.originalResumeAt).toEqual(waiting.resumeAt);
    const before = await durableState(h, waiting.id);
    expect(
      await retryWorkflowRun(h.db, h.who, retryInput(waiting.id, failure.id), retrySignal()),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_NOT_READY });
    expect(await durableState(h, waiting.id)).toEqual(before);
  } finally {
    await h.close();
  }
});

it("lets cancellation win the queued cursor and never restarts it with another retry key", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const command = retryInput(f.run.id, f.failure.id);
    expect((await retryWorkflowRun(h.db, h.who, command, retrySignal())).ok).toBe(true);
    expect(await cancelWorkflowRun(h.db, h.actor, f.run.id, retrySignal())).toEqual({
      ok: true,
      value: "cancelled",
    });
    const before = await durableState(h, f.run.id);
    expect(before.run.cancelledBy).toBe(h.user.id);
    expect(before.run.cancelledAt).toBeInstanceOf(Date);
    expect(await advanceWorkflowRun(h.db, f.run.id, retrySignal())).toEqual({
      ok: true,
      value: "cancelled",
    });
    expect(
      await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    // A replay acknowledges the earlier accepted command, without reactivating cancellation.
    expect(await retryWorkflowRun(h.db, h.who, command, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: true },
    });
    expect(await durableState(h, f.run.id)).toEqual(before);
    expect(await storedSteps(h, f.run.id)).toEqual(f.beforeSteps);
    expect(await storedEffects(h)).toEqual(f.beforeEffects);
  } finally {
    await h.close();
  }
});

it("rejects serialized actor, record and replacement-graph fields before touching read recovery", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const before = await durableState(h, f.run.id);
    expect(
      await retryWorkflowRun(
        h.db,
        h.who,
        {
          ...retryInput(f.run.id, f.failure.id),
          actorId: h.user.id,
          recordId: h.deal.id,
          definition: f.definition,
        },
        retrySignal(),
      ),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(await durableState(h, f.run.id)).toEqual(before);
  } finally {
    await h.close();
  }
});

it("refuses an unrelated failure identity without changing the actual read generation", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failRead(h, true);
    await repairReadAccess(h);
    const before = await durableState(h, f.run.id);
    expect(
      await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, crypto.randomUUID()), retrySignal()),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    expect(await durableState(h, f.run.id)).toEqual(before);
  } finally {
    await h.close();
  }
});
