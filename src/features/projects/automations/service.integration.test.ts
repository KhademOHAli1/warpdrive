import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  agencyProjectMembers,
  agencyProjectSettings,
  agencyProjects,
  sessions,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import {
  internalProjectPlanningAssignments,
  internalProjectPlanningGroups,
} from "../planning/schema";
import { internalProjectItems, internalProjectStates } from "../schema";
import { readInternalProject, updateInternalProjectItem } from "../service";
import { internalProjectAutomationEvents } from "./schema";
import {
  archiveProjectItem,
  readArchivedProjectItems,
  readProjectAutomation,
  saveProjectAutomation,
} from "./service";
import { runProjectAutomations } from "./worker";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(15_000);
const now = new Date();
const old = new Date(now.valueOf() - 40 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.db
    .insert(agencyProjectSettings)
    .values({ id: true, enabled: true })
    .onConflictDoUpdate({
      target: agencyProjectSettings.id,
      set: { enabled: true },
    });
});

afterAll(async () => fixture.close());

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected a successful Projects operation");
  return result.value;
}

async function actor() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await fixture.db
    .insert(users)
    .values({ id: userId, name: "Automation fixture", email: `${userId}@example.test` });
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

async function project(ownerUserId: string) {
  const id = randomUUID();
  await fixture.db
    .insert(agencyProjects)
    .values({ id, ownerUserId, kind: "internal", title: "Project automation fixture" });
  return id;
}

async function group(projectId: string, kind: "cycles" | "modules", date: string | null) {
  const id = randomUUID();
  await fixture.db.insert(internalProjectPlanningGroups).values({
    id,
    projectId,
    kind,
    title: "Planning constraint",
    description: "",
    startDate: kind === "cycles" ? date : null,
    endDate: date,
    moduleStatus: kind === "modules" ? "planned" : null,
  });
  return id;
}

async function item(projectId: string, title: string, status: "todo" | "done", updatedAt = old) {
  const id = randomUUID();
  await fixture.db.insert(internalProjectItems).values({ id, title, projectId, status, updatedAt });
  return id;
}

test("automates only stale eligible internal work, enforces permissions and retains a restorable archive", async () => {
  const owner = await actor();
  const viewer = await actor();
  const editor = await actor();
  const outsider = await actor();
  const projectId = await project(owner.userId);
  const other = await project(outsider.userId);
  await fixture.db.insert(agencyProjectMembers).values([
    { projectId, userId: viewer.userId },
    { projectId, userId: editor.userId, projectEdit: true },
  ]);
  const closeStateId = randomUUID();
  const unrelatedStateId = randomUUID();
  await fixture.db.insert(internalProjectStates).values([
    {
      projectId,
      id: closeStateId,
      name: "Cancelled",
      category: "cancelled",
      color: "#ae524f",
      position: 0,
    },
    {
      projectId: other,
      id: unrelatedStateId,
      name: "Cancelled",
      category: "cancelled",
      color: "#ae524f",
      position: 0,
    },
  ]);
  const command = {
    projectId,
    expectedActorId: owner.userId,
    csrfToken: null,
    revision: 0,
    archiveAfterMonths: 1,
    closeAfterMonths: 1,
    closeStateId,
  };

  expect(await saveProjectAutomation(fixture.db, editor, command, signal())).toMatchObject({
    ok: false,
    error: "project_forbidden",
  });
  expect(
    await saveProjectAutomation(
      fixture.db,
      owner,
      { ...command, closeStateId: unrelatedStateId },
      signal(),
    ),
  ).toMatchObject({ ok: false, error: "project_invalid" });
  expect(value(await saveProjectAutomation(fixture.db, owner, command, signal())).revision).toBe(1);
  expect(await saveProjectAutomation(fixture.db, owner, command, signal())).toMatchObject({
    ok: false,
    error: "project_conflict",
  });

  const archiveId = await item(projectId, "Stale completed item", "done");
  const closeId = await item(projectId, "Stale remaining work", "todo");
  const recentId = await item(projectId, "Touched completed item", "done", now);
  const oldCycle = await group(projectId, "cycles", old.toISOString().slice(0, 10));
  const todayCycle = await group(projectId, "cycles", now.toISOString().slice(0, 10));
  const noDateModule = await group(projectId, "modules", null);
  const currentCycleId = await item(projectId, "Planned next", "done");
  const moduleId = await item(projectId, "Incomplete deliverable", "todo");
  const independent = await item(other, "Other project", "done");
  await fixture.db.insert(internalProjectPlanningAssignments).values([
    { projectId, itemId: archiveId, groupId: oldCycle, kind: "cycles" },
    { projectId, itemId: currentCycleId, groupId: todayCycle, kind: "cycles" },
    { projectId, itemId: moduleId, groupId: noDateModule, kind: "modules" },
  ]);
  expect(await runProjectAutomations(fixture.db, now, signal())).toEqual({
    archived: 1,
    closed: 1,
  });
  const workspace = value(await readInternalProject(fixture.db, owner, projectId, signal()));
  expect(workspace.items.find(({ id }) => id === closeId)).toMatchObject({
    stateId: closeStateId,
    status: "done",
    revision: 1,
  });
  expect(workspace.items.map(({ id }) => id)).toEqual(
    expect.arrayContaining([recentId, currentCycleId, moduleId]),
  );
  expect(workspace.items.map(({ id }) => id)).not.toContain(archiveId);
  const [savedOther] = await fixture.db
    .select({ archivedAt: internalProjectItems.archivedAt })
    .from(internalProjectItems)
    .where(eq(internalProjectItems.id, independent));
  expect(savedOther?.archivedAt).toBeNull();
  expect(await readArchivedProjectItems(fixture.db, outsider, projectId, signal())).toMatchObject({
    ok: false,
    error: "project_unavailable",
  });
  const [archived] = value(await readArchivedProjectItems(fixture.db, viewer, projectId, signal()));
  expect(archived).toMatchObject({ id: archiveId, revision: 1, archivedAt: now.toISOString() });
  expect(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { projectId, itemId: archiveId, revision: 1, title: "Invalid edit" },
      signal(),
    ),
  ).toMatchObject({ ok: false, error: "project_unavailable" });
  const restore = {
    projectId,
    itemId: archiveId,
    revision: 1,
    expectedActorId: owner.userId,
    csrfToken: null,
    archived: false,
  };
  expect(await archiveProjectItem(fixture.db, viewer, restore, signal())).toMatchObject({
    ok: false,
    error: "project_forbidden",
  });
  expect(value(await archiveProjectItem(fixture.db, owner, restore, signal()))).toBe(true);
  expect(value(await readArchivedProjectItems(fixture.db, owner, projectId, signal()))).toEqual([]);
  expect(value(await readProjectAutomation(fixture.db, owner, projectId, signal())).recent).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ itemId: archiveId, kind: "archived" }),
      expect.objectContaining({ itemId: closeId, kind: "closed" }),
    ]),
  );
  const logs = await fixture.db
    .select()
    .from(internalProjectAutomationEvents)
    .where(
      and(
        eq(internalProjectAutomationEvents.projectId, projectId),
        eq(internalProjectAutomationEvents.itemId, closeId),
      ),
    );
  expect(logs).toHaveLength(1);
});
