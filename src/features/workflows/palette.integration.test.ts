import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { assert, expect, it } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { readWorkflowPalette } from "./palette";
import { workflowsRouter } from "./router";
import { retryFlags, setupRetryActor } from "./runRetry.test-helpers";

const {
  activities,
  activityTypes,
  permissionSets,
  users,
  workflowRuns,
  workflows,
  workflowSteps,
  workflowVersions,
} = schema;
const signal = new AbortController().signal;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const types = [
  "trigger.manual",
  "trigger.record",
  "trigger.schedule",
  "trigger.webhook",
  "record.create",
  "record.update",
  "record.delete",
  "record.search",
  "record.upsert",
  "record.pick",
  "email.draft",
  "calendar.create",
  "http.request",
  "human.form",
  "record.read",
  "activity.create",
  "notification",
  "condition",
  "iterator",
  "filter",
  "ifElse",
  "delay",
] as const;
const entrySchema = z.strictObject({
  type: z.enum(types),
  version: z.literal(1),
  support: z.enum(["supported", "unavailable"]),
  supportReason: z
    .enum(["handler-unavailable", "http-grant-required", "webhook-key-required"])
    .nullable(),
  provider: z.enum(["not-required", "not-assessed"]),
  executionReasons: z.array(z.enum(["activity-create-required", "task-type-unavailable"])).max(2),
});
const snapshotSchema = z.strictObject({
  workflowId: z.string().uuid(),
  revision: z.number().int().positive(),
  authoring: z.strictObject({
    allowed: z.boolean(),
    reason: z.enum(["workflow-edit-required", "workflow-archived"]).nullable(),
  }),
  entries: z.array(entrySchema).length(types.length),
});

async function setupPalette() {
  const test = await setupRetryActor();
  try {
    await test.db
      .insert(activityTypes)
      .values({ key: "task", name: "Task", isSystem: true })
      .onConflictDoUpdate({ target: activityTypes.key, set: { archivedAt: null } });
    return test;
  } catch (error) {
    await test.close();
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof setupPalette>>;

async function read(test: Fixture, actor = test.actor) {
  const result = await readWorkflowPalette(test.db, actor, test.workflow.id, signal);
  assert(result.ok, JSON.stringify(result));
  return snapshotSchema.parse(result.value);
}
function taskEntry(snapshot: z.infer<typeof snapshotSchema>) {
  const task = snapshot.entries.find((entry) => entry.type === "activity.create");
  assert(task !== undefined);
  return task;
}
async function stored(test: Fixture) {
  return {
    workflows: await test.db.select().from(workflows).orderBy(workflows.id),
    versions: await test.db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await test.db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await test.db.select().from(workflowSteps).orderBy(workflowSteps.id),
    activities: await test.db.select().from(activities).orderBy(activities.id),
    activityTypes: await test.db.select().from(activityTypes).orderBy(activityTypes.id),
  };
}

it("allows the current owner to author with view and edit without create, publish or run grants", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true, "workflow.edit": true, "activity.create": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    const snapshot = await read(test);
    expect(snapshot).toMatchObject({
      workflowId: test.workflow.id,
      revision: 1,
      authoring: { allowed: true, reason: null },
    });
    expect(snapshot.entries.map((entry) => entry.type)).toEqual(types);
    expect(taskEntry(snapshot).executionReasons).toEqual([]);
  } finally {
    await test.close();
  }
});

it("permits a current administrator on another owner's workflow and rechecks a retained admin snapshot", async () => {
  const test = await setupPalette();
  try {
    const admin = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, admin.id, signal);
    assert(actor !== null);
    expect((await read(test, actor)).authoring).toEqual({ allowed: true, reason: null });
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: test.permissions.id })
      .where(eq(users.id, admin.id));
    expect(actor.type).toBe("admin");
    expect(await readWorkflowPalette(test.db, actor, test.workflow.id, signal)).toEqual(denied);
  } finally {
    await test.close();
  }
});

it("shows view-only metadata with an explicit edit reason and no substitute authoring grant", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    const snapshot = await read(test);
    expect(snapshot.authoring).toEqual({ allowed: false, reason: "workflow-edit-required" });
    expect(taskEntry(snapshot).executionReasons).toEqual(["activity-create-required"]);
  } finally {
    await test.close();
  }
});

it("does not substitute current create, publish or run rights for workflow edit", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.edit": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(test.actor.flags.has("workflow.edit")).toBe(true);
    expect((await read(test)).authoring).toEqual({
      allowed: false,
      reason: "workflow-edit-required",
    });
  } finally {
    await test.close();
  }
});

it("denies an inactive database actor despite the caller's pre-deactivation permissions", async () => {
  const test = await setupPalette();
  try {
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
    expect(test.actor.isActive).toBe(true);
    expect(await readWorkflowPalette(test.db, test.actor, test.workflow.id, signal)).toEqual(
      denied,
    );
  } finally {
    await test.close();
  }
});

it("denies current view revocation without returning catalog state from the stale actor", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.view": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(test.actor.flags.has("workflow.view")).toBe(true);
    expect(await readWorkflowPalette(test.db, test.actor, test.workflow.id, signal)).toEqual(
      denied,
    );
  } finally {
    await test.close();
  }
});

