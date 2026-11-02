import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals } from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor } from "@/features/auth/currentNativeActor";
import { makeTestDb } from "@/test/db";
import { getBoardColumns } from "./dealRepo";
import { createNativeDeal, readNativeDealCreation } from "./nativeCreate";
import { creationEffects, creationFixture, creationSignal } from "./nativeCreate.test-helpers";
import type { NativeDealCreateResult } from "./nativeCreateTypes";

function created(result: NativeDealCreateResult) {
  expect(result).toMatchObject({ ok: true, deal: { id: expect.any(String) } });
  if (!result.ok || result.deal === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing authorized created result");
  return result.deal;
}
async function rowWaiter(observer: PoolClient) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    // pg_stat_activity is cached inside this observer's transaction. Read the live
    // lock manager and prove that this exact lock-holding backend blocks the replay.
    const waiting = await observer.query<{ pid: number; observer_pid: number; blockers: number[] }>(
      "SELECT DISTINCT l.pid, pg_backend_pid() AS observer_pid, pg_blocking_pids(l.pid) AS blockers FROM pg_locks l WHERE l.pid<>pg_backend_pid() AND NOT l.granted AND pg_backend_pid()=ANY(pg_blocking_pids(l.pid))",
    );
    const waiter = waiting.rows[0];
    if (waiter) {
      expect(waiter.blockers).toContain(waiter.observer_pid);
      return waiter.pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new AppError(ERROR_IDS.DB_INVARIANT, "No actual result-row waiter");
}

test("hard deletion while replay waits on its deal has no receipt/deal lock inversion and retains tombstone", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let replay: Promise<NativeDealCreateResult> | undefined;
  try {
    const f = await creationFixture(h),
      first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    observer = await h.pool.connect();
    await observer.query(
      "BEGIN; SET LOCAL statement_timeout='1500ms'; SET LOCAL lock_timeout='1500ms'",
    );
    await observer.query("SELECT id FROM deals WHERE id=$1 FOR UPDATE", [first.id]);
    replay = createNativeDeal(h.db, f.who, f.input, creationSignal());
    await rowWaiter(observer);
    // A receipt-first replay lock would invert this real FK SET NULL update against its held deal.
    await observer.query("DELETE FROM deals WHERE id=$1", [first.id]);
    await observer.query("COMMIT");
    expect(await replay).toEqual({ ok: true, deal: null, replayed: true });
    expect(
      (
        await h.pool.query<{ deal_id: string | null }>(
          "SELECT deal_id FROM deal_create_operations WHERE actor_id=$1",
          [f.user.id],
        )
      ).rows,
    ).toEqual([{ deal_id: null }]);
    expect((await creationEffects(h, f))?.receipts).toBe(1);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (replay) await Promise.allSettled([replay]);
    await h.close();
  }
});

test("a pipeline archived during replay wait returns unavailable without recreating a deal", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let replay: Promise<NativeDealCreateResult> | undefined;
  try {
    const f = await creationFixture(h);
    created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [
      f.pipeline.pipeline.id,
    ]);
    replay = createNativeDeal(h.db, f.who, f.input, creationSignal());
    await rowWaiter(observer);
    await observer.query("COMMIT");
    expect(await replay).toEqual({ ok: true, deal: null, replayed: true });
    expect(await creationEffects(h, f)).toEqual({
      deals: 1,
      receipts: 1,
      links: 1,
      labels: 1,
      channel: 1,
    });
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (replay) await Promise.allSettled([replay]);
    await h.close();
  }
});

test("hard-delete tombstone never reattaches an independently restored UUID after a pipeline-lock wait", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let replay: Promise<NativeDealCreateResult> | undefined;
  try {
    const f = await creationFixture(h),
      first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM pipelines WHERE id=$1 FOR UPDATE", [
      f.pipeline.pipeline.id,
    ]);
    replay = createNativeDeal(h.db, f.who, f.input, creationSignal());
    await rowWaiter(observer);
    await observer.query("DELETE FROM deals WHERE id=$1", [first.id]);
    await observer.query(
      "INSERT INTO deals(id,title,owner_id,pipeline_id,stage_id,visibility_level,value,currency) VALUES($1,'Independent restored row',$2,$3,$4,'owner',1.0001,'USD')",
      [first.id, f.user.id, f.pipeline.pipeline.id, f.stage.id],
    );
    await observer.query("COMMIT");
    expect(await replay).toEqual({ ok: true, deal: null, replayed: true });
    expect(
      (
        await h.pool.query<{ deal_id: string | null }>(
          "SELECT deal_id FROM deal_create_operations WHERE actor_id=$1",
          [f.user.id],
        )
      ).rows,
    ).toEqual([{ deal_id: null }]);
    expect(
      (await h.pool.query<{ title: string }>("SELECT title FROM deals WHERE id=$1", [first.id]))
        .rows,
    ).toEqual([{ title: "Independent restored row" }]);
    expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toEqual({
      ok: true,
      deal: null,
      replayed: true,
    });
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (replay) await Promise.allSettled([replay]);
    await h.close();
  }
});

