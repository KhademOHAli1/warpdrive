import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { organizations, sessions, users } from "@/db/schema";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import { internalProjectItems } from "../schema";
import { profileItemsInput } from "./contracts";
import { recordProjectItemEvent } from "./events";
import { internalProjectItemSubscriptions } from "./schema";
import {
  readProjectProfileActivity,
  readProjectProfileItems,
  readProjectProfileSummary,
} from "./service";
import { readProjectSubscription, setProjectSubscription } from "./subscriptions";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(10_000);

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES (true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
});

afterAll(async () => {
  await fixture.close();
});

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

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected a successful profile read");
  return result.value;
}

test("only assigned or created work in currently visible internal projects reaches the profile", async () => {
  const member = await staff("Assigned administrator", true);
  const owner = await staff("Other project owner");
  const memberProject = randomUUID();
  const ownedProject = randomUUID();
  const hiddenProject = randomUUID();
  const clientProject = randomUUID();
  const orgId = randomUUID();
  await fixture.db.insert(organizations).values({
    id: orgId,
    ownerId: member.userId,
    name: "Synthetic client",
    visibilityLevel: "all",
  });
  await fixture.db.insert(agencyProjects).values([
    { id: memberProject, kind: "internal", ownerUserId: owner.userId, title: "Member project" },
    { id: ownedProject, kind: "internal", ownerUserId: member.userId, title: "Owned project" },
    { id: hiddenProject, kind: "internal", ownerUserId: owner.userId, title: "Hidden project" },
    {
      id: clientProject,
      kind: "client",
      ownerUserId: member.userId,
      orgId,
      title: "Client project",
    },
  ]);
  await fixture.db
    .insert(agencyProjectMembers)
    .values({ projectId: memberProject, userId: member.userId });
  // Deliberately seed stale or incompatible assignments to verify that the read also checks the
  // kind and project membership, independent of the normal assignment writer's safeguards.
  await fixture.db.insert(internalProjectItems).values([
    {
      projectId: memberProject,
      title: "Member item",
      assigneeId: member.userId,
      status: "todo",
      priority: "high",
    },
    {
      projectId: ownedProject,
      title: "Owned item",
      assigneeId: member.userId,
      status: "done",
      priority: "urgent",
    },
    {
      projectId: ownedProject,
      title: "Other person's item",
      assigneeId: owner.userId,
      status: "done",
    },
    {
      projectId: memberProject,
      title: "My work for someone else",
      assigneeId: owner.userId,
      createdBy: member.userId,
      status: "in-progress",
    },
    {
      projectId: hiddenProject,
      title: "Stale assignment",
      assigneeId: member.userId,
      createdBy: member.userId,
      status: "done",
    },
    {
      projectId: clientProject,
      title: "Client item",
      assigneeId: member.userId,
      createdBy: member.userId,
      status: "done",
    },
  ]);

  expect(value(await readProjectProfileSummary(fixture.db, member, signal()))).toEqual({
    member: { id: member.userId, name: "Assigned administrator" },
    counts: { todo: 1, "in-progress": 0, done: 1 },
    priorityCounts: { urgent: 1, high: 1, medium: 0, low: 0, none: 0 },
    createdCount: 1,
    subscribedCount: 0,
  });
  const page = value(await readProjectProfileItems(fixture.db, member, "assigned", {}, signal()));
  expect(page.items).toHaveLength(2);
  expect(page.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Member item",
        project: { id: memberProject, title: "Member project" },
      }),
      expect.objectContaining({
        title: "Owned item",
        project: { id: ownedProject, title: "Owned project" },
      }),
    ]),
  );
  const filtered = value(
    await readProjectProfileItems(
      fixture.db,
      member,
      "assigned",
      { status: "done", priority: "urgent" },
      signal(),
    ),
  );
  expect(filtered.items.map(({ title }) => title)).toEqual(["Owned item"]);
  const created = value(await readProjectProfileItems(fixture.db, member, "created", {}, signal()));
  expect(created.items.map(({ title }) => title)).toEqual(["My work for someone else"]);

  await fixture.db
    .delete(agencyProjectMembers)
    .where(
      and(
        eq(agencyProjectMembers.projectId, memberProject),
        eq(agencyProjectMembers.userId, member.userId),
      ),
    );
  const afterRevocation = value(
    await readProjectProfileItems(fixture.db, member, "assigned", {}, signal()),
  );
  expect(afterRevocation.items.map(({ title }) => title)).toEqual(["Owned item"]);
  const createdAfterRevocation = value(
    await readProjectProfileItems(fixture.db, member, "created", {}, signal()),
  );
  expect(createdAfterRevocation.items).toEqual([]);
  await fixture.db.update(users).set({ isActive: false }).where(eq(users.id, member.userId));
  expect(await readProjectProfileSummary(fixture.db, member, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
});

