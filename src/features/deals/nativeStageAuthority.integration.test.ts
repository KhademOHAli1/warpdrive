import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { deals, permissionSets } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { makeTestDb } from "@/test/db";
import { moveNativeDealStage, readNativeDealStage } from "./nativeStage";
import {
  expireSoon,
  nativeStageFixture,
  stageEffects,
  stageSignal,
  stageWaiter,
} from "./nativeStage.test-helpers";
import type { NativeStageMoveResult } from "./nativeStageTypes";

for (const waitOn of ["pipeline", "deal", "target"] as const) {
  test(`session expiration during an actual ${waitOn} row wait denies before move effects`, async () => {
    const h = await makeTestDb();
    let observer: PoolClient | undefined;
    let moving: Promise<NativeStageMoveResult> | undefined;
    try {
      const f = await nativeStageFixture(h, true),
        before = await stageEffects(h, f);
      observer = await h.pool.connect();
      await observer.query("BEGIN");
      const table = waitOn === "pipeline" ? "pipelines" : waitOn === "deal" ? "deals" : "stages";
      const id =
        waitOn === "pipeline" ? f.move.pipelineId : waitOn === "deal" ? f.deal.id : f.target.id;
      await observer.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      await expireSoon(h, f);
      moving = moveNativeDealStage(h.db, f.who, f.move, stageSignal());
      const pid = await stageWaiter(observer);
      await observer.query("SELECT pg_sleep(0.75)");
      await observer.query("COMMIT");
      expect(await moving).toEqual({ ok: false, reason: "denied", errorId: "E_AUTH_003" });
      expect(await stageEffects(h, f)).toEqual(before);
      expect(
        (
          await observer.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory'",
            [pid],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      if (observer) {
        await observer.query("ROLLBACK");
        observer.release();
      }
      if (moving) await Promise.allSettled([moving]);
      await h.close();
    }
  });
}

test("expiration while an effect waits rolls back the row, audit and channel, not an Err commit", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let moving: Promise<NativeStageMoveResult> | undefined;
  try {
    const f = await nativeStageFixture(h, true),
      before = await stageEffects(h, f);
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("SELECT channel FROM channel_versions WHERE channel=$1 FOR UPDATE", [
      `pipeline:${f.move.pipelineId}`,
    ]);
    await expireSoon(h, f);
    moving = moveNativeDealStage(h.db, f.who, f.move, stageSignal());
    await stageWaiter(observer);
    await observer.query("SELECT pg_sleep(0.75)");
    await observer.query("COMMIT");
    expect(await moving).toEqual({ ok: false, reason: "denied", errorId: "E_AUTH_003" });
    expect(await stageEffects(h, f)).toEqual(before);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (moving) await Promise.allSettled([moving]);
    await h.close();
  }
});

test("cooperating permission writer wins before shared authority admission; native move sees current flags", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let moving: Promise<NativeStageMoveResult> | undefined;
  try {
    const f = await nativeStageFixture(h),
      before = await stageEffects(h, f);
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query(
      "SELECT pg_advisory_xact_lock(hashtext('warpdrive-current-authority'),hashtext('actor-v1'))",
    );
    await observer.query("UPDATE permission_sets SET flags='{}' WHERE id=$1", [f.permissionSetId]);
    moving = moveNativeDealStage(h.db, f.who, f.move, stageSignal());
    await stageWaiter(observer);
    await observer.query("COMMIT");
    expect(await moving).toEqual({ ok: false, reason: "denied", errorId: "E_PERM_001" });
    expect(await stageEffects(h, f)).toEqual(before);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (moving) await Promise.allSettled([moving]);
    await h.close();
  }
});

test("pipeline archive committed during a real wait hides the deal before native mutation", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let moving: Promise<NativeStageMoveResult> | undefined;
  try {
    const f = await nativeStageFixture(h),
      before = await stageEffects(h, f);
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [f.move.pipelineId]);
    moving = moveNativeDealStage(h.db, f.who, f.move, stageSignal());
    await stageWaiter(observer);
    await observer.query("COMMIT");
    expect(await moving).toEqual({ ok: false, reason: "unavailable", errorId: "E_DEAL_001" });
    expect(await stageEffects(h, f)).toEqual(before);
    expect(await readNativeDealStage(h.db, f.who, f.read, stageSignal())).toEqual({
      ok: true,
      deal: null,
    });
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (moving) await Promise.allSettled([moving]);
    await h.close();
  }
});

test("aborted move rolls back and retires its locks; a future native move can use the row", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let moving: Promise<NativeStageMoveResult> | undefined;
  try {
    const f = await nativeStageFixture(h),
      before = await stageEffects(h, f);
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM deals WHERE id=$1 FOR UPDATE", [f.deal.id]);
    const abort = new AbortController();
    moving = moveNativeDealStage(h.db, f.who, f.move, abort.signal);
    const pid = await stageWaiter(observer);
    abort.abort();
    await observer.query("COMMIT");
    await expect(moving).rejects.toBeDefined();
    expect(await stageEffects(h, f)).toEqual(before);
    expect(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory'",
          [pid],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect((await moveNativeDealStage(h.db, f.who, f.move, stageSignal())).ok).toBe(true);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (moving) await Promise.allSettled([moving]);
    await h.close();
  }
});

test("unowned inherited transaction is rejected before acquiring a reversed authority fence", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h),
      before = await stageEffects(h, f);
    await expect(
      h.db.transaction(async (tx) => {
        await tx.select().from(deals).where(eq(deals.id, f.deal.id)).for("update");
        return moveNativeDealStage(tx, f.who, f.move, stageSignal());
      }),
    ).rejects.toMatchObject({ id: "E_DB_001" });
    expect(await stageEffects(h, f)).toEqual(before);
    await withCurrentAuthority(h.db, "write", stageSignal(), async (tx) => {
      await tx
        .update(permissionSets)
        .set({ flags: { "deal.edit_own": true } })
        .where(eq(permissionSets.id, f.permissionSetId));
      expect((await moveNativeDealStage(tx, f.who, f.move, stageSignal())).ok).toBe(true);
      const lock = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted`,
      );
      expect(lock.rows[0]?.n).toBeGreaterThan(0);
    });
  } finally {
    await h.close();
  }
});
