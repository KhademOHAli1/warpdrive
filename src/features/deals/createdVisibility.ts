import { sql } from "drizzle-orm";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { dealVisibilityClause } from "./visibility";

export async function isDealVisibleToSession(
  db: DbOrTx,
  session: EntityCreateSession,
  dealId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    WHERE d.id = ${dealId} AND d.deleted_at IS NULL AND ${dealVisibilityClause(session)}
    LIMIT 1
  `);
  signal.throwIfAborted();
  return (result as unknown as { rows: unknown[] }).rows.length > 0;
}
