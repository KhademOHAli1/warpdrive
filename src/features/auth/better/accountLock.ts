import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

// Call inside the transaction BEFORE locking users/factors, and keep the same handle for
// verification or recovery. The lock is shared across HTTP replicas and host-operator tools.
export async function lockAuthAccount(db: Db, userId: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth-methods'), hashtext(${userId}))`,
  );
  signal.throwIfAborted();
}
