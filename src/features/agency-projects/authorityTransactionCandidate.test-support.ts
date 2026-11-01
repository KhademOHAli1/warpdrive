import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { TestDb } from "@/test/db";
import { ok, type Result } from "@/types/result";
import { runAuthorityTransactionCandidate } from "./authorityTransactionCandidate";
import type { AuthorityTransactionSpec } from "./authorityTransactionSpec";

type CandidateTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type BeforeHold = (tx: CandidateTx) => Promise<Result<true, string>>;

export const settingsQuery = `SELECT
  current_setting('transaction_isolation') AS isolation,
  (SELECT setting::int FROM pg_settings WHERE name = 'lock_timeout') AS "lockMs",
  (SELECT setting::int FROM pg_settings WHERE name = 'statement_timeout') AS "statementMs",
  (SELECT setting::int FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout') AS "idleMs"`;

export function candidateSpec(mode: AuthorityTransactionSpec["mode"]): AuthorityTransactionSpec {
  return {
    key: [1_731_940_011, 441],
    mode,
    sqlTimeouts: { lockMs: 1_500, statementMs: 3_000, idleMs: 5_000 },
  };
}

export function userValues(id: string, name = "before") {
  return { id, email: `authority-${id}@synthetic.invalid`, name, isActive: true };
}

export async function seedActor(h: TestDb): Promise<string> {
  const id = randomUUID();
  await h.db.insert(users).values(userValues(id));
  return id;
}

export async function configuredCommit(h: TestDb) {
  const pool = new Pool({ connectionString: h.url, max: 1 });
  try {
    await pool.query("SET SESSION default_transaction_isolation = 'repeatable read'");
    const before = await pool.query(settingsQuery);
    const signal = new AbortController().signal;
    const id = randomUUID();
    let receivedSignal: AbortSignal | undefined;
    const result = await runAuthorityTransactionCandidate(
      pool, candidateSpec("exclusive"), signal,
      async (tx, supplied) => {
        receivedSignal = supplied;
        const settings = await tx.execute(sql.raw(settingsQuery));
        await tx.insert(users).values(userValues(id));
        return ok(settings.rows[0]);
      },
    );
    const committed = await h.db.select({ id: users.id }).from(users).where(eq(users.id, id));
    const after = await pool.query(settingsQuery);
    return { before: before.rows, after: after.rows, result, receivedSignal, signal, id, committed };
  } finally {
    await pool.end();
  }
}

export async function deferredCommitFailure(h: TestDb) {
  const id = randomUUID();
  let operationEntered = false;
  let operationCompleted = false;
  const result = await runAuthorityTransactionCandidate(
    h.pool, candidateSpec("exclusive"), new AbortController().signal,
    async (tx) => {
      operationEntered = true;
      await tx.insert(users).values(userValues(id));
      await tx.execute(sql`CREATE TEMP TABLE authority_commit_failure_probe (
        value integer UNIQUE DEFERRABLE INITIALLY DEFERRED
      ) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO authority_commit_failure_probe (value) VALUES (1), (1)`);
      operationCompleted = true;
      return ok("deferred_probe");
    },
  );
  const remaining = await h.db.select({ id: users.id }).from(users).where(eq(users.id, id));
  return { result, operationEntered, operationCompleted, remaining };
}

export function barrier() {
  let opened = false;
  let resolve = () => {};
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return {
    promise,
    isOpen: () => opened,
    open: () => {
      opened = true;
      resolve();
    },
  };
}

function observed<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ kind: "finished" as const, value }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
}

export function heldTransaction(h: TestDb, spec: AuthorityTransactionSpec, beforeHold?: BeforeHold) {
  const entered = barrier();
  const release = barrier();
  const run = runAuthorityTransactionCandidate(h.pool, spec, new AbortController().signal, async (tx) => {
    const prepared = await beforeHold?.(tx);
    if (prepared?.ok === false) return prepared;
    entered.open();
    await release.promise;
    return ok("held");
  });
  return { entered, release, run, settled: observed(run) };
}

type HeldTransaction = ReturnType<typeof heldTransaction>;

export async function waitForEntry(handle: HeldTransaction) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handle.entered.promise.then(() => ({ kind: "entered" as const })),
      handle.settled,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForSettlement(handle: HeldTransaction) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handle.settled,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function advisoryLocks(h: TestDb, spec: AuthorityTransactionSpec) {
  const result = await h.pool.query<{ mode: string; granted: boolean }>(
    `SELECT mode, granted FROM pg_locks
     WHERE locktype = 'advisory'
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND classid = $1::oid AND objid = $2::oid AND objsubid = 2`,
    [spec.key[0], spec.key[1]],
  );
  return result.rows;
}

export async function waitForWaiter(
  h: TestDb,
  spec: AuthorityTransactionSpec,
  handle: HeldTransaction,
  timeoutMs = 1_000,
) {
  const mode = spec.mode === "shared" ? "ShareLock" : "ExclusiveLock";
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const next = await Promise.race([
      advisoryLocks(h, spec).then((locks) => ({ kind: "locks" as const, locks })),
      handle.entered.promise.then(() => ({ kind: "entered" as const })),
      handle.settled,
    ]);
    if (next.kind !== "locks") return next;
    if (next.locks.some((lock) => !lock.granted && lock.mode === mode))
      return { kind: "waiting" as const };
    await setImmediate();
  }
  return { kind: "timeout" as const };
}

export async function closeHeldFixture(h: TestDb, handles: readonly HeldTransaction[]) {
  for (const handle of handles) handle.release.open();
  try {
    await Promise.allSettled(handles.map((handle) => handle.run));
  } finally {
    await h.close();
  }
}

