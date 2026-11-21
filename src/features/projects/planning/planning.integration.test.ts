import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { internalProjectItems } from "../schema";
import { changePlanningGroupItems, readWorkspacePlanning, setItemPlanning } from "./assignments";
import {
  emptyPlanningViewFilters,
  matchesPlanningFilters,
  planningCyclePhase,
  planningViewLayouts,
  type SavePlanningGroup,
  type SavePlanningView,
} from "./contracts";
import {
  listPlanningGroups,
  readPlanningGroup,
  savePlanningGroup,
  setPlanningGroupArchive,
} from "./groups";
import { internalProjectPlanningAssignments } from "./schema";
import {
  listPlanningViews,
  readPlanningView,
  savePlanningView,
  setPlanningViewArchive,
} from "./views";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
});
afterAll(async () => {
  await fixture.close();
});

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`Expected the planning operation to succeed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function staff(name: string, isAdmin = false) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await fixture.db
    .insert(users)
    .values({ id: userId, name, email: `${userId}@example.test`, isAdmin });
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
  const projectId = randomUUID();
  await fixture.db
    .insert(agencyProjects)
    .values({ id: projectId, kind: "internal", title: "Planning project", ownerUserId });
  return projectId;
}

async function workItem(projectId: string) {
  const id = randomUUID();
  const [item] = await fixture.db
    .insert(internalProjectItems)
    .values({ id, projectId, title: "Plan a launch", priority: "high" })
    .returning();
  if (item?.stateId == null) throw new Error("Expected the current project workflow state");
  return { ...item, stateId: item.stateId };
}

function groupInput(
  projectId: string,
  expectedActorId: string,
  kind: SavePlanningGroup["kind"],
): SavePlanningGroup {
  return {
    projectId,
    groupId: randomUUID(),
    expectedActorId,
    csrfToken: null,
    kind,
    description: "",
    revision: null,
    title: "Launch planning",
    startDate: null,
    endDate: null,
    moduleStatus: kind === "modules" ? "planned" : null,
  };
}

test("cycles and modules persist and enforce scheduling, archive rules, project scope, and edit grants", async () => {
  const owner = await staff("Planning owner");
  const viewer = await staff("Read-only member");
  const outsider = await staff("Unrelated administrator", true);
  const projectId = await project(owner.userId);
  const otherId = await project(outsider.userId);
  const item = await workItem(projectId);
  const otherItem = await workItem(otherId);
  await fixture.db
    .insert(agencyProjectMembers)
    .values({ projectId, userId: viewer.userId, projectEdit: false });

  const base = groupInput(projectId, owner.userId, "cycles");
  const future = new Date().getUTCFullYear() + 1;
  expect(
    await savePlanningGroup(fixture.db, owner, { ...base, startDate: "2024-12-01" }, signal()),
  ).toEqual(err("project_invalid"));
  const pastInput = {
    ...base,
    groupId: randomUUID(),
    startDate: "2024-12-01",
    endDate: "2024-12-09",
  };
  const past = value(await savePlanningGroup(fixture.db, owner, pastInput, signal()));
  const cycle = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...base, startDate: `${future}-12-01`, endDate: `${future}-12-09` },
      signal(),
    ),
  );
  expect(planningCyclePhase(base, "2024-12-01")).toBe("draft");
  expect(planningCyclePhase(past, "2024-11-30")).toBe("upcoming");
  expect(planningCyclePhase(past, "2024-12-09")).toBe("current");
  expect(planningCyclePhase(past, "2024-12-10")).toBe("completed");
  expect(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...base, groupId: randomUUID(), startDate: `${future}-12-09`, endDate: `${future}-12-14` },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  const second = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...base, groupId: randomUUID(), startDate: `${future}-12-10`, endDate: `${future}-12-14` },
      signal(),
    ),
  );
  const moduleA = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      groupInput(projectId, owner.userId, "modules"),
      signal(),
    ),
  );
  const moduleB = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...groupInput(projectId, owner.userId, "modules"), title: "Second deliverable" },
      signal(),
    ),
  );
  const foreign = value(
    await savePlanningGroup(
      fixture.db,
      outsider,
      groupInput(otherId, outsider.userId, "modules"),
      signal(),
    ),
  );

  const membership = { projectId, itemId: item.id, expectedActorId: owner.userId, csrfToken: null };
  const change = { ...membership, cycleId: cycle.id, moduleIds: [moduleA.id, moduleB.id] };
  expect(
    await setItemPlanning(fixture.db, owner, { ...change, cycleId: past.id }, signal()),
  ).toEqual(err("project_invalid"));
  expect(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...pastInput, title: "Closed cycle", revision: past.revision },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await setItemPlanning(
      fixture.db,
      viewer,
      { ...change, expectedActorId: viewer.userId },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await setItemPlanning(fixture.db, owner, { ...change, itemId: otherItem.id }, signal()),
  ).toEqual(err("project_unavailable"));
  expect(
    await setItemPlanning(fixture.db, owner, { ...change, moduleIds: [foreign.id] }, signal()),
  ).toEqual(err("project_invalid"));
  const saved = value(await setItemPlanning(fixture.db, owner, change, signal()));
  expect(saved.assignments).toEqual([
    { itemId: item.id, cycleId: cycle.id, moduleIds: [moduleA.id, moduleB.id] },
  ]);
  expect(await readWorkspacePlanning(fixture.db, outsider, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    value(await listPlanningGroups(fixture.db, viewer, projectId, "cycles", signal())).groups.find(
      ({ id }) => id === cycle.id,
    ),
  ).toMatchObject({ id: cycle.id, itemCount: 1 });
  expect(
    value(
      await readPlanningGroup(
        fixture.db,
        viewer,
        { projectId, kind: "modules", groupId: moduleB.id },
        signal(),
      ),
    ).items,
  ).toEqual([{ id: item.id, title: item.title, included: true }]);
  expect(
    await readPlanningGroup(
      fixture.db,
      viewer,
      { projectId, kind: "modules", groupId: foreign.id },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));

  await expect(
    fixture.db
      .insert(internalProjectPlanningAssignments)
      .values({ projectId, kind: "modules", groupId: foreign.id, itemId: item.id }),
  ).rejects.toThrow();
  const archive = value(
    await setPlanningGroupArchive(
      fixture.db,
      owner,
      { ...pastInput, revision: past.revision, archived: true },
      signal(),
    ),
  );
  expect(archive.archived).toBe(true);
  expect(
    await setPlanningGroupArchive(
      fixture.db,
      owner,
      {
        ...membership,
        groupId: moduleA.id,
        kind: "modules",
        revision: moduleA.revision,
        archived: true,
      },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(
    await changePlanningGroupItems(
      fixture.db,
      owner,
      { ...membership, groupId: past.id, kind: "cycles", included: true },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  await changePlanningGroupItems(
    fixture.db,
    owner,
    { ...membership, groupId: second.id, kind: "cycles", included: true },
    signal(),
  );
  const moved = value(await readWorkspacePlanning(fixture.db, viewer, projectId, signal()));
  expect(moved.assignments[0]?.cycleId).toBe(second.id);
  expect(
    value(
      await readPlanningGroup(
        fixture.db,
        viewer,
        { projectId, kind: "cycles", groupId: cycle.id },
        signal(),
      ),
    ).items,
  ).toEqual([]);
});

test("saved layouts and filters are visible only to their intended current project readers", async () => {
  const owner = await staff("View author");
  const editor = await staff("View editor");
  const projectId = await project(owner.userId);
  const item = await workItem(projectId);
  await fixture.db
    .insert(agencyProjectMembers)
    .values({ projectId, userId: editor.userId, projectEdit: true });
  const input: SavePlanningView = {
    projectId,
    viewId: randomUUID(),
    expectedActorId: owner.userId,
    csrfToken: null,
    title: "Launch work",
    description: "",
    revision: null,
    visibility: "private",
    layout: "list",
    filters: {
      ...emptyPlanningViewFilters,
      query: "Launch",
      status: item.stateId,
      priority: "high",
    },
  };
  const saved = value(await savePlanningView(fixture.db, owner, input, signal()));
  expect(await readPlanningView(fixture.db, editor, input, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(value(await listPlanningViews(fixture.db, editor, projectId, signal())).views).toEqual([]);
  expect(matchesPlanningFilters(item, saved.filters)).toBe(true);
  expect(matchesPlanningFilters(item, { ...saved.filters, status: randomUUID() })).toBe(false);
  for (const layout of planningViewLayouts) {
    const target = { ...input, viewId: randomUUID(), layout, visibility: "project" as const };
    const created = value(await savePlanningView(fixture.db, owner, target, signal()));
    const read = value(await readPlanningView(fixture.db, editor, target, signal()));
    expect(read).toMatchObject({
      layout,
      filters: input.filters,
      canEdit: false,
      canArchive: false,
    });
    expect(
      await savePlanningView(
        fixture.db,
        editor,
        {
          ...target,
          expectedActorId: editor.userId,
          revision: created.revision,
          visibility: "private",
        },
        signal(),
      ),
    ).toEqual(err("project_forbidden"));
  }
  expect(
    value(
      await setPlanningViewArchive(
        fixture.db,
        owner,
        { ...input, revision: saved.revision, archived: true },
        signal(),
      ),
    ).archived,
  ).toBe(true);
  expect(value(await readPlanningView(fixture.db, owner, input, signal())).archived).toBe(true);
});
