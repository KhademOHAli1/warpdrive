import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  permissionSets,
  users,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { getWorkflow, pauseWorkflow, readRunHistory } from "./queries";
import { readRunDetail } from "./runDetail";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }],
  edges: [],
};

async function setupAuthority() {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: `Lifecycle authority ${crypto.randomUUID()}`,
        flags: {
          "workflow.view": true,
          "workflow.create": true,
          "workflow.edit": true,
          "workflow.publish": true,
          "workflow.run": true,
          "workflow.cancel": true,
        },
      })
      .returning();
    if (permissions === undefined) throw new Error("permission fixture missing");
    const user = await seedUser(test.db, { permissionSetId: permissions.id });
    const actor = await hydrateActor(test.db, user.id, signal);
    if (actor === null || actor.type !== "regular") throw new Error("owner fixture missing");
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "Authority fixture", definition },
      signal,
    );
    if (!created.ok) throw new Error(created.error);
    const published = await publishWorkflow(test.db, actor, created.value.id, 1, signal);
    if (!published.ok) throw new Error(published.error);
    return { ...test, actor, user, workflow: created.value, version: published.value };
  } catch (error) {
    await test.close();
    throw error;
  }
}

async function snapshot(db: Db) {
  return {
    workflows: await db.select().from(workflows).orderBy(workflows.id),
    versions: await db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await db.select().from(workflowSteps).orderBy(workflowSteps.id),
  };
}

type Fixture = Awaited<ReturnType<typeof setupAuthority>>;
type Command = "create" | "save" | "publish" | "pause";

function command(test: Fixture, kind: Command, revision: number) {
  switch (kind) {
    case "create":
      return createWorkflow(
        test.db,
        test.actor,
        { name: "Inactive actor must not create", definition },
        signal,
      );
    case "save":
      return saveWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision, name: "Must not overwrite", definition },
        signal,
      );
    case "publish":
      return publishWorkflow(test.db, test.actor, test.workflow.id, revision, signal);
    case "pause":
      return pauseWorkflow(test.db, test.actor, test.workflow.id, revision, signal);
  }
}

async function deactivate(test: Fixture) {
  await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
  expect(test.actor.isActive).toBe(true);
  expect(await hydrateActor(test.db, test.actor.id, signal)).toBeNull();
}

it.each(["create", "save", "publish", "pause"] as const)(
  "denies %s from a pre-deactivation actor without workflow writes",
  async (kind) => {
    const test = await setupAuthority();
    try {
      await deactivate(test);
      const before = await snapshot(test.db);
      const result = await command(test, kind, 1);
      const after = await snapshot(test.db);
      expect(result).toEqual(denied);
      expect(after).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

it.each(["save", "publish", "pause"] as const)(
  "denies stale actor authority before reporting a %s revision conflict",
  async (kind) => {
    const test = await setupAuthority();
    try {
      await test.db
        .update(workflows)
        .set({ revision: 2 })
        .where(eq(workflows.id, test.workflow.id));
      await deactivate(test);
      const before = await snapshot(test.db);
      const result = await command(test, kind, 1);
      const after = await snapshot(test.db);
      expect(result).toEqual(denied);
      expect(after).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

async function seedHistory(test: Fixture) {
  const recordId = crypto.randomUUID();
  const [run] = await test.db
    .insert(workflowRuns)
    .values({
      workflowId: test.workflow.id,
      versionId: test.version.id,
      actorId: test.actor.id,
      requestKey: crypto.randomUUID(),
      mode: "simulation",
      status: "succeeded",
      trigger: { recordId },
      outputs: { start: { privateValue: "run-output-sentinel" } },
    })
    .returning();
  if (run === undefined) throw new Error("history fixture missing");
  await test.db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: "start",
    simulated: true,
    output: { privateValue: "step-output-sentinel" },
  });
  return { run, recordId };
}

it("denies safe detail and history reads to a pre-deactivation actor", async () => {
  const test = await setupAuthority();
  try {
    const { run } = await seedHistory(test);
    await deactivate(test);
    const before = await snapshot(test.db);
    expect(await getWorkflow(test.db, test.actor, test.workflow.id, signal)).toEqual(denied);
    expect(await readRunHistory(test.db, test.actor, test.workflow.id, signal)).toEqual(denied);
    expect(await readRunDetail(test.db, test.actor, test.workflow.id, run.id, signal)).toEqual(
      denied,
    );
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("allows archived owner configuration and safe history without stored payloads", async () => {
  const test = await setupAuthority();
  try {
    const { run, recordId } = await seedHistory(test);
    const archivedAt = new Date("2026-11-03T00:00:00.000Z");
    await test.db
      .update(workflows)
      .set({ active: false, archivedAt, revision: 2 })
      .where(eq(workflows.id, test.workflow.id));
    const before = await snapshot(test.db);
    const workflow = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
    const history = await readRunHistory(test.db, test.actor, test.workflow.id, signal);
    const detail = await readRunDetail(test.db, test.actor, test.workflow.id, run.id, signal);
    expect(workflow.ok).toBe(true);
    expect(history.ok).toBe(true);
    expect(detail.ok).toBe(true);
    if (!workflow.ok || !history.ok || !detail.ok) throw new Error("archived owner read denied");
    expect(workflow.value).toMatchObject({
      id: test.workflow.id,
      draft: definition,
      active: false,
      archivedAt,
      capabilities: { edit: false, publish: false, run: false },
    });
    expect(history.value).toHaveLength(1);
    expect(history.value[0]).toMatchObject({
      id: run.id,
      status: "succeeded",
      versionId: test.version.id,
    });
    expect(detail.value.definition).toEqual(definition);
    expect(detail.value.number).toBe(1);
    expect(detail.value.steps).toHaveLength(1);
    expect(detail.value.steps[0]).toMatchObject({ nodeId: "start", simulated: true });
    expect(detail.value.steps[0]).not.toHaveProperty("output");
    for (const result of [workflow.value, history.value, detail.value]) {
      expect(result).not.toHaveProperty("trigger");
      expect(result).not.toHaveProperty("outputs");
      expect(result).not.toHaveProperty("stored");
      const json = JSON.stringify(result);
      expect(json).not.toContain(recordId);
      expect(json).not.toContain("run-output-sentinel");
      expect(json).not.toContain("step-output-sentinel");
    }
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it.each(["outsider", "inactive"] as const)(
  "withholds archived configuration and history from an %s actor",
  async (kind) => {
    const test = await setupAuthority();
    try {
      const { run } = await seedHistory(test);
      await test.db
        .update(workflows)
        .set({ active: false, archivedAt: new Date() })
        .where(eq(workflows.id, test.workflow.id));
      const other = await seedUser(test.db, { permissionSetId: test.user.permissionSetId });
      const outsider = await hydrateActor(test.db, other.id, signal);
      if (outsider === null) throw new Error("outsider fixture missing");
      if (kind === "inactive") await deactivate(test);
      const actor = kind === "outsider" ? outsider : test.actor;
      const before = await snapshot(test.db);
      expect(await getWorkflow(test.db, actor, test.workflow.id, signal)).toEqual(denied);
      expect(await readRunHistory(test.db, actor, test.workflow.id, signal)).toEqual(denied);
      expect(await readRunDetail(test.db, actor, test.workflow.id, run.id, signal)).toEqual(denied);
      expect(await snapshot(test.db)).toEqual(before);
    } finally {
      await test.close();
    }
  },
);
