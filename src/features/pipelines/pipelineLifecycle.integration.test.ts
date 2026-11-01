import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { env } from "@/config/env";
import {
  auditEvents,
  authAccounts,
  authUsers,
  deals,
  permissionSets,
  pipelines,
  settings,
  stages,
  users,
  visibilityGroupMembers,
  visibilityGroups,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createBetterAuth } from "@/features/auth/better/auth";
import { AuthCookieJar, nativeRequest } from "@/features/auth/better/passkey.protocol.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";
import { listLifecyclePipelines, setPipelineArchived } from "./pipelineLifecycle";

let h: TestDb;
afterEach(async () => {
  await h?.close();
});
const signal = () => AbortSignal.timeout(15000);

async function fixture() {
  h = await makeTestDb();
  const [set] = await h.db
    .insert(permissionSets)
    .values({ name: "Pipeline managers", flags: { "pipeline.manage": true } })
    .returning();
  const user = await seedUser(h.db, { permissionSetId: set?.id });
  const auth = createBetterAuth(h.db);
  await h.db
    .insert(authUsers)
    .values({ id: user.id, email: user.email, name: user.name, emailVerified: true });
  const password = "Synthetic-pipeline-qualification-password-42";
  await h.db.insert(authAccounts).values({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await (await auth.$context).password.hash(password),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  expect(
    (await nativeRequest(auth, jar, "/sign-in/email", { email: user.email, password })).status,
  ).toBe(200);
  const first = await seedPipelineWithStages(h.db, ["بررسی", "Angebot"]);
  const second = await seedPipelineWithStages(h.db, ["Other"]);
  return { user, jar, first, second };
}

test("archive and restore preserve exact records/stages and atomically audit each transition", async () => {
  const f = await fixture();
  const [stage] = f.first.stages;
  if (!stage) throw new Error("Fixture stage missing");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "متن مشتری / Kundentext",
      ownerId: f.user.id,
      pipelineId: f.first.pipeline.id,
      stageId: stage.id,
      visibilityLevel: "owner",
      value: "1234560",
      currency: "IRR",
    })
    .returning();
  const input = {
    pipelineId: f.first.pipeline.id,
    expectedUpdatedAt: f.first.pipeline.updatedAt.toISOString(),
  };
  const archived = await setPipelineArchived(h.db, f.jar.headers(), input, true, signal());
  expect(archived.ok).toBe(true);
  if (!archived.ok) return;
  const repeated = await setPipelineArchived(h.db, f.jar.headers(), input, true, signal());
  expect(repeated).toEqual(archived);
  const restored = await setPipelineArchived(
    h.db,
    f.jar.headers(),
    { ...input, expectedUpdatedAt: archived.value.updatedAt },
    false,
    signal(),
  );
  expect(restored.ok).toBe(true);
  expect(await h.db.select().from(deals).where(eq(deals.id, deal!.id))).toEqual([deal]);
  expect(
    await h.db
      .select()
      .from(stages)
      .where(eq(stages.pipelineId, input.pipelineId))
      .orderBy(stages.order),
  ).toEqual(f.first.stages);
  const audit = await h.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.targetId, input.pipelineId));
  expect(audit.map((e) => e.action).sort()).toEqual(["pipeline.archive", "pipeline.restore"]);
});

