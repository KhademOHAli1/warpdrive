import { TransactionRollbackError } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, type Result } from "@/types/result";
import { currentPrivacySession, type PrivacyActor } from "./authoritySession";

// Self-service has no reviewer capability, but needs the same Result rollback contract as the guard.
export async function identityTransaction<R extends Result<unknown, unknown>>(
  db: Db,
  actor: PrivacyActor,
  signal: AbortSignal,
  effect: (tx: Db) => Promise<R>,
): Promise<R | { ok: false; error: "forbidden" }> {
  signal.throwIfAborted();
  let failed: R | { ok: false; error: "forbidden" } | undefined;
  try {
    return await db.transaction(async (tx) => {
      await lockAuthAccount(tx, actor.userId, signal);
      await lockMcpGrants(tx, signal);
      if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden" as const);
      const result = await effect(tx);
      signal.throwIfAborted();
      if (!result.ok) {
        failed = result;
        tx.rollback();
      }
      // Row locks preserve authority values, but do not stop time-based session expiry.
      const sessionCurrent = await currentPrivacySession(tx, actor, signal);
      signal.throwIfAborted();
      if (!sessionCurrent) {
        failed = err("forbidden" as const);
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    // Cancellation can arrive with the driver's rollback acknowledgement.
    signal.throwIfAborted();
    if (failed !== undefined && error instanceof TransactionRollbackError) return failed;
    throw error;
  }
}