it("returns the same denial for a permitted outsider and a missing workflow", async () => {
  const test = await setupPalette();
  try {
    const other = await seedUser(test.db, { permissionSetId: test.permissions.id });
    const outsider = await hydrateActor(test.db, other.id, signal);
    assert(outsider !== null);
    expect(await readWorkflowPalette(test.db, outsider, test.workflow.id, signal)).toEqual(denied);
    expect(await readWorkflowPalette(test.db, test.actor, crypto.randomUUID(), signal)).toEqual(
      denied,
    );
  } finally {
    await test.close();
  }
});

it("keeps archived authoring read-only for owner and administrator even with edit authority", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(workflows)
      .set({ active: false, archivedAt: new Date() })
      .where(eq(workflows.id, test.workflow.id));
    expect((await read(test)).authoring).toEqual({ allowed: false, reason: "workflow-archived" });
    const admin = await seedUser(test.db, { isAdmin: true });
    const administrator = await hydrateActor(test.db, admin.id, signal);
    assert(administrator !== null);
    expect((await read(test, administrator)).authoring).toEqual({
      allowed: false,
      reason: "workflow-archived",
    });
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect((await read(test)).authoring).toEqual({ allowed: false, reason: "workflow-archived" });
  } finally {
    await test.close();
  }
});

it("warns about current activity.create and restores that warning independently of draft authoring", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "activity.create": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    const warned = await read(test);
    expect(warned.authoring).toEqual({ allowed: true, reason: null });
    expect(taskEntry(warned).executionReasons).toEqual(["activity-create-required"]);
    await test.db
      .update(permissionSets)
      .set({ flags: retryFlags })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(taskEntry(await read(test)).executionReasons).toEqual([]);
  } finally {
    await test.close();
  }
});

it("distinguishes archived or missing local task type from provider readiness and permits draft authoring", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(activityTypes)
      .set({ archivedAt: new Date() })
      .where(eq(activityTypes.key, "task"));
    const archived = await read(test);
    expect(archived.authoring.allowed).toBe(true);
    expect(taskEntry(archived)).toMatchObject({
      provider: "not-required",
      executionReasons: ["task-type-unavailable"],
    });
    await test.db.delete(activityTypes).where(eq(activityTypes.key, "task"));
    expect(taskEntry(await read(test)).executionReasons).toEqual(["task-type-unavailable"]);
    await test.db.insert(activityTypes).values({ key: "task", name: "Restored task" });
    expect(taskEntry(await read(test)).executionReasons).toEqual([]);
  } finally {
    await test.close();
  }
});

it("validates service UUIDs and the actual protected router's strict input boundary", async () => {
  const test = await setupPalette();
  try {
    for (const id of ["not-a-uuid", ` ${test.workflow.id}`, `${test.workflow.id} `]) {
      expect(await readWorkflowPalette(test.db, test.actor, id, signal)).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_INVALID,
      });
    }
    const caller = workflowsRouter.createCaller({
      db: test.db,
      actor: test.actor,
      session: test.who,
    });
    const extra = { id: test.workflow.id, unexpected: "must not be accepted" };
    await expect(caller.palette(extra)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.palette({ id: "not-a-uuid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await caller.palette({ id: test.workflow.id })).toEqual(await read(test));
    const anonymous = workflowsRouter.createCaller({ db: test.db, actor: null, session: null });
    await expect(anonymous.palette({ id: test.workflow.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  } finally {
    await test.close();
  }
});

it("returns the exact provider-safe palette DTO without effects and safely handles read failure and abort", async () => {
  const test = await setupPalette();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "activity.create": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    await test.db
      .update(activityTypes)
      .set({ archivedAt: new Date() })
      .where(eq(activityTypes.key, "task"));
    const before = await stored(test);
    const snapshot = await read(test);
    expect(snapshot.entries.map((entry) => entry.type)).toEqual(types);
    for (const entry of snapshot.entries) {
      const unavailable = entry.type === "trigger.record" || entry.type === "notification";
      const reasons = {
        "trigger.webhook": "webhook-key-required",
        "http.request": "http-grant-required",
      } as const;
      const providerReason =
        entry.type === "trigger.webhook" || entry.type === "http.request"
          ? reasons[entry.type]
          : null;
      expect(entry).toMatchObject({
        support: unavailable || providerReason !== null ? "unavailable" : "supported",
        supportReason: unavailable ? "handler-unavailable" : providerReason,
        provider: unavailable ? "not-assessed" : "not-required",
      });
      expect(entry.executionReasons).toEqual(
        entry.type === "activity.create"
          ? ["activity-create-required", "task-type-unavailable"]
          : [],
      );
    }
    const serialized = JSON.stringify(snapshot);
    for (const hidden of [
      test.actor.id,
      test.user.email,
      test.deal.title,
      "permissionSetId",
      "flags",
      "ownerId",
      "definition",
      "config",
      "outputs",
      "connectionId",
    ])
      expect(serialized).not.toContain(hidden);
    expect(await stored(test)).toEqual(before);
    const closedPool = new Pool({ connectionString: test.url });
    const unavailableDb = drizzle(closedPool, { schema });
    await closedPool.end();
    expect(await readWorkflowPalette(unavailableDb, test.actor, test.workflow.id, signal)).toEqual({
      ok: false,
      error: ERROR_IDS.DB_READ_FAILED,
    });
    const controller = new AbortController();
    const reason = new DOMException("Palette read cancelled", "AbortError");
    controller.abort(reason);
    await expect(
      readWorkflowPalette(test.db, test.actor, test.workflow.id, controller.signal),
    ).rejects.toBe(reason);
    expect(await stored(test)).toEqual(before);
  } finally {
    await test.close();
  }
});