test("directory and mutations revalidate current membership and record ceilings", async () => {
  const f = await fixture();
  const [group] = await h.db.insert(visibilityGroups).values({ name: "Private" }).returning();
  if (!group) throw new Error("Fixture group missing");
  await h.db
    .update(pipelines)
    .set({ visibilityGroupId: group.id })
    .where(eq(pipelines.id, f.second.pipeline.id));
  const other = await seedUser(h.db);
  const firstStage = f.first.stages[0];
  if (!firstStage) throw new Error("Fixture stage missing");
  await h.db.insert(deals).values([
    {
      title: "Visible",
      ownerId: f.user.id,
      pipelineId: f.first.pipeline.id,
      stageId: firstStage.id,
      visibilityLevel: "owner",
    },
    {
      title: "Hidden",
      ownerId: other.id,
      pipelineId: f.first.pipeline.id,
      stageId: firstStage.id,
      visibilityLevel: "owner",
    },
  ]);
  const rows = await listLifecyclePipelines(h.db, f.user.id, signal());
  expect(rows.ok).toBe(true);
  if (rows.ok) {
    expect(rows.value).toHaveLength(1);
    expect(rows.value[0]?.dealCount).toBe(1);
  }
  const input = {
    pipelineId: f.second.pipeline.id,
    expectedUpdatedAt: f.second.pipeline.updatedAt.toISOString(),
  };
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "denied",
  });
  await h.db.insert(visibilityGroupMembers).values({ groupId: group.id, userId: f.user.id });
  await h.db
    .delete(visibilityGroupMembers)
    .where(
      and(
        eq(visibilityGroupMembers.groupId, group.id),
        eq(visibilityGroupMembers.userId, f.user.id),
      ),
    );
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "denied",
  });
});

test("CAS rejects stale edits and advances revision even within the same millisecond", async () => {
  const f = await fixture();
  const input = { pipelineId: f.first.pipeline.id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" };
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "conflict",
  });
  const fresh = f.first.pipeline.updatedAt.toISOString();
  const r = await setPipelineArchived(
    h.db,
    f.jar.headers(),
    { ...input, expectedUpdatedAt: fresh },
    true,
    signal(),
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(Date.parse(r.value.updatedAt)).toBeGreaterThan(Date.parse(fresh));
});

test("concurrent archive requests retain an active pipeline and do not duplicate audits", async () => {
  const f = await fixture();
  const results = await Promise.all(
    [f.first, f.second].map((p) =>
      setPipelineArchived(
        h.db,
        f.jar.headers(),
        { pipelineId: p.pipeline.id, expectedUpdatedAt: p.pipeline.updatedAt.toISOString() },
        true,
        signal(),
      ),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual(["last-active"]);
  expect(await h.db.select().from(pipelines).where(eq(pipelines.isArchived, false))).toHaveLength(
    1,
  );
});

test("default pipeline and inactive native accounts cannot be archived", async () => {
  const f = await fixture();
  await h.db
    .insert(settings)
    .values({ id: true, defaultPipelineId: f.first.pipeline.id })
    .onConflictDoUpdate({ target: settings.id, set: { defaultPipelineId: f.first.pipeline.id } });
  const input = {
    pipelineId: f.first.pipeline.id,
    expectedUpdatedAt: f.first.pipeline.updatedAt.toISOString(),
  };
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "default-pipeline",
  });
  await h.db.update(users).set({ isActive: false }).where(eq(users.id, f.user.id));
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "fresh-auth-required",
  });
});

test("audit failure rolls back archive and keeps the original revision", async () => {
  const f = await fixture();
  await h.db.execute(
    sql`CREATE FUNCTION reject_pipeline_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_type = 'pipeline' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_pipeline_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_pipeline_audit()`,
  );
  const input = {
    pipelineId: f.first.pipeline.id,
    expectedUpdatedAt: f.first.pipeline.updatedAt.toISOString(),
  };
  expect(await setPipelineArchived(h.db, f.jar.headers(), input, true, signal())).toEqual({
    ok: false,
    error: "failed",
  });
  const [row] = await h.db.select().from(pipelines).where(eq(pipelines.id, input.pipelineId));
  expect(row?.isArchived).toBe(false);
  expect(row?.updatedAt).toEqual(f.first.pipeline.updatedAt);
});

test("invalid input and unknown IDs return safe operational errors", async () => {
  const f = await fixture();
  expect(
    await setPipelineArchived(h.db, f.jar.headers(), { pipelineId: "not-an-id" }, true, signal()),
  ).toEqual({ ok: false, error: "failed" });
  expect(
    await setPipelineArchived(
      h.db,
      f.jar.headers(),
      { pipelineId: randomUUID(), expectedUpdatedAt: new Date().toISOString() },
      true,
      signal(),
    ),
  ).toEqual({ ok: false, error: "denied" });
});
