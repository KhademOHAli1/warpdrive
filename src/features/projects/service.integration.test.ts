import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
  seedHistoricalUser,
} from "@/db/migrationAdmission.test-helpers";
import { organizations, permissionSets, sessions, users } from "@/db/schema";
import { createNativeProjectRepository } from "@/features/agency-projects/nativeProject";
import { listNativeProjects } from "@/features/agency-projects/nativeProjectList";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { type ProjectMemberGrant, projectItemKey } from "./contracts";
import { readWorkspacePlanning } from "./planning/assignments";
import { internalProjectPlanningGroups } from "./planning/schema";
import { internalProjectItemEvents } from "./profile/schema";
import {
  createInternalProject,
  createInternalProjectItem,
  listInternalProjects,
  readInternalProject,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "./service";
import {
  saveInternalProjectSettings,
  saveInternalProjectStates,
  setInternalProjectArchived,
} from "./settings/service";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(10_000);
const standardEditor = { role: "editor", canAssign: false } satisfies ProjectMemberGrant;
const viewerGrant = { role: "viewer", canAssign: false } satisfies ProjectMemberGrant;
const coordinatorGrant = { role: "editor", canAssign: true } satisfies ProjectMemberGrant;

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES (true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
});

afterAll(async () => {
  await fixture.close();
});

function value<T, E>(result: Result<T, E>): T {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new TypeError("Expected a successful fixture operation");
  return result.value;
}

async function staff(
  name: string,
  fields: { isAdmin?: boolean; invitedAt?: Date; isActive?: boolean } = {},
  h = fixture,
) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({ id: userId, name, email: `${userId}@example.test`, ...fields });
  await h.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

async function grantCreation(userId: string) {
  const id = randomUUID();
  await fixture.db
    .insert(permissionSets)
    .values({ id, name: id, flags: { "project.create": true } });
  await fixture.db.update(users).set({ permissionSetId: id }).where(eq(users.id, userId));
}

function storedItemActivity(itemId: string) {
  const { actorId, kind } = internalProjectItemEvents;
  return fixture.db
    .select({ actorId, kind })
    .from(internalProjectItemEvents)
    .where(eq(internalProjectItemEvents.itemId, itemId))
    .orderBy(asc(kind), asc(actorId));
}

