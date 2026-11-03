import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { markPrivateIntakeLocalRead } from "./privateIntakeLocalRead";
import { waitPrivateLocalReadBarrier } from "./privateIntakeLocalRead.race.test-helpers";
import {
  privateLocalReadFixture,
  privateLocalReadMailbox,
  privateLocalReadRemote,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
} from "./privateIntakeReview.race.test-helpers";

function commitPool(db: Db, withholdReceipt = false) {
  const origin: unknown = "$client" in db ? db.$client : undefined;
  if (!(origin instanceof Pool)) throw new Error("Native COMMIT fixture requires a real Pool");
  const pool = new Pool({ ...origin.options, max: 1 });
  let releaseReceipt = () => {};
  const withheld = new Promise<void>((resolve) => {
    releaseReceipt = resolve;
  });
  let committed = () => {};
  const acknowledged = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const state = { commits: 0, rollbacks: 0, releases: 0, releasesAtDispatch: 0 };
  pool.on("release", () => {
    state.releases += 1;
  });
  pool.on("connect", (client) => {
    const native = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      if (args[0] === "COMMIT") {
        state.commits += 1;
        state.releasesAtDispatch = state.releases;
      }
      if (args[0] === "ROLLBACK") state.rollbacks += 1;
      const pending: unknown = Reflect.apply(native, client, args);
      if (!withholdReceipt || args[0] !== "COMMIT") return pending;
      if (!(pending instanceof Promise)) throw new Error("COMMIT fixture requires a promise query");
      // This withholds an actual successful PG receipt at the driver boundary,
      // rather than claiming a TCP blackhole or inventing a database result.
      return pending.then(async (result: unknown) => {
        committed();
        await withheld;
        return result;
      });
    }) as PoolClient["query"];
  });
  return { pool, state, acknowledged, releaseReceipt };
}

async function requireBackendGone(db: Db, pid: number) {
  await vi.waitFor(
    async () => {
      const result = await db.execute(sql`SELECT pid FROM pg_catalog.pg_stat_activity
      WHERE pid=${pid}`);
      expect(result.rows).toEqual([]);
    },
    { timeout: 2000, interval: 10 },
  );
}

function expectUncertain(outcome: Awaited<ReturnType<typeof observePrivateReview>>) {
  expect(outcome).toMatchObject({
    status: "rejected",
    reason: { id: "E_DB_003", context: { phase: "commit-receipt" } },
  });
}

