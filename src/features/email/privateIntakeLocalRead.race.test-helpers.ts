import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import type { Db } from "@/db/client";
import { observePrivateReview } from "./privateIntakeReview.race.test-helpers";

export async function installPrivateLocalReadBarrier(db: Db, signal: AbortSignal) {
  await db.execute(sql`CREATE FUNCTION private_local_read_test_barrier() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('private-intake-local-read-test',0));
      RETURN NEW;
    END $$`);
  await db.execute(sql`CREATE TRIGGER private_local_read_test_barrier BEFORE INSERT ON email_thread_reads
    FOR EACH ROW EXECUTE FUNCTION private_local_read_test_barrier()`);
  signal.throwIfAborted();
}

export async function removePrivateLocalReadBarrier(db: Db, signal: AbortSignal) {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS private_local_read_test_barrier ON email_thread_reads`,
  );
  signal.throwIfAborted();
  await db.execute(sql`DROP FUNCTION IF EXISTS private_local_read_test_barrier()`);
  signal.throwIfAborted();
}

// An early action denial is returned to the test as the actual semantic RED,
// rather than disguising it as a missing-lock timeout. The observer is always drained.
export async function waitPrivateLocalReadBarrier(
  db: Db,
  holderPid: number,
  completed: Promise<unknown>,
  signal: AbortSignal,
) {
  let stopped = false;
  const isStopped = () => stopped;
  let pid = 0;
  const waiting = observePrivateReview(
    vi.waitFor(
      async () => {
        if (isStopped()) return;
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
        if (isStopped()) return;
        expect(result.rows).toHaveLength(1);
        const found = result.rows[0]?.pid;
        expect(typeof found).toBe("number");
        if (typeof found === "number") pid = found;
      },
      { timeout: 2000, interval: 10 },
    ),
  );
  try {
    return await Promise.race([
      waiting.then((outcome) => {
        if (outcome.status === "rejected") throw outcome.reason;
        return { kind: "blocked" as const, pid };
      }),
      completed.then((outcome) => ({ kind: "completed" as const, outcome })),
    ]);
  } finally {
    stopped = true;
    await waiting;
  }
}
