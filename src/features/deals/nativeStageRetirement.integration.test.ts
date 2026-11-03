import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { makeTestDb } from "@/test/db";
import { moveNativeDealStage, readNativeDealStage } from "./nativeStage";
import {
  expireSoon,
  nativeStageFixture,
  stageEffects,
  stageSignal,
  stageWaiter,
} from "./nativeStage.test-helpers";
import type { NativeStageMoveResult, NativeStageReadResult } from "./nativeStageTypes";

test("held authority fence fails within its SQL lock bound, retires transaction locks and remains usable", async () => {
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
    const start = Date.now();
    moving = moveNativeDealStage(h.db, f.who, f.move, stageSignal());
    // Attach settlement immediately; the original rejection is still asserted below.
    void moving.catch(() => {});
    const pid = await stageWaiter(observer);
    await expect(moving).rejects.toMatchObject({ cause: { code: "55P03" } });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(await stageEffects(h, f)).toEqual(before);
    expect(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory'",
          [pid],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    await observer.query("SELECT pg_stat_clear_snapshot()");
    expect(
      (await observer.query("SELECT state,xact_start FROM pg_stat_activity WHERE pid=$1", [pid]))
        .rows,
    ).toEqual([{ state: "idle", xact_start: null }]);
    await observer.query("COMMIT");
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

test("read-only recovery revalidates session after actual row wait without exposing current stage", async () => {
  const h = await makeTestDb();
  let observer: PoolClient | undefined;
  let reading: Promise<NativeStageReadResult> | undefined;
  try {
    const f = await nativeStageFixture(h, true),
      before = await stageEffects(h, f);
    observer = await h.pool.connect();
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM deals WHERE id=$1 FOR UPDATE", [f.deal.id]);
    await expireSoon(h, f);
    reading = readNativeDealStage(h.db, f.who, f.read, stageSignal());
    await stageWaiter(observer);
    await observer.query("SELECT pg_sleep(0.75)");
    await observer.query("COMMIT");
    expect(await reading).toEqual({ ok: false, reason: "denied", errorId: "E_AUTH_003" });
    expect(await stageEffects(h, f)).toEqual(before);
  } finally {
    if (observer) {
      await observer.query("ROLLBACK");
      observer.release();
    }
    if (reading) await Promise.allSettled([reading]);
    await h.close();
  }
});