test("pipeline change during result-row wait rejects the stale hint and a later retry reads the same current deal", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let replay: Promise<NativeDealCreateResult> | undefined;
  try {
    const f = await creationFixture(h),
      first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    const moved = await seedPipelineWithStages(h.db, ["Elsewhere"]),
      nextStage = moved.stages[0];
    if (!nextStage) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing move stage");
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM deals WHERE id=$1 FOR UPDATE", [first.id]);
    replay = createNativeDeal(h.db, f.who, f.input, creationSignal());
    await rowWaiter(observer);
    await observer.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
      first.id,
      moved.pipeline.id,
      nextStage.id,
    ]);
    await observer.query("COMMIT");
    expect(await replay).toMatchObject({
      ok: false,
      error: { id: "E_DEAL_002" },
      outcome: "unresolved",
    });
    expect(created(await createNativeDeal(h.db, f.who, f.input, creationSignal())).id).toBe(
      first.id,
    );
    expect((await creationEffects(h, f))?.deals).toBe(1);
    expect((await creationEffects(h, f))?.receipts).toBe(1);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (replay) await Promise.allSettled([replay]);
    await h.close();
  }
});

test("authoritative board snapshot pairs current revision with masked linked contacts", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h),
      first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    const other = await creationFixture(h);
    const person = (
      await h.pool.query<{ id: string }>(
        "INSERT INTO persons(name,owner_id,visibility_level) VALUES('Hidden qualification contact',$1,'owner') RETURNING id",
        [other.user.id],
      )
    ).rows[0];
    if (!person) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing hidden contact");
    const [changed] = await h.db
      .update(deals)
      .set({ personId: person.id })
      .where(eq(deals.id, first.id))
      .returning({ writeVersion: deals.writeVersion, updatedAt: deals.updatedAt });
    if (!changed) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing changed result");
    const current = await withCurrentAuthority(h.db, "read", creationSignal(), (tx) =>
      currentNativeActor(tx, f.who, creationSignal()),
    );
    if (!current) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing authenticated read actor");
    const board = await getBoardColumns(
      h.db,
      {
        userId: current.actor.id,
        isActive: current.actor.isActive,
        sessionLive: true,
        isAdmin: current.actor.type === "admin",
        visibilityGroupIds: [...current.actor.groupIds],
        managedUserIds: [...(current.actor.managedUserIds ?? [])],
      },
      f.pipeline.pipeline.id,
      creationSignal(),
    );
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({
      id: first.id,
      writeVersion: changed.writeVersion,
      updatedAt: changed.updatedAt,
      personId: null,
      personName: null,
    });
    expect(changed.writeVersion).not.toBe(first.writeVersion);
  } finally {
    await h.close();
  }
});

test("result hard-delete keeps actor receipt and its explicit account-erasure restriction", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h),
      first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
    await h.pool.query("DELETE FROM deals WHERE id=$1;", [first.id]);
    await h.pool.query("DELETE FROM sessions WHERE user_id=$1", [f.user.id]);
    const fk = (
      await h.pool.query<{ conname: string; confdeltype: string }>(
        "SELECT conname,confdeltype FROM pg_constraint WHERE conrelid='deal_create_operations'::regclass AND confrelid='users'::regclass",
      )
    ).rows;
    expect(fk).toHaveLength(1);
    expect(fk[0]?.confdeltype).toBe("r");
    await expect(h.pool.query("DELETE FROM users WHERE id=$1", [f.user.id])).rejects.toMatchObject({
      code: "23503",
      constraint: fk[0]?.conname,
    });
    expect((await creationEffects(h, f))?.receipts).toBe(1);
  } finally {
    await h.close();
  }
});

test.each(["won", "moved", "hidden", "deleted"] as const)(
  "read-only known-created recovery resolves current %s state without creating",
  async (kind) => {
    const h = await makeTestDb();
    try {
      const f = await creationFixture(h),
        first = created(await createNativeDeal(h.db, f.who, f.input, creationSignal()));
      if (kind === "won")
        await h.db
          .update(deals)
          .set({ status: "won", wonTime: new Date() })
          .where(eq(deals.id, first.id));
      if (kind === "moved") {
        const target = await seedPipelineWithStages(h.db, ["Other"]),
          stage = target.stages[0];
        if (!stage) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing recovery stage");
        await h.db
          .update(deals)
          .set({ pipelineId: target.pipeline.id, stageId: stage.id })
          .where(eq(deals.id, first.id));
      }
      if (kind === "hidden") {
        const other = await creationFixture(h);
        await h.db
          .update(deals)
          .set({ ownerId: other.user.id, visibilityLevel: "owner" })
          .where(eq(deals.id, first.id));
      }
      if (kind === "deleted") await h.db.delete(deals).where(eq(deals.id, first.id));
      const result = await readNativeDealCreation(h.db, f.who, f.input, creationSignal());
      if (kind === "hidden" || kind === "deleted")
        expect(result).toEqual({ ok: true, deal: null, replayed: true });
      else {
        const current = created(result);
        expect(current.id).toBe(first.id);
        const [row] = await h.db
          .select({ writeVersion: deals.writeVersion, updatedAt: deals.updatedAt })
          .from(deals)
          .where(eq(deals.id, first.id));
        expect(current).toMatchObject({
          writeVersion: row?.writeVersion,
          updatedAt: row?.updatedAt.toISOString(),
        });
      }
      const effects = await creationEffects(h, f);
      expect(effects?.receipts).toBe(1);
      expect(effects?.channel).toBe(1);
      expect(effects?.deals).toBe(kind === "deleted" ? 0 : 1);
    } finally {
      await h.close();
    }
  },
);

test("read-only recovery for a missing receipt never falls through to creation", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    expect(await readNativeDealCreation(h.db, f.who, f.input, creationSignal())).toMatchObject({
      ok: false,
      error: { id: "E_DEAL_001" },
    });
    expect(await creationEffects(h, f)).toEqual({
      deals: 0,
      receipts: 0,
      links: 0,
      labels: 0,
      channel: 0,
    });
  } finally {
    await h.close();
  }
});
