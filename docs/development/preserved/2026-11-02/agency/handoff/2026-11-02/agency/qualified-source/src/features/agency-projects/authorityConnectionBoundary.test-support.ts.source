import { setImmediate } from "node:timers/promises";
import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import type { Db } from "@/db/client";
import { ok } from "@/types/result";
import type { AuthorityTransactionSpec } from "./authorityTransactionSpec";

type CandidateTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Observed<T> =
  | { kind: "finished"; value: T }
  | { kind: "rejected"; error: unknown };

export function connectionBoundarySpec(): AuthorityTransactionSpec {
  return {
    key: [1_731_940_011, 441],
    mode: "shared",
    sqlTimeouts: { lockMs: 1_500, statementMs: 3_000, idleMs: 5_000 },
  };
}

export function boundaryUser(id: string, name: string) {
  return { id, email: `boundary-${id}@synthetic.invalid`, name, isActive: true, invitedAt: null };
}

export function observe<T>(promise: Promise<T>): Promise<Observed<T>> {
  return promise.then(
    (value) => ({ kind: "finished", value }),
    (error: unknown) => ({ kind: "rejected", error }),
  );
}

export async function waitForQueuedOrSettled<T>(pool: Pool, settled: Promise<Observed<T>>) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queued = async () => {
    while (!stopped) {
      if (pool.waitingCount === 1) return { kind: "queued" as const };
      await setImmediate();
    }
    return { kind: "stopped" as const };
  };
  try {
    return await Promise.race([
      queued(),
      settled,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
      }),
    ]);
  } finally {
    stopped = true;
    clearTimeout(timer);
  }
}

export async function waitForBoundarySettlement<T>(settled: Promise<Observed<T>>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), 2_500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function rollbackAndRelease(client: PoolClient) {
  let discard = true;
  try {
    await client.query("ROLLBACK");
    discard = false;
  } finally {
    client.release(discard);
  }
}

export function releaseRemainingClients(clients: PoolClient[]) {
  return Promise.allSettled(
    clients.splice(0).map((client) => Promise.resolve().then(() => client.release())),
  );
}

// All four fixture clients can be occupied, so inspect using the transaction's own connection.
export async function readOwnConfiguration(tx: CandidateTx, signal: AbortSignal) {
  const settings = await tx.execute(sql`SELECT
    current_setting('transaction_isolation') AS isolation,
    (SELECT setting::int FROM pg_settings WHERE name = 'lock_timeout') AS "lockMs",
    (SELECT setting::int FROM pg_settings WHERE name = 'statement_timeout') AS "statementMs",
    (SELECT setting::int FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout') AS "idleMs"`);
  signal.throwIfAborted();
  const locks = await tx.execute(sql`SELECT
    classid::text AS "keyFirst", objid::text AS "keySecond", objsubid AS "keySpace", mode, granted
    FROM pg_locks
    WHERE locktype = 'advisory' AND pid = pg_backend_pid()
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY classid, objid, objsubid, mode`);
  signal.throwIfAborted();
  return ok({ settings: settings.rows[0], locks: locks.rows });
}
