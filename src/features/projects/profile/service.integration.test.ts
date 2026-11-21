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
import { readProjectProfileItems, readProjectProfileSummary } from "./service";

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