test("subscriptions belong to the signed-in actor and require current project access", async () => {
  const viewer = await staff("Subscriber", true);
  const owner = await staff("Subscription project owner");
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const itemId = randomUUID();
  await fixture.db.insert(agencyProjects).values([
    { id: projectId, kind: "internal", ownerUserId: owner.userId, title: "Subscribed project" },
    { id: otherProjectId, kind: "internal", ownerUserId: viewer.userId, title: "Other project" },
  ]);
  await fixture.db.insert(agencyProjectMembers).values({ projectId, userId: viewer.userId });
  await fixture.db
    .insert(internalProjectItems)
    .values({ id: itemId, projectId, title: "Follow release" });

  const target = { projectId, itemId };
  expect(value(await readProjectSubscription(fixture.db, viewer, target, signal()))).toEqual({
    subscribed: false,
  });
  for (const actor of [viewer, viewer, owner]) {
    expect(
      value(
        await setProjectSubscription(fixture.db, actor, { ...target, subscribed: true }, signal()),
      ),
    ).toEqual({ subscribed: true });
  }
  const subscriptions = await fixture.db
    .select()
    .from(internalProjectItemSubscriptions)
    .where(eq(internalProjectItemSubscriptions.itemId, itemId));
  expect(subscriptions).toHaveLength(2);
  expect(value(await readProjectProfileSummary(fixture.db, viewer, signal())).subscribedCount).toBe(
    1,
  );
  expect(
    value(await readProjectProfileItems(fixture.db, viewer, "subscribed", {}, signal())).items.map(
      ({ id }) => id,
    ),
  ).toEqual([itemId]);
  expect(
    await setProjectSubscription(
      fixture.db,
      viewer,
      { projectId: otherProjectId, itemId, subscribed: false },
      signal(),
    ),
  ).toEqual({ ok: false, error: "project_unavailable" });

  expect(
    value(
      await setProjectSubscription(fixture.db, viewer, { ...target, subscribed: false }, signal()),
    ),
  ).toEqual({ subscribed: false });
  expect(value(await readProjectSubscription(fixture.db, owner, target, signal()))).toEqual({
    subscribed: true,
  });
  await setProjectSubscription(fixture.db, viewer, { ...target, subscribed: true }, signal());
  await fixture.db
    .delete(agencyProjectMembers)
    .where(eq(agencyProjectMembers.projectId, projectId));
  expect(await readProjectSubscription(fixture.db, viewer, target, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  expect(
    await setProjectSubscription(fixture.db, viewer, { ...target, subscribed: false }, signal()),
  ).toEqual({ ok: false, error: "project_unavailable" });
  expect(value(await readProjectProfileSummary(fixture.db, viewer, signal())).subscribedCount).toBe(
    0,
  );
  expect(
    value(await readProjectProfileItems(fixture.db, viewer, "subscribed", {}, signal())).items,
  ).toEqual([]);
});

test("activity projects only the actor’s persisted events in currently visible internal projects", async () => {
  const actor = await staff("Activity author", true);
  const owner = await staff("Activity project owner");
  const projectId = randomUUID();
  const hiddenProjectId = randomUUID();
  const itemId = randomUUID();
  const hiddenItemId = randomUUID();
  await fixture.db.insert(agencyProjects).values([
    { id: projectId, kind: "internal", ownerUserId: owner.userId, title: "Activity project" },
    {
      id: hiddenProjectId,
      kind: "internal",
      ownerUserId: owner.userId,
      title: "Hidden activity project",
    },
  ]);
  await fixture.db
    .insert(agencyProjectMembers)
    .values({ projectId, userId: actor.userId, projectEdit: true });
  await fixture.db.insert(internalProjectItems).values([
    { id: itemId, projectId, title: "Activity item", description: "Private body" },
    { id: hiddenItemId, projectId: hiddenProjectId, title: "Hidden activity item" },
  ]);
  await recordProjectItemEvent(fixture.db, {
    itemId: hiddenItemId,
    actorId: actor.userId,
    kind: "created",
  });
  await recordProjectItemEvent(fixture.db, { itemId, actorId: actor.userId, kind: "created" });
  await recordProjectItemEvent(fixture.db, { itemId, actorId: owner.userId, kind: "updated" });
  await recordProjectItemEvent(fixture.db, { itemId, actorId: actor.userId, kind: "updated" });

  const { events } = value(
    await readProjectProfileActivity(fixture.db, actor, undefined, signal()),
  );
  expect(events.map(({ kind }) => kind)).toEqual(["updated", "created"]);
  expect(events[0]?.item).toEqual({
    id: itemId,
    title: "Activity item",
    project: { id: projectId, title: "Activity project" },
  });
  await fixture.db
    .delete(agencyProjectMembers)
    .where(eq(agencyProjectMembers.projectId, projectId));
  expect(
    value(await readProjectProfileActivity(fixture.db, actor, undefined, signal())).events,
  ).toEqual([]);
});

test("the assigned page cursor preserves PostgreSQL microseconds", async () => {
  const owner = await staff("Project owner");
  const projectId = randomUUID();
  await fixture.db.insert(agencyProjects).values({
    id: projectId,
    kind: "internal",
    ownerUserId: owner.userId,
    title: "Project with many assignments",
  });
  await fixture.db.execute(sql`
    INSERT INTO internal_project_items (project_id, title, assignee_id, created_at)
    SELECT ${projectId}::uuid, 'Assignment ' || n, ${owner.userId}::uuid,
      '2026-11-20T10:00:00Z'::timestamptz + n * interval '1 microsecond'
    FROM generate_series(1, 52) AS n
  `);

  const first = value(await readProjectProfileItems(fixture.db, owner, "assigned", {}, signal()));
  expect(first.items).toHaveLength(50);
  expect(first.items.at(-1)?.title).toBe("Assignment 3");
  const input = profileItemsInput.parse({ cursor: first.nextCursor });
  const second = value(
    await readProjectProfileItems(fixture.db, owner, "assigned", input, signal()),
  );
  expect(second.nextCursor).toBeNull();
  expect(second.items.map(({ title }) => title)).toEqual(["Assignment 2", "Assignment 1"]);
});
