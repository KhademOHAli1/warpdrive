import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import {
  installPrivateLocalReadBarrier,
  removePrivateLocalReadBarrier,
  waitPrivateLocalReadBarrier,
} from "./privateIntakeLocalRead.race.test-helpers";
import {
  type PrivateLocalReadFixture,
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
import { markThreadRead } from "./readState";

type Fence = "user" | "account" | "thread" | "ledger";

async function competingMutation(
  db: Db,
  f: PrivateLocalReadFixture,
  fence: Fence,
  successor: string,
) {
  if (fence === "user")
    await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
  else if (fence === "account")
    await db.execute(sql`UPDATE email_accounts SET user_id=${successor} WHERE id=${f.accountId}`);
  else if (fence === "thread")
    // A no-op thread UPDATE proves the thread row fence itself. DELETE would
    // also wait on ledger cleanup and could falsely credit a missing thread lock.
    await db.execute(sql`UPDATE email_threads SET subject=subject
      WHERE id=${f.threadId} AND account_id=${f.accountId}`);
  else
    await db.execute(sql`UPDATE email_private_intake SET revision=revision+1
      WHERE id=${f.intakeId} AND account_id=${f.accountId}`);
  f.args.signal.throwIfAborted();
}

it.each<Fence>(["user", "account", "thread", "ledger"])(
  "holds the current owner local-read %s fence through the marker insert and commit",
  async (fence) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        const signal = f.args.signal;
        const successor = await seedUser(db);
        await installPrivateLocalReadBarrier(db, signal);
        const before = await privateLocalReadMailbox(db, f);
        const remote = privateLocalReadRemote(f);
        const barrier = await heldPrivateReviewMutation(
          db,
          async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(
            hashtextextended('private-intake-local-read-test',0))`);
          },
          signal,
        );
        const saving = markThreadRead(db, { actor: f.actor, threadId: f.threadId }, signal, {
          loadConnection: f.loadConnection,
        });
        const observedSaving = observePrivateReview(saving);
        let changing: Promise<void> | null = null;
        let observedChanging: ReturnType<typeof observePrivateReview<void>> | null = null;
        try {
          const atInsert = await waitPrivateLocalReadBarrier(
            db,
            barrier.pid,
            observedSaving,
            signal,
          );
          expect(atInsert).toMatchObject({ kind: "blocked" });
          if (atInsert.kind !== "blocked") return;
          // The preference is not committed yet, and neither mail facts nor remote
          // state have changed while the native marker insert is paused.
          expect(await privateLocalReadRows(db, f)).toEqual([]);
          expect(await privateLocalReadMailbox(db, f)).toEqual(before);
          changing = competingMutation(db, f, fence, successor.id);
          observedChanging = observePrivateReview(changing);
          await waitPrivateReviewBlockedBy(db, atInsert.pid, signal);
        } finally {
          barrier.release();
          await Promise.allSettled(
            observedChanging === null
              ? [barrier.pending, observedSaving]
              : [barrier.pending, observedSaving, observedChanging],
          );
          await removePrivateLocalReadBarrier(db, AbortSignal.timeout(5000));
        }
        await barrier.pending;
        expect(await saving).toEqual(ok({ threadId: f.threadId }));
        if (changing !== null) await changing;
        expect(await privateLocalReadRows(db, f)).toHaveLength(1);
        if (fence === "thread" || fence === "user")
          expect(await privateLocalReadMailbox(db, f)).toEqual(before);
        expect(f.loadConnection).not.toHaveBeenCalled();
        expect(f.append).not.toHaveBeenCalled();
        expect(privateLocalReadRemote(f)).toEqual(remote);
      } finally {
        await f.close();
      }
    });
  },
);

it("retains the reader fence during one native account lock wait without retry", async () => {
  await withTestDb(async (db) => {
    const f = await privateLocalReadFixture(db);
    try {
      const signal = f.args.signal;
      const holder = await heldPrivateReviewMutation(
        db,
        async (tx) => {
          await tx.execute(sql`SELECT id FROM email_accounts WHERE id=${f.accountId} FOR UPDATE`);
        },
        signal,
      );
      const saving = markThreadRead(db, { actor: f.actor, threadId: f.threadId }, signal, {
        loadConnection: f.loadConnection,
      });
      const observed = observePrivateReview(saving);
      let changing: Promise<void> | undefined;
      let observedChanging: ReturnType<typeof observePrivateReview<void>> | undefined;
      try {
        const pid = await waitPrivateReviewBlockedBy(db, holder.pid, signal);
        const first = await db.execute<{ started: string }>(sql`SELECT query_start::text AS started
          FROM pg_stat_activity WHERE pid=${pid}`);
        const started = first.rows[0]?.started;
        expect(started).toEqual(expect.any(String));
        changing = (async () => {
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
        })();
        observedChanging = observePrivateReview(changing);
        await waitPrivateReviewBlockedBy(db, pid, signal);
        await db.execute(sql`SELECT pg_sleep(0.25)`);
        const waiting = await db.execute(sql`SELECT query_start::text AS started
          FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'
            AND ${holder.pid}=ANY(pg_blocking_pids(pid))`);
        expect(waiting.rows).toEqual([{ started }]);
        await waitPrivateReviewBlockedBy(db, pid, signal);
      } finally {
        holder.release();
        await Promise.allSettled([holder.pending, observed, observedChanging]);
      }
      await holder.pending;
      expect(await saving).toEqual(ok({ threadId: f.threadId }));
      await changing;
      expect(await privateLocalReadRows(db, f)).toHaveLength(1);
      expect(f.loadConnection).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});

it.each(["insert", "upsert", "delete"] as const)(
  "rolls back an already executed local marker %s before cancelled work settles",
  async (operation) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        if (operation !== "insert")
          expect(
            await markThreadRead(db, { actor: f.actor, threadId: f.threadId }, f.args.signal),
          ).toEqual(ok({ threadId: f.threadId }));
        const before = await privateLocalReadMailbox(db, f);
        const reads = await privateLocalReadRows(db, f);
        const raw = await db.execute(sql`SELECT read_at::text AS read_at FROM email_thread_reads
          WHERE thread_id=${f.threadId} AND user_id=${f.owner.id}`);
        const action = new AbortController();
        const backend: { current?: { pid: number; started: string; database: string } } = {};
        const pending = withPrivateIntakeLocalReadLocks(db, action.signal, async (tx) => {
          backend.current = (
            await tx.execute<{ pid: number; started: string; database: string }>(sql`
            SELECT pid,backend_start::text AS started,datid::text AS database
            FROM pg_stat_activity WHERE pid=pg_backend_pid()`)
          ).rows[0];
          if (operation === "delete")
            await tx.execute(sql`DELETE FROM email_thread_reads
              WHERE thread_id=${f.threadId} AND user_id=${f.owner.id}`);
          else
            await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
              SELECT id,${f.owner.id},GREATEST(clock_timestamp(),last_message_at)+interval '1 day'
              FROM email_threads WHERE id=${f.threadId}
              ON CONFLICT(thread_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at`);
          const changed =
            await tx.execute(sql`SELECT read_at::text AS read_at FROM email_thread_reads
            WHERE thread_id=${f.threadId} AND user_id=${f.owner.id}`);
          expect(changed.rows).not.toEqual(raw.rows);
          action.abort();
        });
        const outcome = await observePrivateReview(pending);
        expect(outcome).toMatchObject({ status: "rejected" });
        if (outcome.status === "rejected") expect(outcome.reason).toBe(action.signal.reason);
        expect(backend.current).toBeDefined();
        expect(
          (
            await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE pid=${backend.current?.pid}
          AND backend_start=${backend.current?.started}::timestamptz AND datid=${backend.current?.database}::oid`)
          ).rows,
        ).toEqual([]);
        expect(await privateLocalReadRows(db, f)).toEqual(reads);
        expect(await privateLocalReadMailbox(db, f)).toEqual(before);
        expect((await db.execute(sql`SELECT 1 AS usable`)).rows).toEqual([{ usable: 1 }]);
      } finally {
        await f.close();
      }
    });
  },
);

it("preserves a captured driver-closed error over a later abort", async () => {
  await withTestDb(async (db) => {
    const action = new AbortController();
    let captured: unknown;
    const pending = withPrivateIntakeLocalReadLocks(db, action.signal, async (tx) => {
      const client: unknown = "$client" in tx ? tx.$client : undefined;
      expect(client).toBeInstanceOf(Client);
      if (!(client instanceof Client)) return;
      await client.end();
      try {
        await tx.execute(sql`SELECT 1`);
      } catch (error) {
        captured = error;
        action.abort();
        throw error;
      }
    });
    const outcome = await observePrivateReview(pending);
    expect(outcome).toMatchObject({ status: "rejected" });
    if (outcome.status === "rejected") expect(outcome.reason).toBe(captured);
    expect(captured).toBeDefined();
    expect(captured).not.toBe(action.signal.reason);
    expect((await db.execute(sql`SELECT 1 AS usable`)).rows).toEqual([{ usable: 1 }]);
  });
});

it("refuses an actual client-backed Drizzle handle without retiring its caller-owned client", async () => {
  await withTestDb(async (db) => {
    const origin: unknown = "$client" in db ? db.$client : undefined;
    expect(origin).toBeInstanceOf(Pool);
    if (!(origin instanceof Pool)) return;
    const client = await origin.connect();
    let invoked = false;
    try {
      await expect(
        withPrivateIntakeLocalReadLocks(
          drizzle(client, { schema }),
          AbortSignal.timeout(5000),
          () => {
            invoked = true;
            return Promise.resolve();
          },
        ),
      ).rejects.toMatchObject({ name: "AppError" });
      expect(invoked).toBe(false);
      expect((await client.query<{ usable: number }>("SELECT 1 AS usable")).rows).toEqual([
        { usable: 1 },
      ]);
    } finally {
      client.release();
    }
  });
});