test("requires a creation grant and keeps internal and client projects private and distinct", async () => {
  const owner = await staff("Project owner");
  const outsider = await staff("Other administrator", { isAdmin: true });
  const input = { id: randomUUID(), title: "Dispatch redesign" };
  expect(value(await listInternalProjects(fixture.db, owner, signal())).canCreate).toBe(false);
  expect(await createInternalProject(fixture.db, owner, input, signal())).toEqual(
    err("project_forbidden"),
  );
  await grantCreation(owner.userId);
  expect(value(await listInternalProjects(fixture.db, owner, signal())).canCreate).toBe(true);
  const internal = value(await createInternalProject(fixture.db, owner, input, signal()));
  const orgId = randomUUID();
  await fixture.db
    .insert(organizations)
    .values({ id: orgId, name: "Synthetic client", ownerId: owner.userId, visibilityLevel: "all" });
  const clientRepo = createNativeProjectRepository(fixture.db, owner);
  const { projectId: clientId } = value(
    await clientRepo.create(
      {
        intentId: randomUUID(),
        title: "Client handoff",
        ownerUserId: owner.userId,
        dealId: null,
        personId: null,
        orgId,
      },
      signal(),
    ),
  );

  const [stored] = await fixture.db
    .select()
    .from(agencyProjects)
    .where(eq(agencyProjects.id, internal.id));
  expect(stored).toMatchObject({
    kind: "internal",
    dealId: null,
    orgId: null,
    personId: null,
    ownerUserId: owner.userId,
  });
  expect(value(await listInternalProjects(fixture.db, owner, signal())).projects).toEqual([
    internal,
  ]);
  expect(
    value(
      await listNativeProjects(fixture.db, owner, { filters: { schemaVersion: 1 } }, signal()),
    ).items.map(({ id }) => id),
  ).toEqual([clientId]);
  expect(await readInternalProject(fixture.db, owner, clientId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await clientRepo.read(internal.id, signal())).toEqual(err("project_unavailable"));
  expect(value(await listInternalProjects(fixture.db, outsider, signal())).projects).toEqual([]);
  expect(await readInternalProject(fixture.db, outsider, internal.id, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    await createInternalProjectItem(
      fixture.db,
      outsider,
      {
        projectId: internal.id,
        id: randomUUID(),
        title: "Denied write",
        status: "todo",
      },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
});

test("enforces project-local editor, viewer and assignment grants and clears removed assignments", async () => {
  const [owner, viewer, editor, coordinator, invited, inactive] = await Promise.all([
    staff("Owner", { isAdmin: true }),
    staff("Viewer"),
    staff("Editor"),
    staff("Coordinator"),
    staff("Invite pending", { invitedAt: new Date() }),
    staff("Inactive", { isActive: false }),
  ]);
  const { id: projectId } = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Planning" },
      signal(),
    ),
  );
  const member = (userId: string, membership: ProjectMemberGrant | null) =>
    setInternalProjectMember(fixture.db, owner, { projectId, userId, membership }, signal());
  value(await member(viewer.userId, viewerGrant));
  value(await member(editor.userId, standardEditor));
  value(await member(coordinator.userId, coordinatorGrant));
  for (const denied of [invited, inactive]) {
    expect(await member(denied.userId, standardEditor)).toEqual(err("project_invalid"));
    // A project relation left by an earlier account state still cannot grant access.
    await fixture.db
      .insert(agencyProjectMembers)
      .values({ projectId, userId: denied.userId, projectEdit: true, assignmentCoordinate: true });
    expect(await listInternalProjects(fixture.db, denied, signal())).toEqual(
      err("project_unavailable"),
    );
    expect(await readInternalProject(fixture.db, denied, projectId, signal())).toEqual(
      err("project_unavailable"),
    );
  }
  const viewerWorkspace = value(await readInternalProject(fixture.db, viewer, projectId, signal()));
  expect(viewerWorkspace).toMatchObject({
    canEdit: false,
    canAssign: false,
    canManageMembers: false,
    staff: [],
  });
  expect(viewerWorkspace.assignees.map(({ name }) => name)).toEqual([
    "Owner",
    "Coordinator",
    "Editor",
    "Viewer",
  ]);
  expect(value(await readInternalProject(fixture.db, editor, projectId, signal()))).toMatchObject({
    canEdit: true,
    canAssign: false,
    canManageMembers: false,
  });
  expect(
    value(await readInternalProject(fixture.db, coordinator, projectId, signal())),
  ).toMatchObject({ canEdit: true, canAssign: true, canManageMembers: false });

  const draft = { projectId, id: randomUUID(), title: "Book transport", status: "todo" } as const;
  expect(await createInternalProjectItem(fixture.db, viewer, draft, signal())).toEqual(
    err("project_forbidden"),
  );
  expect(
    await createInternalProjectItem(
      fixture.db,
      editor,
      { ...draft, assigneeId: viewer.userId },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await createInternalProjectItem(
      fixture.db,
      coordinator,
      { ...draft, assigneeId: invited.userId },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  const created = value(await createInternalProjectItem(fixture.db, editor, draft, signal()));
  const [item] = created.items;
  if (item === undefined) throw new TypeError("Expected a project item");
  expect(item).toMatchObject({
    assigneeId: null,
    priority: "none",
    startDate: null,
    dueDate: null,
    description: "",
    createdBy: editor.userId,
  });
  const update = { projectId, itemId: item.id, revision: item.revision };
  expect(
    await updateInternalProjectItem(fixture.db, viewer, { ...update, status: "done" }, signal()),
  ).toEqual(err("project_forbidden"));
  expect(
    await updateInternalProjectItem(
      fixture.db,
      editor,
      { ...update, assigneeId: viewer.userId },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await updateInternalProjectItem(
      fixture.db,
      coordinator,
      { ...update, assigneeId: invited.userId },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(
    await setInternalProjectMember(
      fixture.db,
      coordinator,
      { projectId, userId: viewer.userId, membership: null },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  const moved = value(
    await updateInternalProjectItem(
      fixture.db,
      editor,
      { ...update, status: "in-progress" },
      signal(),
    ),
  );
  expect(moved.items).toMatchObject([
    { id: item.id, revision: 1, status: "in-progress", assigneeId: null },
  ]);
  expect(
    await updateInternalProjectItem(
      fixture.db,
      coordinator,
      { ...update, assigneeId: viewer.userId },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  const assigned = value(
    await updateInternalProjectItem(
      fixture.db,
      coordinator,
      { ...update, revision: 1, assigneeId: viewer.userId },
      signal(),
    ),
  );
  expect(assigned.items).toMatchObject([{ id: item.id, revision: 2, assigneeId: viewer.userId }]);
  const removed = value(await member(viewer.userId, null));
  expect(removed.items).toMatchObject([{ id: item.id, revision: 3, assigneeId: null }]);
  expect(await readInternalProject(fixture.db, viewer, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(value(await listInternalProjects(fixture.db, viewer, signal())).projects).toEqual([]);
  const activity = await storedItemActivity(item.id);
  expect(activity).toHaveLength(3);
  expect(activity).toEqual(
    expect.arrayContaining([
      { actorId: editor.userId, kind: "created" },
      { actorId: editor.userId, kind: "updated" },
      { actorId: coordinator.userId, kind: "updated" },
    ]),
  );
});

test("keeps concurrent same-intent creates idempotent and rejects cross-project item writes", async () => {
  const owner = await staff("Delivery owner", { isAdmin: true });
  const draft = { id: randomUUID(), title: "Primary project" };
  const [initial, retry] = await Promise.all([
    createInternalProject(fixture.db, owner, draft, signal()),
    createInternalProject(fixture.db, owner, draft, signal()),
  ]);
  const created = value(initial);
  expect(value(retry)).toEqual(created);
  expect(value(await listInternalProjects(fixture.db, owner, signal())).projects).toEqual([
    created,
  ]);
  const other = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Secondary project" },
      signal(),
    ),
  );
  const itemDraft = {
    projectId: created.id,
    id: randomUUID(),
    title: "Plan acceptance",
    status: "todo",
    priority: "high",
    startDate: "2026-11-21",
    dueDate: "2026-11-30",
    description: "Confirm the scope.\nSchedule sign-off.",
    assigneeId: owner.userId,
  } as const;
  const [firstItem, repeatedItem] = await Promise.all([
    createInternalProjectItem(fixture.db, owner, itemDraft, signal()),
    createInternalProjectItem(fixture.db, owner, itemDraft, signal()),
  ]);
  const items = value(firstItem).items;
  expect(value(repeatedItem).items).toEqual(items);
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) throw new TypeError("Expected a project item");
  expect(item).toMatchObject({
    priority: itemDraft.priority,
    startDate: itemDraft.startDate,
    dueDate: itemDraft.dueDate,
    description: itemDraft.description,
    assigneeId: itemDraft.assigneeId,
    createdBy: owner.userId,
    revision: 0,
    sequenceNumber: 1,
  });
  expect(
    await createInternalProjectItem(fixture.db, owner, { ...itemDraft, priority: "low" }, signal()),
  ).toEqual(err("project_conflict"));
  expect(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { projectId: other.id, itemId: item.id, revision: 0, status: "done" },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  expect(value(await readInternalProject(fixture.db, owner, created.id, signal())).items).toEqual(
    items,
  );
  const update = { projectId: created.id, itemId: item.id, revision: 0 };
  expect(
    value(
      await updateInternalProjectItem(
        fixture.db,
        owner,
        { ...update, status: item.status, priority: item.priority, startDate: item.startDate },
        signal(),
      ),
    ).items,
  ).toEqual(items);
  expect(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { ...update, dueDate: "2026-11-20", description: "This must not be stored" },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(value(await readInternalProject(fixture.db, owner, created.id, signal())).items).toEqual(
    items,
  );
  const rescheduled = value(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { ...update, dueDate: "2026-11-20", startDate: null, priority: "medium" },
      signal(),
    ),
  );
  expect(rescheduled.items).toMatchObject([
    {
      ...item,
      updatedAt: expect.any(String),
      dueDate: "2026-11-20",
      startDate: null,
      priority: "medium",
      revision: 1,
    },
  ]);
  expect(
    value(await createInternalProjectItem(fixture.db, owner, itemDraft, signal())).items,
  ).toEqual(rescheduled.items);
  expect(await storedItemActivity(item.id)).toEqual([
    { actorId: owner.userId, kind: "created" },
    { actorId: owner.userId, kind: "updated" },
  ]);
  const next = value(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { ...itemDraft, id: randomUUID(), title: "Second item" },
      signal(),
    ),
  );
  expect(next.items.map(({ sequenceNumber }) => sequenceNumber)).toEqual([1, 2]);
  const otherWorkspace = value(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { ...itemDraft, projectId: other.id },
      signal(),
    ),
  );
  expect(otherWorkspace.items[0]).toMatchObject({ sequenceNumber: 1 });
});

test("upgrades populated work items, preserving identity, unknown authorship and project-local state", async () => {
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  let workflowUpgrade: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    await installPrefix(h, 122);
    target = await migrationFolder(123);
    const { id: userId } = await seedHistoricalUser(h, { name: "Legacy project owner" });
    const owner = { userId, sessionId: randomUUID() };
    await h.db.insert(sessions).values({
      id: owner.sessionId,
      userId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 600_000),
      authMethod: "legacy",
      assurance: "legacy",
    });
    const projectId = randomUUID();
    const itemId = randomUUID();
    const clientProjectId = randomUUID();
    const phantomClientItemId = randomUUID();
    const clientOrgId = randomUUID();
    const createdAt = "2026-11-14T12:30:00.000Z";
    await h.pool.query(
      "INSERT INTO agency_project_settings(id,enabled) VALUES (true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
    );
    await h.pool.query(
      "INSERT INTO agency_projects(id,kind,title,owner_user_id) VALUES($1,'internal','Legacy project',$2)",
      [projectId, owner.userId],
    );
    await h.pool.query(
      `INSERT INTO internal_project_items(id,project_id,title,status,assignee_id,revision,created_at)
       VALUES($1,$2,'Inspect fixtures','in-progress',$3,7,$4)`,
      [itemId, projectId, owner.userId, createdAt],
    );
    await h.pool.query(
      "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,'Legacy client',$2,'all')",
      [clientOrgId, owner.userId],
    );
    await h.pool.query(
      "INSERT INTO agency_projects(id,kind,title,owner_user_id,org_id) VALUES($1,'client','Legacy client project',$2,$3)",
      [clientProjectId, owner.userId, clientOrgId],
    );
    await h.pool.query(
      "INSERT INTO internal_project_items(id,project_id,title) VALUES($1,$2,'Previously inserted out of band')",
      [phantomClientItemId, clientProjectId],
    );
    const priorLedger = await ledger(h);
    expect(priorLedger).toHaveLength(122);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    const nextLedger = await ledger(h);
    expect(nextLedger).toHaveLength(123);
    expect(nextLedger.slice(0, 122)).toEqual(priorLedger);
    expect(
      (await h.pool.query("SELECT created_at FROM internal_project_items WHERE id=$1", [itemId]))
        .rows,
    ).toEqual([{ created_at: new Date(createdAt) }]);
    const saved = await h.pool.query(
      `SELECT id,title,status,assignee_id,priority,start_date,due_date,description,created_by,revision::int
         FROM internal_project_items WHERE project_id=$1`,
      [projectId],
    );
    expect(saved.rows).toEqual([
      {
        id: itemId,
        title: "Inspect fixtures",
        status: "in-progress",
        assignee_id: owner.userId,
        priority: "none",
        start_date: null,
        due_date: null,
        description: "",
        created_by: null,
        revision: 7,
      },
    ]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toMatchObject({
      ok: true,
    });
    expect(await ledger(h)).toEqual(nextLedger);

    workflowUpgrade = await migrationFolder();
    expect(
      await applyMigrations(h.db, AbortSignal.timeout(30_000), workflowUpgrade.folder),
    ).toEqual({
      ok: true,
      value: { applied: true },
    });
    const workspace = value(await readInternalProject(h.db, owner, projectId, signal()));
    expect(workspace.states).toHaveLength(3);
    expect(workspace.project.identifier).toMatch(/^P[0-9]+$/u);
    const started = workspace.states.find(({ category }) => category === "started");
    if (started === undefined) throw new TypeError("Started state missing after upgrade");
    expect(workspace.items).toMatchObject([
      {
        id: itemId,
        stateId: started.id,
        status: "in-progress",
        revision: 7,
        createdBy: null,
        sequenceNumber: 1,
        archivedAt: null,
      },
    ]);
    expect(
      (
        await h.pool.query(
          "SELECT state_id, sequence_number FROM internal_project_items WHERE id=$1",
          [phantomClientItemId],
        )
      ).rows,
    ).toEqual([{ state_id: null, sequence_number: null }]);
    expect(await readInternalProject(h.db, owner, clientProjectId, signal())).toEqual(
      err("project_unavailable"),
    );
    expect((await ledger(h)).slice(0, nextLedger.length)).toEqual(nextLedger);
  } finally {
    await Promise.all([target?.dispose(), workflowUpgrade?.dispose(), h.close()]);
  }
});

test("authorizes settings and archive lifecycle only for the owner, preserving the create replay", async () => {
  const [owner, editor] = await Promise.all([
    staff("Settings owner", { isAdmin: true }),
    staff("Settings editor"),
  ]);
  const intent = { id: randomUUID(), title: "Original settings title" };
  const project = value(await createInternalProject(fixture.db, owner, intent, signal()));
  const target = { projectId: project.id, revision: 0 };
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId: project.id, userId: editor.userId, membership: standardEditor },
      signal(),
    ),
  );
  const details = { ...target, title: "Renamed project", description: "Updated scope" };
  expect(await saveInternalProjectSettings(fixture.db, editor, details, signal())).toEqual(
    err("project_forbidden"),
  );
  const configured = value(await saveInternalProjectSettings(fixture.db, owner, details, signal()));
  expect(configured).toMatchObject({
    project: { title: details.title },
    settings: { description: details.description, revision: 1 },
  });
  expect(value(await createInternalProject(fixture.db, owner, intent, signal()))).toMatchObject({
    id: project.id,
    title: details.title,
  });
  expect(
    await createInternalProject(fixture.db, owner, { ...intent, title: details.title }, signal()),
  ).toEqual(err("project_conflict"));
  const archived = value(
    await setInternalProjectArchived(
      fixture.db,
      owner,
      { ...target, revision: 1, archived: true },
      signal(),
    ),
  );
  expect(archived).toMatchObject({
    project: { archived: true },
    canEdit: false,
    canManageMembers: false,
    canManageSettings: true,
  });
  expect(value(await readInternalProject(fixture.db, editor, project.id, signal()))).toMatchObject({
    project: { archived: true },
    canEdit: false,
    canManageSettings: false,
  });
  expect(value(await listInternalProjects(fixture.db, owner, signal())).projects).toContainEqual(
    archived.project,
  );
  expect(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { projectId: project.id, id: randomUUID(), title: "Blocked while archived" },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await saveInternalProjectSettings(fixture.db, owner, { ...details, revision: 2 }, signal()),
  ).toEqual(err("project_forbidden"));
  expect(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId: project.id, userId: editor.userId, membership: null },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await setInternalProjectArchived(
      fixture.db,
      editor,
      { ...target, revision: 2, archived: false },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await setInternalProjectArchived(
      fixture.db,
      owner,
      { ...target, revision: 1, archived: false },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  expect(
    value(
      await setInternalProjectArchived(
        fixture.db,
        owner,
        { ...target, revision: 2, archived: false },
        signal(),
      ),
    ),
  ).toMatchObject({ project: { archived: false }, canEdit: true, settings: { revision: 3 } });
});

test("keeps item keys stable by project sequence and applies permitted metadata defaults", async () => {
  const [owner, editor, outsider] = await Promise.all([
    staff("Key owner", { isAdmin: true }),
    staff("Project lead"),
    staff("Unrelated staff"),
  ]);
  const intent = { id: randomUUID(), title: "Incoming inventory" };
  const project = value(await createInternalProject(fixture.db, owner, intent, signal()));
  const other = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Other inventory" },
      signal(),
    ),
  );
  const target = { projectId: project.id, revision: 0, title: project.title, description: "" };
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId: project.id, userId: editor.userId, membership: standardEditor },
      signal(),
    ),
  );
  expect(
    await saveInternalProjectSettings(
      fixture.db,
      owner,
      { ...target, leadUserId: outsider.userId },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(
    await saveInternalProjectSettings(
      fixture.db,
      owner,
      { ...target, title: "Conflict must roll back", identifier: other.identifier },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  expect(value(await readInternalProject(fixture.db, owner, project.id, signal())).project).toEqual(
    project,
  );

  const configured = value(
    await saveInternalProjectSettings(
      fixture.db,
      owner,
      {
        ...target,
        identifier: "INV",
        leadUserId: editor.userId,
        defaultAssigneeId: editor.userId,
      },
      signal(),
    ),
  );
  expect(configured.settings).toMatchObject({
    leadUserId: editor.userId,
    defaultAssigneeId: editor.userId,
  });
  const draft = { projectId: project.id, id: randomUUID(), title: "Count stock" };
  const first = value(await createInternalProjectItem(fixture.db, owner, draft, signal())).items[0];
  if (first === undefined) throw new TypeError("Expected the first numbered item");
  expect(first).toMatchObject({ sequenceNumber: 1, assigneeId: editor.userId });
  expect(projectItemKey(configured.project.identifier, first.sequenceNumber)).toBe("INV-1");
  const editorItems = value(
    await createInternalProjectItem(
      fixture.db,
      editor,
      { ...draft, id: randomUUID(), title: "Count returns" },
      signal(),
    ),
  ).items;
  expect(editorItems).toContainEqual(
    expect.objectContaining({ sequenceNumber: 2, assigneeId: null }),
  );
  const withoutDefault = value(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { ...draft, id: randomUUID(), title: "Count supplies", assigneeId: null },
      signal(),
    ),
  ).items;
  expect(withoutDefault).toContainEqual(
    expect.objectContaining({ sequenceNumber: 3, assigneeId: null }),
  );
  const renamed = value(
    await saveInternalProjectSettings(
      fixture.db,
      owner,
      {
        ...target,
        revision: 1,
        identifier: "STOCK",
      },
      signal(),
    ),
  );
  expect(projectItemKey(renamed.project.identifier, first.sequenceNumber)).toBe("STOCK-1");
  expect(renamed.items).toContainEqual(first);
  const cleared = value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId: project.id, userId: editor.userId, membership: null },
      signal(),
    ),
  );
  expect(cleared.settings).toMatchObject({
    leadUserId: null,
    defaultAssigneeId: null,
    revision: 3,
  });
  expect(cleared.items).toContainEqual(
    expect.objectContaining({ id: first.id, sequenceNumber: 1, assigneeId: null }),
  );
});

test("applies project-specific state defaults and ordering and retains the legacy status projection", async () => {
  const owner = await staff("Workflow owner", { isAdmin: true });
  const createProject = async (title: string) =>
    value(await createInternalProject(fixture.db, owner, { id: randomUUID(), title }, signal()));
  const project = await createProject("Workflow project");
  const other = await createProject("Unrelated workflow");
  const workspace = value(await readInternalProject(fixture.db, owner, project.id, signal()));
  const foreignState = value(await readInternalProject(fixture.db, owner, other.id, signal()))
    .states[0];
  const started = workspace.states.find(({ category }) => category === "started");
  if (started === undefined || foreignState === undefined)
    throw new TypeError("Seeded states missing");
  expect(workspace.states.map(({ name }) => name)).toEqual(["To do", "In progress", "Done"]);
  const custom = { ...started, id: randomUUID(), name: "In review", position: 0, isDefault: true };
  const states = workspace.states.map((state) => ({
    ...state,
    isDefault: false,
    position: state.id === started.id ? 1 : state.position,
  }));
  const set = value(
    await saveInternalProjectStates(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, states: [...states, custom] },
      signal(),
    ),
  );
  expect(set.states.map(({ name }) => name)).toEqual(["To do", "In review", "In progress", "Done"]);
  const moduleId = randomUUID();
  const alternateModuleId = randomUUID();
  await fixture.db.insert(internalProjectPlanningGroups).values([
    {
      id: moduleId,
      projectId: project.id,
      title: "Receiving",
      kind: "modules",
      description: "",
      moduleStatus: "planned",
    },
    {
      id: alternateModuleId,
      projectId: project.id,
      title: "Dispatch",
      kind: "modules",
      description: "",
      moduleStatus: "planned",
    },
  ]);
  const item = {
    projectId: project.id,
    id: randomUUID(),
    title: "First custom state item",
    planning: { moduleId },
  };
  expect(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { ...item, stateId: foreignState.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  const created = value(await createInternalProjectItem(fixture.db, owner, item, signal()))
    .items[0];
  if (created === undefined) throw new TypeError("Work item missing");
  expect(created).toMatchObject({ stateId: custom.id, status: "in-progress", revision: 0 });
  expect(
    value(await readWorkspacePlanning(fixture.db, owner, project.id, signal())).assignments,
  ).toEqual([{ itemId: created.id, cycleId: null, moduleIds: [moduleId] }]);
  expect(value(await createInternalProjectItem(fixture.db, owner, item, signal())).items).toEqual([
    created,
  ]);
  expect(
    await createInternalProjectItem(
      fixture.db,
      owner,
      { ...item, planning: { moduleId: alternateModuleId } },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  const itemTarget = { projectId: project.id, itemId: created.id, revision: 0 };
  expect(
    value(
      await updateInternalProjectItem(
        fixture.db,
        owner,
        { ...itemTarget, status: "in-progress" },
        signal(),
      ),
    ).items,
  ).toEqual([created]);
  expect(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { ...itemTarget, stateId: foreignState.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(
    await saveInternalProjectStates(
      fixture.db,
      owner,
      { projectId: project.id, revision: 1, states: workspace.states },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  const recategorized = value(
    await saveInternalProjectStates(
      fixture.db,
      owner,
      {
        projectId: project.id,
        revision: 1,
        states: set.states.map((state) =>
          state.id === custom.id ? { ...state, category: "completed" } : state,
        ),
      },
      signal(),
    ),
  );
  expect(recategorized.items).toMatchObject([
    { id: created.id, stateId: custom.id, status: "done", revision: 1 },
  ]);
});
