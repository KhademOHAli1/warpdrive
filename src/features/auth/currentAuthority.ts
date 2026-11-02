import { is, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";

export type AuthorityMode = "read" | "write";

function invariant(message: string): never {
  throw new AppError(ERROR_IDS.DB_INVARIANT, message, {});
}

async function heldAuthority(db: Db): Promise<AuthorityMode | null> {
  const result = await db.execute<{ mode: string }>(sql`
    SELECT mode FROM pg_locks
    WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted AND objsubid = 2
      AND classid = ((hashtext('warpdrive-current-authority')::bigint & 4294967295)::oid)
      AND objid = ((hashtext('actor-v1')::bigint & 4294967295)::oid)
  `);
  if (result.rows.some((row) => row.mode === "ExclusiveLock")) return "write";
  return result.rows.some((row) => row.mode === "ShareLock") ? "read" : null;
}

/** Internal transaction contract; an actor/session identifier is not a credential. */
export async function requireCurrentAuthority(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const isolation = await db.execute<{ isolation: string }>(
    sql`SELECT current_setting('transaction_isolation') AS isolation`,
  );
  if (isolation.rows[0]?.isolation !== "read committed")
    invariant("current authority requires READ COMMITTED");
  if ((await heldAuthority(db)) === null) invariant("current authority fence is not held");
  signal.throwIfAborted();
}

/**
 * Cooperating public writers take the exclusive fence before their existing domain locks.
 * Native creation takes the shared fence and rechecks its credential-derived session inside it.
 * These are per-statement/lock limits, not a deadline on provider I/O or on an entire transaction.
 * Callback errors (including caller-owned rollback sentinels) always escape through rollback.
 */
export async function withCurrentAuthority<T>(
  db: Db,
  mode: AuthorityMode,
  signal: AbortSignal,
  callback: (tx: Db) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const inherited = is(db, PgTransaction);
  return db.transaction(
    async (tx) => {
      const settings = await tx.execute<{
        isolation: string;
        statement_ms: string;
        lock_ms: string;
      }>(sql`
      SELECT current_setting('transaction_isolation') AS isolation,
        (SELECT setting FROM pg_settings WHERE name = 'statement_timeout') AS statement_ms,
        (SELECT setting FROM pg_settings WHERE name = 'lock_timeout') AS lock_ms
    `);
      const previous = settings.rows[0];
      if (previous?.isolation !== "read committed")
        invariant("current authority requires READ COMMITTED");
      signal.throwIfAborted();
      const held = await heldAuthority(tx);
      if (held === "read" && mode === "write")
        invariant("current authority cannot upgrade a shared fence");
      // An unwrapped caller may already own account/row locks. Do not acquire in reverse order.
      if (inherited && held === null)
        invariant("inherited transaction must acquire current authority at its outer entry");
      await tx.execute(sql`
      SELECT set_config('statement_timeout',
        least(nullif(${previous.statement_ms}::int, 0), 10000)::text, true),
        set_config('lock_timeout', least(nullif(${previous.lock_ms}::int, 0), 2000)::text, true)
    `);
      signal.throwIfAborted();
      if (held === null) {
        if (mode === "write")
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-current-authority'), hashtext('actor-v1'))`,
          );
        else
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-current-authority'), hashtext('actor-v1'))`,
          );
      }
      signal.throwIfAborted();
      const result = await callback(tx);
      signal.throwIfAborted();
      // Restore a caller's tighter/disabled settings without releasing its transaction fence.
      await tx.execute(sql`
      SELECT set_config('statement_timeout', ${previous.statement_ms}, true),
        set_config('lock_timeout', ${previous.lock_ms}, true)
    `);
      signal.throwIfAborted();
      return result;
    },
    { isolationLevel: "read committed" },
  );
}
