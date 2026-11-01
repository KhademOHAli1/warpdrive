import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export function observePrivateReview<Value>(pending: Promise<Value>) {
  return pending.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

export async function heldPrivateReviewMutation(
  db: Db,
  mutate: (tx: DbOrTx) => Promise<void>,
  signal: AbortSignal,
) {
  let start: (pid: number) => void = () => {};
  let release: () => void = () => {};
  const ready = new Promise<number>((resolve) => {
    start = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = db.transaction(
    async (tx) => {
      const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      const pid = result.rows[0]?.pid;
      if (typeof pid !== "number")
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Private review barrier PID missing");
      await mutate(tx);
      signal.throwIfAborted();
      start(pid);
      await released;
      signal.throwIfAborted();
    },
    { isolationLevel: "read committed" },
  );
  const pid = await Promise.race([
    ready,
    pending.then(() => {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Private review barrier exited before release");
    }),
  ]);
  return { pid, release, pending };
}

export async function waitPrivateReviewBlockedBy(db: Db, holderPid: number, signal: AbortSignal) {
  let waitingPid = 0;
  await vi.waitFor(
    async () => {
      const result = await db.transaction(
        async (tx) => {
          await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
          return tx.execute(sql`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND state='active'
          AND ${holderPid}=ANY(pg_blocking_pids(pid))`);
        },
        { isolationLevel: "read committed" },
      );
      signal.throwIfAborted();
      expect(result.rows).toHaveLength(1);
      const pid = result.rows[0]?.pid;
      expect(typeof pid).toBe("number");
      if (typeof pid === "number") waitingPid = pid;
    },
    { timeout: 2000, interval: 10 },
  );
  return waitingPid;
}

export async function installPrivateReviewCommitBarrier(db: Db, signal: AbortSignal) {
  await db.execute(sql`CREATE FUNCTION private_review_test_barrier() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('private-intake-native-review-test',0));
      RETURN NEW;
    END $$`);
  await db.execute(sql`CREATE TRIGGER private_review_test_barrier BEFORE INSERT ON email_private_intake_reviews
    FOR EACH ROW EXECUTE FUNCTION private_review_test_barrier()`);
  signal.throwIfAborted();
}

export async function removePrivateReviewCommitBarrier(db: Db, signal: AbortSignal) {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS private_review_test_barrier ON email_private_intake_reviews`,
  );
  signal.throwIfAborted();
  await db.execute(sql`DROP FUNCTION IF EXISTS private_review_test_barrier()`);
  signal.throwIfAborted();
}
