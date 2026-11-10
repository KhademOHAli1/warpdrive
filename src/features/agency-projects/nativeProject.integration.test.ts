import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { organizations, permissionSets, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createNativeProjectRepository } from "./nativeProject";
import { listNativeProjects } from "./nativeProjectList";
import { enableNativeProjects, projectWorkspace } from "./nativeViews";

let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
async function fixture() {
  const id = randomUUID();
  await h.db
    .insert(users)
    .values({ id, email: `${id}@example.test`, name: "Project owner", isAdmin: true });
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId: id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      authMethod: "legacy",
      assurance: "legacy",
    })
    .returning();
  const [org] = await h.db
    .insert(organizations)
    .values({ name: "Synthetic studio", ownerId: id, visibilityLevel: "all" })
    .returning();
  if (!session || !org) throw new TypeError("Missing test fixture");
  await h.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
  return {
    who: { userId: id, sessionId: session.id },
    input: {
      intentId: randomUUID(),
      ownerUserId: id,
      title: "Studio delivery",
      dealId: null,
      personId: null,
      orgId: org.id,
    },
  };
}

test("native project journey persists create/read/start and actor-bound replay without touching session", async () => {
  const f = await fixture();
  const repository = createNativeProjectRepository(h.db, f.who);
  const [before] = await h.db.select().from(sessions).where(eq(sessions.id, f.who.sessionId));
  const created = await repository.create(f.input, signal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(await repository.create(f.input, signal())).toEqual(created);
  expect(await repository.create({ ...f.input, title: "Changed intent" }, signal())).toEqual({
    ok: false,
    error: "intent_conflict",
  });
  const read = await repository.read(created.value.projectId, signal());
  expect(read).toMatchObject({
    ok: true,
    value: { title: f.input.title, state: "planned", revision: 0 },
  });
  const input = { projectId: created.value.projectId, intentId: randomUUID(), expectedRevision: 0 };
  const started = await repository.start(input, signal());
  expect(started).toEqual({ ok: true, value: { projectId: created.value.projectId, revision: 1 } });
  expect(await repository.start(input, signal())).toEqual(started);
  expect(await repository.read(created.value.projectId, signal())).toMatchObject({
    ok: true,
    value: { state: "active", revision: 1 },
  });
  const [after] = await h.db.select().from(sessions).where(eq(sessions.id, f.who.sessionId));
  expect(after).toEqual(before);
  const count = await h.pool.query(
    "SELECT count(*)::int AS count FROM agency_projects WHERE id=$1",
    [created.value.projectId],
  );
  expect(count.rows).toEqual([{ count: 1 }]);
  const page = await listNativeProjects(h.db, f.who, { filters: { schemaVersion: 1 } }, signal());
  expect(page).toMatchObject({
    ok: true,
    value: { items: [{ id: created.value.projectId, state: "active" }] },
  });
});

test("native module, live session, accepted staff and private project membership fail closed", async () => {
  const f = await fixture();
  const repository = createNativeProjectRepository(h.db, f.who);
  await h.pool.query("UPDATE agency_project_settings SET enabled=false");
  expect(await repository.create(f.input, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  await h.pool.query("UPDATE agency_project_settings SET enabled=true");
  await h.db.update(users).set({ invitedAt: new Date() }).where(eq(users.id, f.who.userId));
  expect(await repository.create(f.input, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  await h.db.update(users).set({ invitedAt: null }).where(eq(users.id, f.who.userId));
  const created = await repository.create(f.input, signal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const other = await fixture();
  expect(
    await createNativeProjectRepository(h.db, other.who).read(created.value.projectId, signal()),
  ).toEqual({ ok: false, error: "project_unavailable" });
  expect(
    await listNativeProjects(h.db, other.who, { filters: { schemaVersion: 1 } }, signal()),
  ).toMatchObject({ ok: true, value: { items: [] } });
  await h.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, f.who.sessionId));
  expect(await repository.read(created.value.projectId, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
});

test("regular creation needs the explicit grant and independently visible selected-owner anchors", async () => {
  const f = await fixture();
  const owner = await fixture();
  await h.db.update(users).set({ isAdmin: false }).where(eq(users.id, f.who.userId));
  await h.db.update(users).set({ isAdmin: false }).where(eq(users.id, owner.who.userId));
  const repository = createNativeProjectRepository(h.db, f.who);
  expect(await repository.create(f.input, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  const [set] = await h.db
    .insert(permissionSets)
    .values({ name: randomUUID(), flags: { "project.create": true } })
    .returning();
  if (!set) throw new TypeError("Missing permission fixture");
  await h.db.update(users).set({ permissionSetId: set.id }).where(eq(users.id, f.who.userId));
  await h.db
    .update(organizations)
    .set({ visibilityLevel: "owner" })
    .where(eq(organizations.id, f.input.orgId));
  expect(await repository.create({ ...f.input, ownerUserId: owner.who.userId }, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  await h.db
    .update(organizations)
    .set({ visibilityLevel: "all" })
    .where(eq(organizations.id, f.input.orgId));
  const created = await repository.create({ ...f.input, ownerUserId: owner.who.userId }, signal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(await projectWorkspace(h.db, f.who, created.value.projectId, signal())).toMatchObject({
    ok: true,
    value: { canStart: true, ownerLabel: "Project owner", contextLabel: "Synthetic studio" },
  });
  expect(
    await createNativeProjectRepository(h.db, owner.who).read(created.value.projectId, signal()),
  ).toMatchObject({ ok: true });
  expect(await enableNativeProjects(h.db, f.who, false, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
});

test("disposed receipt identity and expired sessions cannot authorize another write", async () => {
  const f = await fixture();
  const repository = createNativeProjectRepository(h.db, f.who);
  const created = await repository.create(f.input, signal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  await h.pool.query(
    "UPDATE agency_project_requests SET payload_state='disposed',private_payload=NULL,key_id=NULL WHERE actor_user_id=$1",
    [f.who.userId],
  );
  expect(await repository.create(f.input, signal())).toEqual({
    ok: false,
    error: "project_unavailable",
  });
  expect(
    (
      await h.pool.query("SELECT count(*)::int AS count FROM agency_projects WHERE id=$1", [
        created.value.projectId,
      ])
    ).rows,
  ).toEqual([{ count: 1 }]);
  await h.db
    .update(sessions)
    .set({ expiresAt: new Date(0) })
    .where(eq(sessions.id, f.who.sessionId));
  expect(
    await repository.start(
      { projectId: created.value.projectId, expectedRevision: 0, intentId: randomUUID() },
      signal(),
    ),
  ).toEqual({ ok: false, error: "project_unavailable" });
});
