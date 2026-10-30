import { eq, sql } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export interface ImportedLeadHistory {
  createdAt?: string | undefined;
  archived?: boolean | undefined;
}

export async function applyImportedLeadHistory(
  tx: DbOrTx,
  leadId: string,
  history: ImportedLeadHistory,
  signal: AbortSignal,
): Promise<void> {
  const patch: { createdAt?: Date; archivedAt?: ReturnType<typeof sql> } = {};
  if (history.createdAt !== undefined) patch.createdAt = new Date(history.createdAt);
  if (history.archived === true) patch.archivedAt = sql`now()`;
  if (Object.keys(patch).length === 0) return;
  signal.throwIfAborted();
  await tx.update(leads).set(patch).where(eq(leads.id, leadId));
}
