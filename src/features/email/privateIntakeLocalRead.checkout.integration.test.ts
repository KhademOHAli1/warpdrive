import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import {
  privateLocalReadFixture,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";
import { withPrivateIntakeLocalReadLocks } from "./privateIntakeLocalReadLock";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
  waitPrivateReviewBlockedBy,
} from "./privateIntakeReview.race.test-helpers";

it.each(["caller-abort", "deadline"] as const)(
  "reports pending-checkout uncertainty for %s and releases its eventual max-one-pool client",
  async (mode) => {
    await withTestDb(async (db) => {
      const origin: unknown = "$client" in db ? db.$client : undefined;
      expect(origin).toBeInstanceOf(Pool);
      if (!(origin instanceof Pool)) return;
      const pool = new Pool({ ...origin.options, max: 1, connectionTimeoutMillis: 3000 });
      const one = drizzle(pool, { schema });
      const action = new AbortController();
      let invoked = false;
      try {
        const pre = new AbortController();
        pre.abort();
        await expect(
          withPrivateIntakeLocalReadLocks(one, pre.signal, () => Promise.resolve()),
        ).rejects.toBe(pre.signal.reason);
        expect(pool.totalCount).toBe(0);
        expect(pool.waitingCount).toBe(0);
        const holder = await pool.connect();
        const pending = withPrivateIntakeLocalReadLocks(one, action.signal, () => {
          invoked = true;
          return Promise.resolve();
        });
        const observed = observePrivateReview(pending);
        let outcome: Awaited<typeof observed> | undefined;
        const completed = observed.then((value) => {
          outcome = value;
        });
        try {
          await vi.waitFor(() => expect(pool.waitingCount).toBe(1), { timeout: 1000 });
          if (mode === "caller-abort") action.abort();
          await vi.waitFor(() => expect(outcome).toBeDefined(), { timeout: 2000, interval: 10 });
          const settled = await observed;
          expect(settled).toMatchObject({
            status: "rejected",
            reason: { id: "E_DB_003", context: { phase: "checkout" } },
          });
          if (settled.status === "rejected") {
            const cause = Object.getOwnPropertyDescriptor(settled.reason, "cause");
            expect(cause?.enumerable).toBe(false);
            if (mode === "caller-abort") expect(cause?.value).toBe(action.signal.reason);
            else expect(cause?.value).toMatchObject({ name: "TimeoutError" });
          }
          expect(action.signal.aborted).toBe(mode === "caller-abort");
          expect(invoked).toBe(false);
          expect(pool.waitingCount).toBe(1);
        } finally {
          holder.release();
          await completed;
        }
        await vi.waitFor(
          () => {
            expect(pool.waitingCount).toBe(0);
            expect(pool.idleCount).toBe(pool.totalCount);
          },
          { timeout: 1000 },
        );
        expect(invoked).toBe(false);
        expect((await pool.query<{ usable: number }>("SELECT 1 AS usable")).rows).toEqual([
          { usable: 1 },
        ]);
      } finally {
        await pool.end();
      }
    });
  },
);

it("reports observer-checkout uncertainty when a max-one-pool FIFO borrower prevents cleanup proof", async () => {
  await withTestDb(async (db) => {
    const origin: unknown = "$client" in db ? db.$client : undefined;
    expect(origin).toBeInstanceOf(Pool);
    if (!(origin instanceof Pool)) return;
    const pool = new Pool({ ...origin.options, max: 1, connectionTimeoutMillis: 3000 });
    const one = drizzle(pool, { schema });
    const signal = AbortSignal.timeout(5000);
    try {
      const holder = await heldPrivateReviewMutation(
        db,
        async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(19831104)`);
        },
        signal,
      );
      const action = new AbortController();
      const pending = withPrivateIntakeLocalReadLocks(one, action.signal, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19831104)`);
      });
      const observed = observePrivateReview(pending);
      const borrower: { client?: PoolClient } = {};
      let releasing = false;
      let queued: Promise<void> | undefined;
      try {
        await waitPrivateReviewBlockedBy(db, holder.pid, signal);
        queued = pool.connect().then((client) => {
          if (releasing) client.release();
          else borrower.client = client;
        });
        await vi.waitFor(() => expect(pool.waitingCount).toBe(1), { timeout: 1000 });
        action.abort();
        await vi.waitFor(() => expect(borrower.client).toBeDefined(), { timeout: 1000 });
        const outcome = await observed;
        expect(outcome).toMatchObject({
          status: "rejected",
          reason: { id: "E_DB_003", context: { phase: "observer-checkout" } },
        });
        if (outcome.status === "rejected") {
          const descriptor = Object.getOwnPropertyDescriptor(outcome.reason, "cause");
          expect(descriptor?.enumerable).toBe(false);
          const cause: unknown = descriptor?.value;
          expect(cause).toBeInstanceOf(AggregateError);
          if (cause instanceof AggregateError) {
            expect(cause.errors).toContain(action.signal.reason);
            expect(
              cause.errors.some(
                (error: unknown) => error !== action.signal.reason && error instanceof Error,
              ),
            ).toBe(true);
          }
        }
      } finally {
        releasing = true;
        borrower.client?.release();
        holder.release();
        await Promise.allSettled([holder.pending, observed, queued]);
      }
      await vi.waitFor(
        () => {
          expect(pool.waitingCount).toBe(0);
          expect(pool.idleCount).toBe(pool.totalCount);
        },
        { timeout: 1000 },
      );
      expect((await pool.query<{ usable: number }>("SELECT 1 AS usable")).rows).toEqual([
        { usable: 1 },
      ]);
    } finally {
      await pool.end();
    }
  });
});

it("does not relabel committed marker work when abort arrives during normal client release", async () => {
  await withTestDb(async (db) => {
    const origin: unknown = "$client" in db ? db.$client : undefined;
    expect(origin).toBeInstanceOf(Pool);
    if (!(origin instanceof Pool)) return;
    const f = await privateLocalReadFixture(db);
    const action = new AbortController();
    const abortAfterCommit = () => action.abort();
    origin.once("release", abortAfterCommit);
    try {
      const value = await withPrivateIntakeLocalReadLocks(db, action.signal, async (tx) => {
        await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
          SELECT id,${f.owner.id},GREATEST(clock_timestamp(),last_message_at)
          FROM email_threads WHERE id=${f.threadId}`);
        return "committed";
      });
      expect(action.signal.aborted).toBe(true);
      expect(value).toBe("committed");
      expect(await privateLocalReadRows(db, f)).toHaveLength(1);
    } finally {
      origin.off("release", abortAfterCommit);
      await f.close();
    }
  });
});
