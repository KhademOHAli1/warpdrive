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
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { restoreWorkflowDraft } from "./lifecycle";
import { createWorkflow } from "./persistence";
import { getWorkflow, pauseWorkflow, readWorkflowVersion, readWorkflowVersions } from "./queries";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };
const definition = (name: string): WorkflowDefinition => ({
  schemaVersion: 1,
  nodes: [{ id: "start", type: "trigger.manual", version: 1, name, config: {} }],
  edges: [],
});

async function setupReads() {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: `Lifecycle reads ${crypto.randomUUID()}`,
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
    const owner = await seedUser(test.db, { permissionSetId: permissions.id });
    const other = await seedUser(test.db, { permissionSetId: permissions.id });
    const administrator = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, owner.id, signal);
    const outsider = await hydrateActor(test.db, other.id, signal);
    const admin = await hydrateActor(test.db, administrator.id, signal);
    if (actor === null || outsider === null || admin === null)
      throw new Error("actor fixture missing");
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "Current draft", definition: definition("Unsaved publication") },
      signal,
    );
    if (!created.ok) throw new Error(created.error);
    const versions = await test.db
      .insert(workflowVersions)
      .values([
        {
          workflowId: created.value.id,
          number: 1,
          name: "Original publication",
          definition: definition("Original trigger"),
          publishedBy: actor.id,
          createdAt: new Date("2026-11-01T00:00:00.000Z"),
        },
        {
          workflowId: created.value.id,
          number: 2,
          name: "Second publication",
          definition: definition("Second trigger"),
          publishedBy: actor.id,
          createdAt: new Date("2026-11-02T00:00:00.000Z"),
        },
      ])
      .returning();
    const first = versions.find((version) => version.number === 1);
    const second = versions.find((version) => version.number === 2);
    if (first === undefined || second === undefined) throw new Error("version fixture missing");
    await test.db
      .update(workflows)
      .set({ publishedNumber: 2 })
      .where(eq(workflows.id, created.value.id));
    const recordId = crypto.randomUUID();
    const [run] = await test.db
      .insert(workflowRuns)
      .values({
        workflowId: created.value.id,
        versionId: first.id,
        actorId: actor.id,
        requestKey: crypto.randomUUID(),
        mode: "simulation",
        status: "succeeded",
        trigger: { recordId },
        outputs: { start: { output: "stored-output-sentinel", grants: "stored-grant-sentinel" } },
      })
      .returning();
    if (run === undefined) throw new Error("run fixture missing");
    await test.db.insert(workflowSteps).values({
      runId: run.id,
      nodeId: "start",
      simulated: true,
      output: { trigger: "stored-trigger-sentinel", grants: "stored-step-grant-sentinel" },
    });
    return {
      ...test,
      actor,
      outsider,
      admin,
      permissions,
      workflow: created.value,
      first,
      second,
      recordId,
    };
  } catch (error) {
    await test.close();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof setupReads>>;

function metadata(version: typeof workflowVersions.$inferSelect) {
  return {
    id: version.id,
    number: version.number,
    name: version.name,
    createdAt: version.createdAt,
  };
}

async function snapshot(db: Db) {
  return {
    workflows: await db.select().from(workflows).orderBy(workflows.id),
    versions: await db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await db.select().from(workflowSteps).orderBy(workflowSteps.id),
  };
}

async function archive(test: Fixture) {
  await test.db
    .update(workflows)
    .set({ active: false, archivedAt: new Date("2026-11-03T00:00:00.000Z") })
    .where(eq(workflows.id, test.workflow.id));
}

async function expectDenied(test: Fixture, actor: PermSetUser, id = test.workflow.id) {
  const results = [
    await getWorkflow(test.db, actor, id, signal),
    await readWorkflowVersions(test.db, actor, id, signal),
    await readWorkflowVersion(test.db, actor, { id, versionNumber: 1 }, signal),
  ];
  for (const result of results) expect(result).toEqual(denied);
}

it.each([false, true])(
  "reads only safe pinned version fields when archived=%s",
  async (archived) => {
    const test = await setupReads();
    try {
      if (archived) await archive(test);
      const before = await snapshot(test.db);
      const list = await readWorkflowVersions(test.db, test.actor, test.workflow.id, signal);
      expect(list).toEqual({ ok: true, value: [metadata(test.second), metadata(test.first)] });
      for (const version of [test.first, test.second]) {
        const detail = await readWorkflowVersion(
          test.db,
          test.actor,
          { id: test.workflow.id, versionNumber: version.number },
          signal,
        );
        expect(detail).toEqual({
          ok: true,
          value: { ...metadata(version), definition: version.definition },
        });
        const serialized = JSON.stringify({ list, detail });
        for (const hidden of [
          test.recordId,
          "stored-output-sentinel",
          "stored-grant-sentinel",
          "stored-trigger-sentinel",
          "stored-step-grant-sentinel",
          "publishedBy",
          "ownerId",
        ])
          expect(serialized).not.toContain(hidden);
      }
      expect(await snapshot(test.db)).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

it("returns at most 100 versions in descending version order", async () => {
  const test = await setupReads();
  try {
    await test.db.insert(workflowVersions).values(
      Array.from({ length: 101 }, (_, index) => ({
        workflowId: test.workflow.id,
        number: index + 3,
        name: `Publication ${index + 3}`,
        definition: definition("Bounded trigger"),
        publishedBy: test.actor.id,
        createdAt: new Date("2026-10-31T00:00:00.000Z"),
      })),
    );
    const before = await snapshot(test.db);
    const result = await readWorkflowVersions(test.db, test.actor, test.workflow.id, signal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(100);
    expect(result.value.map((version) => version.number)).toEqual(
      Array.from({ length: 100 }, (_, index) => 103 - index),
    );
    for (const version of result.value)
      expect(Object.keys(version).sort()).toEqual(["createdAt", "id", "name", "number"]);
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("returns an empty version list only for an authorized unpublished workflow", async () => {
  const test = await setupReads();
  try {
    const created = await createWorkflow(
      test.db,
      test.actor,
      { name: "Never published", definition: definition("Draft") },
      signal,
    );
    if (!created.ok) throw new Error(created.error);
    expect(await readWorkflowVersions(test.db, test.actor, created.value.id, signal)).toEqual({
      ok: true,
      value: [],
    });
    expect(
      await readWorkflowVersion(
        test.db,
        test.actor,
        { id: created.value.id, versionNumber: 1 },
        signal,
      ),
    ).toEqual(denied);
    await expectDenied(test, test.outsider, created.value.id);
  } finally {
    await test.close();
  }
});

it.each([false, true])("withholds another owner's versions when archived=%s", async (archived) => {
  const test = await setupReads();
  try {
    if (archived) await archive(test);
    const before = await snapshot(test.db);
    await expectDenied(test, test.outsider);
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("denies missing workflows and versions from a different workflow", async () => {
  const test = await setupReads();
  try {
    const other = await createWorkflow(
      test.db,
      test.outsider,
      { name: "Hidden source", definition: definition("Hidden") },
      signal,
    );
    if (!other.ok) throw new Error(other.error);
    await test.db.insert(workflowVersions).values({
      workflowId: other.value.id,
      number: 3,
      name: "Other workflow version",
      definition: definition("Hidden pinned trigger"),
      publishedBy: test.outsider.id,
    });
    const before = await snapshot(test.db);
    await expectDenied(test, test.actor, crypto.randomUUID());
    await expectDenied(test, test.actor, other.value.id);
    for (const versionNumber of [3, 999]) {
      expect(
        await readWorkflowVersion(
          test.db,
          test.actor,
          { id: test.workflow.id, versionNumber },
          signal,
        ),
      ).toEqual(denied);
    }
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("keeps archived administrative unarchive, duplicate, and cancel authority", async () => {
  const test = await setupReads();
  try {
    await archive(test);
    const before = await snapshot(test.db);
    const result = await getWorkflow(test.db, test.admin, test.workflow.id, signal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.capabilities).toEqual({
      edit: false,
      publish: false,
      run: false,
      unarchive: true,
      duplicate: true,
      restore: false,
      cancel: true,
    });
    expect(await readWorkflowVersions(test.db, test.admin, test.workflow.id, signal)).toEqual({
      ok: true,
      value: [metadata(test.second), metadata(test.first)],
    });
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it.each([false, true])(
  "derives archived owner rights from current edit=%s without create",
  async (edit) => {
    const test = await setupReads();
    try {
      await archive(test);
      await test.db
        .update(permissionSets)
        .set({ flags: { "workflow.view": true, "workflow.edit": edit } })
        .where(eq(permissionSets.id, test.permissions.id));
      expect(test.actor.flags.has("workflow.create")).toBe(true);
      const before = await snapshot(test.db);
      const result = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.capabilities).toEqual({
        edit: false,
        publish: false,
        run: false,
        unarchive: edit,
        duplicate: false,
        restore: false,
        cancel: false,
      });
      expect(await readWorkflowVersions(test.db, test.actor, test.workflow.id, signal)).toEqual({
        ok: true,
        value: [metadata(test.second), metadata(test.first)],
      });
      expect(await snapshot(test.db)).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

it.each([
  [false, "inactive"],
  [true, "inactive"],
  [false, "view revoked"],
  [true, "view revoked"],
] as const)(
  "denies every read when archived=%s and current authority is %s",
  async (archived, reason) => {
    const test = await setupReads();
    try {
      if (archived) await archive(test);
      expect(test.actor.isActive).toBe(true);
      expect(test.actor.flags.has("workflow.view")).toBe(true);
      if (reason === "inactive") {
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
        expect(await hydrateActor(test.db, test.actor.id, signal)).toBeNull();
      } else {
        await test.db
          .update(permissionSets)
          .set({
            flags: { "workflow.create": true, "workflow.edit": true, "workflow.publish": true },
          })
          .where(eq(permissionSets.id, test.permissions.id));
        const current = await hydrateActor(test.db, test.actor.id, signal);
        expect(current?.flags.has("workflow.view")).toBe(false);
      }
      const before = await snapshot(test.db);
      await expectDenied(test, test.actor);
      expect(await snapshot(test.db)).toEqual(before);
    } finally {
      await test.close();
    }
  },
);

it("does not retain an administrator bypass after current administrator revocation", async () => {
  const test = await setupReads();
  try {
    await archive(test);
    expect(test.admin.type).toBe("admin");
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: null })
      .where(eq(users.id, test.admin.id));
    expect((await hydrateActor(test.db, test.admin.id, signal))?.type).toBe("regular");
    const before = await snapshot(test.db);
    await expectDenied(test, test.admin);
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("rejects malformed UUIDs, invalid version numbers, and extra input keys", async () => {
  const test = await setupReads();
  try {
    const before = await snapshot(test.db);
    for (const id of ["not-a-uuid", ` ${test.workflow.id}`, `${test.workflow.id} `]) {
      expect(await readWorkflowVersions(test.db, test.actor, id, signal)).toEqual(invalid);
      expect(
        await readWorkflowVersion(test.db, test.actor, { id, versionNumber: 1 }, signal),
      ).toEqual(invalid);
    }
    for (const versionNumber of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      null,
      undefined,
      {},
      [],
    ]) {
      expect(
        await readWorkflowVersion(
          test.db,
          test.actor,
          { id: test.workflow.id, versionNumber },
          signal,
        ),
      ).toEqual(invalid);
    }
    const input = { id: test.workflow.id, versionNumber: 1, unexpected: true };
    expect(await readWorkflowVersion(test.db, test.actor, input, signal)).toEqual(invalid);
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("preserves pause's view requirement when current view is revoked but edit remains", async () => {
  const test = await setupReads();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.edit": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(test.actor.flags.has("workflow.view")).toBe(true);
    const before = await snapshot(test.db);
    for (const revision of [1, 99])
      expect(await pauseWorkflow(test.db, test.actor, test.workflow.id, revision, signal)).toEqual(
        denied,
      );
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("denies unavailable large safe version numbers without a PostgreSQL integer cast", async () => {
  const test = await setupReads();
  try {
    const before = await snapshot(test.db);
    for (const versionNumber of [2_147_483_648, Number.MAX_SAFE_INTEGER]) {
      const input = { id: test.workflow.id, versionNumber };
      expect(await readWorkflowVersion(test.db, test.actor, input, signal)).toEqual(denied);
      expect(
        await restoreWorkflowDraft(test.db, test.actor, { ...input, revision: 1 }, signal),
      ).toEqual(denied);
    }
    expect(await snapshot(test.db)).toEqual(before);
  } finally {
    await test.close();
  }
});
