import { TransactionRollbackError } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Result } from "@/types/result";

// Self-service has no reviewer capability, but needs the same Result rollback contract as the guard.
export async function identityTransaction<R extends Result<unknown, unknown>>(
  db: Db,
  signal: AbortSignal,
  effect: (tx: Db) => Promise<R>,
): Promise<R> {
  signal.throwIfAborted();
  let failed: R | undefined;
  try {
    return await db.transaction(async (tx) => {
      const result = await effect(tx);
      signal.throwIfAborted();
      if (!result.ok) {
        failed = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    if (failed !== undefined && error instanceof TransactionRollbackError) return failed;
    throw error;
  }
}
