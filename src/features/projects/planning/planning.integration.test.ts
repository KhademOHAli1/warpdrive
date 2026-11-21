import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { internalProjectItems, internalProjectStates } from "../schema";
import { changePlanningGroupItems, readWorkspacePlanning, setItemPlanning } from "./assignments";
import {
  defaultPlanningViewDisplay,
  emptyPlanningViewFilters,
  matchesPlanningFilters,
  matchesPlanningItemScope,
  planningCyclePhase,
  planningViewDisplayInput,
  planningViewFiltersInput,
  planningViewLayouts,
  type SavePlanningGroup,
  type SavePlanningView,
  sortPlanningViewItems,
} from "./contracts";
import {
  listPlanningGroups,
  readPlanningGroup,
  savePlanningGroup,
  setPlanningGroupArchive,
} from "./groups";
import { rolloverPlanningCycle } from "./rollover";
import { internalProjectPlanningAssignments, internalProjectSavedViewFavorites } from "./schema";
import {
  deletePlanningView,
  listPlanningViews,
  readPlanningView,
  savePlanningView,
  setPlanningViewArchive,
  setPlanningViewFavorite,
  setPlanningViewLock,
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

async function workItem(
  projectId: string,
  content: Partial<
    Pick<
      typeof internalProjectItems.$inferInsert,
      "title" | "status" | "stateId" | "archivedAt" | "startDate" | "dueDate" | "createdBy"
    >
  > = {},
) {
  const id = randomUUID();
  const [item] = await fixture.db
    .insert(internalProjectItems)
    .values({ id, projectId, title: "Plan a launch", priority: "high", ...content })
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
      display: defaultPlanningViewDisplay,
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

test("cycle rollover moves open work only and persists the prior progress once", async () => {
  const owner = await staff("Cycle coordinator");
  const viewer = await staff("Cycle viewer");
  const projectId = await project(owner.userId);
  const otherProjectId = await project(owner.userId);
  await fixture.db
    .insert(agencyProjectMembers)
    .values({ projectId, userId: viewer.userId, projectEdit: false });
  const source = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      {
        ...groupInput(projectId, owner.userId, "cycles"),
        startDate: "2024-03-01",
        endDate: "2024-03-03",
      },
      signal(),
    ),
  );
  const target = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      { ...groupInput(projectId, owner.userId, "cycles"), title: "Next iteration" },
      signal(),
    ),
  );
  const outsider = value(
    await savePlanningGroup(
      fixture.db,
      owner,
      groupInput(otherProjectId, owner.userId, "cycles"),
      signal(),
    ),
  );
  const cancelledStateId = randomUUID();
  await fixture.db.insert(internalProjectStates).values({
    projectId,
    id: cancelledStateId,
    name: "Cancelled",
    category: "cancelled",
    position: 0,
    color: "#555555",
  });
  const unfinished = await workItem(projectId, { status: "in-progress" });
  const archived = await workItem(projectId, { archivedAt: new Date() });
  const finished = await workItem(projectId, { status: "done" });
  const cancelled = await workItem(projectId, { status: "done", stateId: cancelledStateId });
  await fixture.db.insert(internalProjectPlanningAssignments).values(
    [unfinished, archived, finished, cancelled].map(({ id }) => ({
      projectId,
      groupId: source.id,
      kind: "cycles" as const,
      itemId: id,
    })),
  );

  const input = {
    projectId,
    expectedActorId: owner.userId,
    csrfToken: null,
    sourceCycleId: source.id,
    targetCycleId: target.id,
  };
  expect(
    await rolloverPlanningCycle(
      fixture.db,
      viewer,
      { ...input, expectedActorId: viewer.userId },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await rolloverPlanningCycle(
      fixture.db,
      owner,
      { ...input, targetCycleId: outsider.id },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  expect(
    await rolloverPlanningCycle(
      fixture.db,
      owner,
      { ...input, targetCycleId: source.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(value(await rolloverPlanningCycle(fixture.db, owner, input, signal())).movedCount).toBe(1);

  const current = value(await readWorkspacePlanning(fixture.db, owner, projectId, signal()));
  expect(current.assignments.find(({ itemId }) => itemId === unfinished.id)?.cycleId).toBe(
    target.id,
  );
  expect(
    current.assignments.filter(({ cycleId }) => cycleId === source.id).map(({ itemId }) => itemId),
  ).toEqual(expect.arrayContaining([finished.id, cancelled.id]));
  expect(current.assignments.some(({ itemId }) => itemId === archived.id)).toBe(false);
  const sourceKey = { projectId, kind: "cycles" as const, groupId: source.id };
  const snapshot = value(await readPlanningGroup(fixture.db, owner, sourceKey, signal())).group
    .rolloverSnapshot;
  expect(snapshot).toMatchObject({
    itemCount: 3,
    closedCount: 2,
    movedCount: 1,
    targetCycleId: target.id,
  });
  expect(value(await rolloverPlanningCycle(fixture.db, owner, input, signal())).movedCount).toBe(0);
  expect(
    value(await readPlanningGroup(fixture.db, owner, sourceKey, signal())).group.rolloverSnapshot,
  ).toEqual(snapshot);
});

test("saved view locks protect the shared definition and favorites and display remain scoped", async () => {
  const owner = await staff("View author");
  const viewer = await staff("View reader");
  const projectId = await project(owner.userId);
  await fixture.db.insert(agencyProjectMembers).values({ projectId, userId: viewer.userId });
  const item = await workItem(projectId, {
    title: "Release settings",
    createdBy: owner.userId,
    startDate: "2026-11-21",
    dueDate: "2026-11-29",
  });
  const display = {
    ...defaultPlanningViewDisplay,
    groupBy: "priority" as const,
    subGroupBy: "assignee" as const,
    itemScope: "active" as const,
    orderBy: "dueDate" as const,
    showAssignee: false,
    showKey: false,
  };
  const filters = {
    ...emptyPlanningViewFilters,
    createdBy: owner.userId,
    startFrom: "2026-11-20",
    dueTo: "2026-11-30",
  };
  const input = {
    projectId,
    expectedActorId: owner.userId,
    csrfToken: null,
    viewId: randomUUID(),
    title: "Milestones",
    description: "",
    revision: null,
    visibility: "project" as const,
    layout: "board" as const,
    filters,
    display,
  };
  const created = value(await savePlanningView(fixture.db, owner, input, signal()));
  expect(created).toMatchObject({ display, filters, locked: false, favorite: false });
  expect(planningViewDisplayInput.safeParse({ ...display, subGroupBy: "priority" }).success).toBe(
    false,
  );
  expect(matchesPlanningItemScope("active", "unstarted")).toBe(true);
  expect(matchesPlanningItemScope("active", "completed")).toBe(false);
  expect(matchesPlanningItemScope("backlog", "backlog")).toBe(true);
  expect(matchesPlanningFilters(item, filters)).toBe(true);
  expect(matchesPlanningFilters(item, { ...filters, dueTo: "2026-11-28" })).toBe(false);
  expect(planningViewFiltersInput.safeParse({ ...filters, dueFrom: "2026-12-01" }).success).toBe(
    false,
  );
  expect(
    sortPlanningViewItems(
      [
        { sequenceNumber: 1, dueDate: null, startDate: item.startDate, priority: item.priority },
        {
          sequenceNumber: 2,
          dueDate: item.dueDate,
          startDate: item.startDate,
          priority: item.priority,
        },
      ],
      "dueDate",
    ).map(({ sequenceNumber }) => sequenceNumber),
  ).toEqual([2, 1]);

  const viewerIntent = { ...input, expectedActorId: viewer.userId };
  expect(
    value(
      await setPlanningViewFavorite(
        fixture.db,
        viewer,
        { ...viewerIntent, favorite: true },
        signal(),
      ),
    ).favorite,
  ).toBe(true);
  expect(
    value(
      await setPlanningViewFavorite(
        fixture.db,
        viewer,
        { ...viewerIntent, favorite: true },
        signal(),
      ),
    ).favorite,
  ).toBe(true);
  expect(value(await readPlanningView(fixture.db, owner, input, signal())).favorite).toBe(false);
  expect(
    value(await listPlanningViews(fixture.db, viewer, projectId, signal())).views[0]?.favorite,
  ).toBe(true);
  expect(
    value(
      await setPlanningViewFavorite(
        fixture.db,
        viewer,
        { ...viewerIntent, favorite: false },
        signal(),
      ),
    ).favorite,
  ).toBe(false);
  const privateView = value(
    await savePlanningView(
      fixture.db,
      owner,
      { ...input, viewId: randomUUID(), visibility: "private" },
      signal(),
    ),
  );
  expect(
    await setPlanningViewFavorite(
      fixture.db,
      viewer,
      { ...viewerIntent, viewId: privateView.id, favorite: true },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));

  expect(
    await setPlanningViewLock(
      fixture.db,
      viewer,
      { ...viewerIntent, revision: created.revision, locked: true },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  const locked = value(
    await setPlanningViewLock(
      fixture.db,
      owner,
      { ...input, revision: created.revision, locked: true },
      signal(),
    ),
  );
  expect(locked).toMatchObject({ locked: true, revision: 1 });
  expect(
    await savePlanningView(
      fixture.db,
      owner,
      { ...input, revision: locked.revision, title: "Changed" },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  const unlocked = value(
    await setPlanningViewLock(
      fixture.db,
      owner,
      { ...input, revision: locked.revision, locked: false },
      signal(),
    ),
  );
  expect(
    value(
      await savePlanningView(
        fixture.db,
        owner,
        { ...input, revision: unlocked.revision, title: "Updated" },
        signal(),
      ),
    ),
  ).toMatchObject({ title: "Updated", display });
});

test("confirmed saved-view deletion requires current owner authority and leaves project work intact", async () => {
  const owner = await staff("Project owner");
  const author = await staff("View author");
  const other = await staff("Other project editor", true);
  const projectId = await project(owner.userId);
  const item = await workItem(projectId);
  await fixture.db
    .insert(agencyProjectMembers)
    .values([author, other].map(({ userId }) => ({ projectId, userId, projectEdit: true })));
  const input: SavePlanningView = {
    projectId,
    viewId: randomUUID(),
    expectedActorId: author.userId,
    csrfToken: null,
    title: "Shared release view",
    description: "",
    revision: null,
    visibility: "project",
    layout: "list",
    filters: emptyPlanningViewFilters,
  };
  const shared = value(await savePlanningView(fixture.db, author, input, signal()));
  const target = {
    projectId,
    viewId: shared.id,
    expectedActorId: author.userId,
    csrfToken: null,
    revision: shared.revision,
  };
  await setPlanningViewFavorite(
    fixture.db,
    owner,
    { ...target, expectedActorId: owner.userId, favorite: true },
    signal(),
  );
  expect(
    await deletePlanningView(
      fixture.db,
      other,
      { ...target, expectedActorId: other.userId },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  const archived = value(
    await setPlanningViewArchive(fixture.db, author, { ...target, archived: true }, signal()),
  );
  expect(value(await readPlanningView(fixture.db, owner, target, signal())).archived).toBe(true);
  expect(
    await deletePlanningView(
      fixture.db,
      owner,
      { ...target, expectedActorId: owner.userId },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  expect(
    value(
      await deletePlanningView(
        fixture.db,
        owner,
        { ...target, expectedActorId: owner.userId, revision: archived.revision },
        signal(),
      ),
    ).viewId,
  ).toBe(shared.id);
  expect(await readPlanningView(fixture.db, author, target, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    await fixture.db
      .select()
      .from(internalProjectSavedViewFavorites)
      .where(eq(internalProjectSavedViewFavorites.viewId, shared.id)),
  ).toEqual([]);
  expect(
    await fixture.db
      .select({ id: internalProjectItems.id })
      .from(internalProjectItems)
      .where(eq(internalProjectItems.id, item.id)),
  ).toEqual([{ id: item.id }]);

  const privateView = value(
    await savePlanningView(
      fixture.db,
      author,
      { ...input, viewId: randomUUID(), visibility: "private" },
      signal(),
    ),
  );
  const privateTarget = { ...target, viewId: privateView.id, revision: privateView.revision };
  expect(
    await deletePlanningView(
      fixture.db,
      owner,
      { ...privateTarget, expectedActorId: owner.userId },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  expect(value(await deletePlanningView(fixture.db, author, privateTarget, signal())).viewId).toBe(
    privateView.id,
  );
});
