import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { disposeNotificationResources } from "@/features/notifications/email/notificationPg.test-helpers";
import { makeTestDb } from "@/test/db";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import { threadMailCapabilities } from "./imapThreadOperationsCapabilities";

type Completion =
  | { kind: "completed"; result: Awaited<ReturnType<typeof runImapThreadOperation>> }
  | { kind: "rejected"; error: unknown };
type PoolOutcome = Completion | { kind: "self_starved"; waiting: number; pid: number };

async function completionOrSelfStarvation(
  pool: Pool,
  observer: PoolClient,
  applicationName: string,
  completion: Promise<Completion>,
  signal: AbortSignal,
): Promise<PoolOutcome> {
  let finished: Completion | undefined;
  void completion.then((value) => {
    finished = value;
  });
  const deadline = Date.now() + 10_000;
  while (finished === undefined) {
    signal.throwIfAborted();
    if (pool.totalCount === 1 && pool.idleCount === 0 && pool.waitingCount === 1) {
      await observer.query("SELECT pg_stat_clear_snapshot()");
      signal.throwIfAborted();
      const activity = await observer.query<{ pid: number; query: string }>(
        `SELECT a.pid,a.query FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.application_name=$1
          AND a.state='idle in transaction'
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid
            AND l.locktype='advisory' AND l.granted)`,
        [applicationName],
      );
      signal.throwIfAborted();
      // This is the exact current-owner query immediately before the actual first
      // beforeMutation fence. The ordinary operation has entered its outer I/O tx.
      const held = activity.rows.find(
        (row) =>
          row.query.includes("SELECT a.id FROM email_accounts a JOIN users u") &&
          row.query.includes("a.connection_generation=") &&
          row.query.includes("u.invited_at IS NULL"),
      );
      if (held !== undefined && pool.waitingCount === 1)
        return { kind: "self_starved", waiting: pool.waitingCount, pid: held.pid };
    }
    if (Date.now() >= deadline)
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "IMAP pool fixture reached neither completion nor the exact pool barrier",
      );
    await delay(10, undefined, { signal });
  }
  return finished;
}

async function settleOwnedOperation(
  pool: Pool,
  controller: AbortController,
  completion: Promise<Completion> | undefined,
): Promise<void> {
  controller.abort(new DOMException("Owned IMAP pool fixture cleanup", "AbortError"));
  if (pool.waitingCount > 0) {
    // Cleanup only: make one owned connection available to the already queued fence.
    // It can then observe the abort, roll back and release the original I/O connection.
    // This capacity increase is never part of the success oracle or a runtime fix.
    pool.options.max = 2;
    const pulse = await pool.connect();
    pulse.release();
  }
  await completion;
}

it("completes an ordinary owner IMAP read flip with one actual database connection", async () => {
  const h = await makeTestDb();
  const db = drizzle(h.pool, { schema });
  const ownedPool = new Pool({
    ...db.$client.options,
    application_name: `wd_imap_pool_${randomUUID()}`,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    lock_timeout: 8_000,
  });
  const operationDb = drizzle(ownedPool, { schema });
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
  let f: Awaited<ReturnType<typeof imapOperationsFixture>> | undefined;
  let observer: PoolClient | undefined;
  let completion: Promise<Completion> | undefined;
  try {
    f = await imapOperationsFixture(db);
    await db.execute(sql`UPDATE email_accounts SET capabilities=
      '{"read":true,"send":true,"markRead":true,"move":true,"trash":true}'::jsonb
      WHERE id=${f.accountId}`);
    expect(
      (await threadMailCapabilities(db, f.actor, [f.threadId], signal)).get(f.threadId),
    ).toEqual({
      read: true,
      send: true,
      markRead: true,
      move: true,
      trash: true,
    });
    expect(
      (await db.execute(sql`SELECT id FROM email_private_intake WHERE account_id=${f.accountId}`))
        .rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`SELECT thread_id FROM email_thread_reads WHERE user_id=${f.owner.id}`))
        .rows,
    ).toEqual([]);
    signal.throwIfAborted();
    observer = await db.$client.connect();
    const applicationName = ownedPool.options.application_name;
    if (applicationName === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "IMAP pool fixture application marker missing");
    const pending = runImapThreadOperation(
      operationDb,
      { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
      signal,
      f.deps,
    );
    // Observe both branches immediately. The cleanup abort must not create an orphan rejection.
    completion = pending.then(
      (result) => ({ kind: "completed" as const, result }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    const outcome = await completionOrSelfStarvation(
      ownedPool,
      observer,
      applicationName,
      completion,
      signal,
    );
    if (outcome.kind === "self_starved")
      controller.abort(new DOMException("Confirmed owned pool self-starvation", "AbortError"));
    expect.soft(ownedPool.options.max).toBe(1);
    expect
      .soft(outcome)
      .toMatchObject({ kind: "completed", result: { ok: true, value: { threadId: f.threadId } } });
    expect.soft(f.server.state.commands).toContain("STORE");
    const active =
      f.server.state.folders.get("INBOX")?.messages.filter((message) => message.uid > 1) ?? [];
    expect(active).toHaveLength(2);
    expect.soft(active.every((message) => message.flags.includes("\\Seen"))).toBe(true);
    const locators = (
      await db.execute(sql`SELECT flags FROM mail_message_locators
      WHERE account_id=${f.accountId} AND active=true`)
    ).rows;
    expect(locators).toHaveLength(2);
    expect
      .soft(locators.every((row) => Array.isArray(row.flags) && row.flags.includes("\\Seen")))
      .toBe(true);
    expect
      .soft(
        (
          await db.execute(sql`SELECT thread_id FROM email_thread_reads
      WHERE user_id=${f.owner.id}`)
        ).rows,
      )
      .toEqual([{ thread_id: f.threadId }]);
  } finally {
    await disposeNotificationResources(
      () => settleOwnedOperation(ownedPool, controller, completion),
      () => Promise.resolve(observer?.release()),
      () => ownedPool.end(),
      () => f?.server.close() ?? Promise.resolve(),
      () => h.close(),
    );
  }
});
