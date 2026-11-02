import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import {
  auditEvents,
  permissionSets,
  pipelines,
  sessions,
  visibilityGroupMembers,
} from "@/db/schema";
import { nativeRequest } from "@/features/auth/better/passkey.protocol.test-helpers";
import type { TestDb } from "@/test/db";
import { renamePipeline } from "./pipelineActions";
import {
  authoritySignal,
  lifecycleAuthorityFixture,
} from "./pipelineLifecycleAuthority.test-helpers";

let h: TestDb | undefined;
afterEach(async () => {
  await h?.close();
});
async function fixture() {
  const f = await lifecycleAuthorityFixture();
  h = f.h;
  return { ...f, rename: { ...f.input, name: "فروش / Vertrieb" } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function unchanged(f: Fixture) {
  expect(await f.h.db.select().from(pipelines).where(eq(pipelines.id, f.input.pipelineId))).toEqual(
    [f.target.pipeline],
  );
  expect(
    await f.h.db.select().from(auditEvents).where(eq(auditEvents.targetId, f.input.pipelineId)),
  ).toEqual([]);
}
async function queued(f: Fixture, mutate: () => Promise<void>) {
  const blocker = await f.h.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext('warpdrive:pipeline-lifecycle'))");
  const command = renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal());
  try {
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await f.h.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting",
      );
      if (rows.rows[0]?.waiting === true) {
        waiting = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await mutate();
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await command;
  }
  return command;
}

test("native scoped manager rename preserves authored text, advances CAS and audits once", async () => {
  const f = await fixture();
  const renamed = await renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal());
  expect(renamed.ok).toBe(true);
  if (!renamed.ok) return;
  expect(renamed.value.name).toBe(f.rename.name);
  expect(renamed.value.updatedAt.getTime()).toBeGreaterThan(f.target.pipeline.updatedAt.getTime());
  const repeated = await renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal());
  expect(repeated).toEqual(renamed);
  const audit = await f.h.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.targetId, f.input.pipelineId));
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actorId: f.user.id,
    action: "pipeline.rename",
    before: { name: f.target.pipeline.name },
    after: { name: f.rename.name },
  });
});

test("stale rename conflicts, including competing concurrent names", async () => {
  const f = await fixture();
  const stale = await renamePipeline(
    f.h.db,
    f.jar.headers(),
    { ...f.rename, expectedUpdatedAt: "2000-01-01T00:00:00Z" },
    authoritySignal(),
  );
  expect(stale).toMatchObject({ ok: false, error: { id: "E_PIPELINE_002" } });
  await unchanged(f);
  const results = await Promise.all(
    ["اول", "Zweite"].map((name) =>
      renamePipeline(f.h.db, f.jar.headers(), { ...f.rename, name }, authoritySignal()),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toMatchObject([
    { ok: false, error: { id: "E_PIPELINE_002" } },
  ]);
});

test("missing, restricted and archived source names are indistinguishably denied", async () => {
  const f = await fixture();
  await f.h.db.delete(visibilityGroupMembers).where(eq(visibilityGroupMembers.userId, f.user.id));
  const hidden = await renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal());
  const missing = await renamePipeline(
    f.h.db,
    f.jar.headers(),
    { ...f.rename, pipelineId: randomUUID() },
    authoritySignal(),
  );
  expect(hidden).toMatchObject({ ok: false, error: { id: "E_PIPELINE_001" } });
  expect(missing).toEqual(hidden);
  await f.h.db.insert(visibilityGroupMembers).values({ userId: f.user.id, groupId: f.group.id });
  await f.h.db
    .update(pipelines)
    .set({ isArchived: true })
    .where(eq(pipelines.id, f.input.pipelineId));
  expect(await renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal())).toEqual(
    hidden,
  );
  expect(await f.h.db.select().from(auditEvents)).toEqual([]);
});

test("audit failure rolls back the name and timestamp", async () => {
  const f = await fixture();
  await f.h.db.execute(
    sql`create function reject_rename_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic rejection'; end $$`,
  );
  await f.h.db.execute(
    sql`create trigger reject_rename_audit before insert on audit_events for each row execute function reject_rename_audit()`,
  );
  expect(await renamePipeline(f.h.db, f.jar.headers(), f.rename, authoritySignal())).toMatchObject({
    ok: false,
    error: { id: "E_DB_003" },
  });
  await unchanged(f);
});

test("queued rename cannot outlive native sign-out", async () => {
  const f = await fixture();
  expect(
    await queued(f, async () => {
      expect((await nativeRequest(f.auth, f.jar, "/sign-out", {})).status).toBe(200);
    }),
  ).toMatchObject({ ok: false, error: { id: "E_PIPELINE_003" } });
  await unchanged(f);
});

test("queued rename rechecks current capability and group membership", async () => {
  const f = await fixture();
  expect(
    await queued(f, async () => {
      await f.h.db
        .update(permissionSets)
        .set({ flags: {} })
        .where(eq(permissionSets.id, f.permissionSet.id));
    }),
  ).toMatchObject({ ok: false, error: { id: "E_PIPELINE_001" } });
  await unchanged(f);
  await f.h.db
    .update(permissionSets)
    .set({ flags: { "pipeline.manage": true } })
    .where(eq(permissionSets.id, f.permissionSet.id));
  expect(
    await queued(f, async () => {
      await f.h.db
        .delete(visibilityGroupMembers)
        .where(
          and(
            eq(visibilityGroupMembers.userId, f.user.id),
            eq(visibilityGroupMembers.groupId, f.group.id),
          ),
        );
    }),
  ).toMatchObject({ ok: false, error: { id: "E_PIPELINE_001" } });
  await unchanged(f);
});

test("queued rename requires still-fresh native proof", async () => {
  const f = await fixture();
  expect(
    await queued(f, async () => {
      await f.h.db
        .update(sessions)
        .set({
          freshAuthenticatedAt: new Date(Date.now() - (f.native.policy.freshMinutes + 1) * 60000),
        })
        .where(eq(sessions.id, f.native.session.id));
    }),
  ).toMatchObject({ ok: false, error: { id: "E_PIPELINE_003" } });
  await unchanged(f);
});

test("strict rename boundary rejects client-injected actor authority", async () => {
  const f = await fixture();
  expect(
    await renamePipeline(
      f.h.db,
      f.jar.headers(),
      { ...f.rename, actor: { type: "admin" } },
      authoritySignal(),
    ),
  ).toMatchObject({ ok: false, error: { id: "E_PIPELINE_004" } });
  await unchanged(f);
});
