import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines } from "@/db/schema";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import type { NativeDealAcknowledgement } from "./nativeCreateTypes";
import { dealVisibilityClause } from "./visibility";

// Never lock a receipt before its deal: hard-delete holds deal then updates receipt via FK.
// Return a current protected row/token snapshot; the later board read still masks contacts.
export async function readNativeCreatedDeal(
  tx: Db,
  session: EntityCreateSession,
  id: string | null,
  signal: AbortSignal,
): Promise<{ deal: NativeDealAcknowledgement | null; moved: boolean }> {
  if (id === null) return { deal: null, moved: false };
  const [hint] = await tx
    .select({ pipelineId: deals.pipelineId })
    .from(deals)
    .where(eq(deals.id, id));
  if (hint === undefined) return { deal: null, moved: false };
  await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.id, hint.pipelineId))
    .for("share");
  const [locked] = await tx
    .select({ pipelineId: deals.pipelineId })
    .from(deals)
    .where(eq(deals.id, id))
    .for("share");
  signal.throwIfAborted();
  if (locked === undefined) return { deal: null, moved: false };
  // Do not acquire another earlier-order pipeline lock while holding this deal.
  if (locked.pipelineId !== hint.pipelineId) return { deal: null, moved: true };
  const result = await tx.execute<{
    id: string;
    updatedAt: string | Date;
    writeVersion: string;
  }>(sql`
    SELECT d.id, d.updated_at AS "updatedAt", d.write_version AS "writeVersion"
    FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
    WHERE d.id = ${id} AND d.deleted_at IS NULL AND d.archived_at IS NULL
      AND p.is_archived = false AND ${dealVisibilityClause(session)}
  `);
  signal.throwIfAborted();
  const row = result.rows[0];
  return {
    deal:
      row === undefined
        ? null
        : {
            id: row.id,
            updatedAt: (row.updatedAt instanceof Date
              ? row.updatedAt
              : new Date(row.updatedAt)
            ).toISOString(),
            writeVersion: row.writeVersion,
          },
    moved: false,
  };
}
