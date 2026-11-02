import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import {
  privateLocalReadFixture,
  privateLocalReadMailbox,
  privateLocalReadRemote,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";
import { withPrivateIntakeLocalReadLocks } from "./privateIntakeLocalReadLock";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
  waitPrivateReviewBlockedBy,
} from "./privateIntakeReview.race.test-helpers";
import { markThreadRead, markThreadUnread } from "./readState";

const CANCEL_SETTLEMENT_MS = 1000;
const LOCK_TARGETS = ["reader", "account", "thread", "intake", "marker"] as const;
const LOCK_TABLES = {
  reader: "users",
  account: "email_accounts",
  thread: "email_threads",
  intake: "email_private_intake",
  marker: "email_thread_reads",
};

async function waitForLocalReadLock(
  db: Db,
  holder: number,
  target: (typeof LOCK_TARGETS)[number],
  signal: AbortSignal,
) {
  let pid = 0;
  await vi.waitFor(
    async () => {
      const waiting = await db.execute<{ pid: number }>(sql`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'
        AND wait_event_type='Lock' AND ${holder}=ANY(pg_blocking_pids(pid))
        AND query ILIKE ${`%${LOCK_TABLES[target]}%`}
        AND (${target === "marker"}
          OR query ILIKE '%for share%')`);
      signal.throwIfAborted();
      expect(waiting.rows).toHaveLength(1);
      expect(waiting.rows[0]?.pid).toEqual(expect.any(Number));
      pid = waiting.rows[0]?.pid ?? 0;
    },
    { timeout: 2000, interval: 10 },
  );
  return pid;
}

type Settlement<Value> = { kind: "settled"; value: Value } | { kind: "deadline" };

async function settleBeforeRelease<Value>(
  pending: Promise<Value>,
  signal: AbortSignal,
): Promise<Settlement<Value>> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ kind: "deadline" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "deadline" }), CANCEL_SETTLEMENT_MS);
  });
  try {
    const result = await Promise.race([
      pending.then((value) => ({ kind: "settled" as const, value })),
      deadline,
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

it.each(
  LOCK_TARGETS.flatMap((target) =>
    (["read", "unread"] as const).map((direction) => ({ target, direction })),
  ),
)(
  "settles an aborted private-intake local $direction while the $target row stays locked",
  async ({ target, direction }) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        // The fixture/oracle signal stays live after the action is cancelled.
        const signal = f.args.signal;
        const args = { actor: f.actor, threadId: f.threadId };
        const deps = { loadConnection: f.loadConnection };
        if (direction === "unread" || target === "marker")
          expect(await markThreadRead(db, args, signal, deps)).toEqual(
            ok({ threadId: f.threadId }),
          );
        const beforeReads = await privateLocalReadRows(db, f);
        const beforeMailbox = await privateLocalReadMailbox(db, f);
        const beforeRemote = privateLocalReadRemote(f);
        const holder = await heldPrivateReviewMutation(
          db,
          async (tx) => {
            if (target === "reader")
              await tx.execute(sql`SELECT id FROM users WHERE id=${f.owner.id} FOR UPDATE`);
            else if (target === "account")
              await tx.execute(sql`SELECT id FROM email_accounts
                WHERE id=${f.accountId} FOR UPDATE`);
            else if (target === "thread")
              await tx.execute(sql`SELECT id FROM email_threads
                WHERE id=${f.threadId} FOR UPDATE`);
            else if (target === "intake")
              await tx.execute(sql`SELECT id FROM email_private_intake
                WHERE id=${f.intakeId} FOR UPDATE`);
            else
              await tx.execute(sql`SELECT thread_id FROM email_thread_reads
                WHERE thread_id=${f.threadId} AND user_id=${f.owner.id} FOR UPDATE`);
          },
          signal,
        );
        const controller = new AbortController();
        const change = direction === "read" ? markThreadRead : markThreadUnread;
        const saving = change(db, args, controller.signal, deps);
        // Observation prevents an expected abort rejection becoming unhandled.
        const observed = observePrivateReview(saving);
        let settledBeforeRelease = false;
        let rejectedBeforeRelease = false;
        let abortReason: unknown;
        try {
          const waitingPid = await waitForLocalReadLock(db, holder.pid, target, signal);
          controller.abort();
          const bounded = await settleBeforeRelease(observed, signal);
          settledBeforeRelease = bounded.kind === "settled";
          if (bounded.kind === "settled" && bounded.value.status === "rejected") {
            rejectedBeforeRelease = true;
            abortReason = bounded.value.reason;
          }
          // Ordinary MVCC reads can inspect these facts while the holder remains locked.
          expect(await privateLocalReadRows(db, f)).toEqual(beforeReads);
          expect(await privateLocalReadMailbox(db, f)).toEqual(beforeMailbox);
          expect(privateLocalReadRemote(f)).toEqual(beforeRemote);
          if (settledBeforeRelease) {
            const waiting = await db.execute(sql`SELECT pid FROM pg_stat_activity
              WHERE pid=${waitingPid} AND (wait_event_type='Lock'
                OR state IN ('idle in transaction','idle in transaction (aborted)'))`);
            signal.throwIfAborted();
            expect(waiting.rows).toEqual([]);
            // Probe an earlier fence, or the untouched account when the reader itself blocks.
            await db.transaction(async (tx) => {
              if (target === "reader")
                await tx.execute(sql`SELECT id FROM email_accounts
                  WHERE id=${f.accountId} FOR UPDATE NOWAIT`);
              else
                await tx.execute(sql`SELECT id FROM users
                  WHERE id=${f.owner.id} FOR UPDATE NOWAIT`);
              signal.throwIfAborted();
            });
          }
        } finally {
          holder.release();
          // Always drain the native query before withTestDb destroys its database.
          await Promise.allSettled([holder.pending, observed]);
        }
        await holder.pending;
        expect(await privateLocalReadRows(db, f)).toEqual(beforeReads);
        expect(await privateLocalReadMailbox(db, f)).toEqual(beforeMailbox);
        expect(await change(db, args, signal, deps)).toEqual(ok({ threadId: f.threadId }));
        expect(await privateLocalReadRows(db, f)).toHaveLength(direction === "read" ? 1 : 0);
        expect(f.loadConnection).not.toHaveBeenCalled();
        expect(f.append).not.toHaveBeenCalled();
        expect(privateLocalReadRemote(f)).toEqual(beforeRemote);
        expect(await privateLocalReadMailbox(db, f)).toEqual(beforeMailbox);
        // These observations were captured before finally released the lock holder.
        expect(settledBeforeRelease, "abort must settle within one second before release").toBe(
          true,
        );
        expect(rejectedBeforeRelease).toBe(true);
        expect(abortReason).toBe(controller.signal.reason);
        expect(abortReason).toMatchObject({ name: "AbortError" });
      } finally {
        await f.close();
      }
    });
  },
);