it("retires a native COMMIT blocked in a deferred trigger without claiming clean abort", async () => {
  await withTestDb(async (db) => {
    const f = await privateLocalReadFixture(db);
    const owned = commitPool(db);
    const action = new AbortController();
    let holder: Awaited<ReturnType<typeof heldPrivateReviewMutation>> | undefined;
    let observed: ReturnType<typeof observePrivateReview> | undefined;
    try {
      const before = await privateLocalReadMailbox(db, f);
      const remote = privateLocalReadRemote(f);
      await db.execute(sql`CREATE FUNCTION private_local_read_commit_barrier() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended('private-local-read-commit-test',0));
          RETURN NEW;
        END $$`);
      await db.execute(sql`CREATE CONSTRAINT TRIGGER private_local_read_commit_barrier
        AFTER INSERT OR UPDATE ON email_thread_reads DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION private_local_read_commit_barrier()`);
      holder = await heldPrivateReviewMutation(
        db,
        async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtextextended('private-local-read-commit-test',0))`);
        },
        f.args.signal,
      );
      const saving = markPrivateIntakeLocalRead(
        drizzle(owned.pool, { schema }),
        {
          actorId: f.owner.id,
          accountId: f.accountId,
          threadId: f.threadId,
          read: true,
        },
        action.signal,
      );
      observed = observePrivateReview(saving);
      const blocked = await waitPrivateLocalReadBarrier(db, holder.pid, observed, f.args.signal);
      expect(blocked.kind).toBe("blocked");
      if (blocked.kind !== "blocked") return;
      const waiting =
        await db.execute(sql`SELECT query,wait_event_type FROM pg_catalog.pg_stat_activity
        WHERE pid=${blocked.pid}`);
      expect(waiting.rows).toEqual([{ query: "COMMIT", wait_event_type: "Lock" }]);
      const reason = new Error("Caller stopped after native COMMIT dispatch");
      action.abort(reason);
      let result: Awaited<typeof observed> | undefined;
      void observed.then((value) => {
        result = value;
      });
      await vi.waitFor(() => expect(result).toBeDefined(), { timeout: 4500, interval: 10 });
      const settled = await observed;
      expectUncertain(settled);
      if (settled.status === "rejected") expect(settled.reason).not.toBe(reason);
      await requireBackendGone(db, blocked.pid);
      expect(await privateLocalReadRows(db, f)).toEqual([]);
      expect(owned.state.commits).toBe(1);
      expect(owned.state.rollbacks).toBe(0);
      expect(owned.pool.totalCount).toBe(0);
      expect(await privateLocalReadMailbox(db, f)).toEqual(before);
      expect(privateLocalReadRemote(f)).toEqual(remote);
    } finally {
      holder?.release();
      await Promise.allSettled([holder?.pending, observed]);
      await db.execute(
        sql`DROP TRIGGER IF EXISTS private_local_read_commit_barrier ON email_thread_reads`,
      );
      await db.execute(sql`DROP FUNCTION IF EXISTS private_local_read_commit_barrier()`);
      await owned.pool.end();
      await f.close();
    }
  });
});

it("keeps a real committed marker when its driver receipt is withheld and never replays it", async () => {
  await withTestDb(async (db) => {
    const f = await privateLocalReadFixture(db);
    const owned = commitPool(db, true);
    const action = new AbortController();
    let observed: ReturnType<typeof observePrivateReview> | undefined;
    try {
      const before = await privateLocalReadMailbox(db, f);
      const remote = privateLocalReadRemote(f);
      const row = (await owned.pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
        .rows[0];
      const pid = row?.pid;
      if (pid === undefined) throw new Error("Native COMMIT backend PID missing");
      const saving = markPrivateIntakeLocalRead(
        drizzle(owned.pool, { schema }),
        {
          actorId: f.owner.id,
          accountId: f.accountId,
          threadId: f.threadId,
          read: true,
        },
        action.signal,
      );
      observed = observePrivateReview(saving);
      const commit = await Promise.race([
        owned.acknowledged.then(() => ({ acknowledged: true as const })),
        observed.then((outcome) => ({ acknowledged: false as const, outcome })),
      ]);
      expect(commit.acknowledged).toBe(true);
      if (!commit.acknowledged) return;
      const committed = await privateLocalReadRows(db, f);
      expect(committed).toHaveLength(1);
      const reason = new Error("Caller stopped after actual PostgreSQL COMMIT");
      action.abort(reason);
      let result: Awaited<typeof observed> | undefined;
      void observed.then((value) => {
        result = value;
      });
      await vi.waitFor(() => expect(result).toBeDefined(), { timeout: 4500, interval: 10 });
      const settled = await observed;
      expectUncertain(settled);
      if (settled.status === "rejected") expect(settled.reason).not.toBe(reason);
      expect(owned.state.commits).toBe(1);
      expect(owned.state.rollbacks).toBe(0);
      expect(owned.state.releases).toBe(owned.state.releasesAtDispatch);
      expect(owned.pool.totalCount).toBe(1);
      expect(owned.pool.idleCount).toBe(0);
      await requireBackendGone(db, pid);
      expect(await privateLocalReadRows(db, f)).toEqual(committed);
      owned.releaseReceipt();
      await vi.waitFor(() => expect(owned.pool.totalCount).toBe(0), {
        timeout: 1500,
        interval: 10,
      });
      expect(owned.state.releases).toBe(owned.state.releasesAtDispatch + 1);
      expect(owned.state.commits).toBe(1);
      expect(owned.state.rollbacks).toBe(0);
      expect(await privateLocalReadRows(db, f)).toEqual(committed);
      expect(await privateLocalReadMailbox(db, f)).toEqual(before);
      expect(privateLocalReadRemote(f)).toEqual(remote);
    } finally {
      owned.releaseReceipt();
      await Promise.allSettled([observed]);
      await owned.pool.end();
      await f.close();
    }
  });
});
