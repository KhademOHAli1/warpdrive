import { and, eq, isNull } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { leadVisibilityClause } from "./visibility";

export async function isLeadVisibleToSession(
  db: DbOrTx,
  session: EntityCreateSession,
  leadId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt), leadVisibilityClause(session)));
  signal.throwIfAborted();
  return rows.length > 0;
}