it("retires only the owned connection and confirms backend exit before max-one-pool cancellation", async () => {
  await withTestDb(async (db) => {
    const origin: unknown = "$client" in db ? db.$client : undefined;
    expect(origin).toBeInstanceOf(Pool);
    if (!(origin instanceof Pool)) return;
    const pool = new Pool({ ...origin.options, max: 1, connectionTimeoutMillis: 2000 });
    const one = drizzle(pool, { schema });
    const signal = AbortSignal.timeout(5000);
    try {
      await pool.query("SET client_connection_check_interval='20ms'");
      const before = await pool.query<{
        pid: number;
        lock: string;
        statement: string;
      }>(`SELECT pg_backend_pid() AS pid,
        current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`);
      const normal = await withPrivateIntakeLocalReadLocks(one, signal, async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout='20ms'; SET LOCAL statement_timeout='300ms'`);
        const settings = await tx.execute(sql`SELECT pg_backend_pid() AS pid,
          current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement,
          current_setting('client_connection_check_interval') AS connection`);
        expect(settings.rows).toEqual([
          { pid: before.rows[0]?.pid, lock: "20ms", statement: "300ms", connection: "20ms" },
        ]);
        return settings.rows[0]?.pid;
      });
      expect(normal).toBe(before.rows[0]?.pid);
      expect(
        (
          await pool.query<{
            pid: number;
            lock: string;
            statement: string;
          }>(`SELECT pg_backend_pid() AS pid,
        current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`)
        ).rows,
      ).toEqual(before.rows);
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      const holder = await heldPrivateReviewMutation(
        db,
        async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(19831103)`);
        },
        signal,
      );
      const action = new AbortController();
      const identity: { current?: { pid: number; started: string; database: string } } = {};
      let owned: PoolClient | undefined;
      let releases = 0;
      pool.once("acquire", (client: PoolClient) => {
        owned = client;
      });
      pool.on("release", (_error: unknown, client: PoolClient) => {
        if (client === owned) releases += 1;
      });
      const pending = withPrivateIntakeLocalReadLocks(one, action.signal, async (tx) => {
        const backend = await tx.execute<{ pid: number; started: string; database: string }>(sql`
          SELECT pid,backend_start::text AS started,datid::text AS database
          FROM pg_stat_activity WHERE pid=pg_backend_pid()`);
        identity.current = backend.rows[0];
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19831103)`);
      });
      const observed = observePrivateReview(pending);
      try {
        await waitPrivateReviewBlockedBy(db, holder.pid, signal);
        expect(identity.current).toBeDefined();
        action.abort();
        const outcome = await settleBeforeRelease(observed, signal);
        expect(outcome.kind).toBe("settled");
        if (outcome.kind === "settled") {
          expect(outcome.value).toMatchObject({ status: "rejected" });
          if (outcome.value.status === "rejected")
            expect(outcome.value.reason).toBe(action.signal.reason);
        }
        const remaining = await db.execute(sql`SELECT pid FROM pg_stat_activity
          WHERE pid=${identity.current?.pid} AND backend_start=${identity.current?.started}::timestamptz
            AND datid=${identity.current?.database}::oid`);
        expect(remaining.rows).toEqual([]);
        const recovery = await pool.query<{ pid: number; usable: number }>(
          "SELECT pg_backend_pid() AS pid, 1 AS usable",
        );
        expect(recovery.rows[0]?.usable).toBe(1);
        expect(recovery.rows[0]?.pid).not.toBe(identity.current?.pid);
        expect(pool.waitingCount).toBe(0);
        expect(pool.totalCount).toBe(1);
        expect(pool.idleCount).toBe(1);
        expect(releases).toBe(1);
      } finally {
        holder.release();
        await Promise.allSettled([holder.pending, observed]);
      }
      await holder.pending;
    } finally {
      await pool.end();
    }
  });
});
