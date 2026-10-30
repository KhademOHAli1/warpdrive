import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export async function lockImportMutation(tx: DbOrTx, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('import_mutation'))`);
}
