import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { organizations, permissionSets, sessions, users } from "@/db/schema";
import { createNativeProjectRepository } from "@/features/agency-projects/nativeProject";
import { listNativeProjects } from "@/features/agency-projects/nativeProjectList";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import type { ProjectMemberGrant } from "./contracts";
import {
  createInternalProject,
  createInternalProjectItem,
  listInternalProjects,
  readInternalProject,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "./service";

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
) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await fixture.db
    .insert(users)
    .values({ id: userId, name, email: `${userId}@example.test`, ...fields });
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

async function grantCreation(userId: string) {
  const id = randomUUID();
  await fixture.db
    .insert(permissionSets)
    .values({ id, name: id, flags: { "project.create": true } });
  await fixture.db.update(users).set({ permissionSetId: id }).where(eq(users.id, userId));
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
  const created = value(await createInternalProjectItem(fixture.db, editor, draft, signal()));
  const [item] = created.items;
  if (item === undefined) throw new TypeError("Expected a project item");
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
});
