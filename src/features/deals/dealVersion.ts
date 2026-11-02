import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Deal, deals } from "@/db/schema/deals";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";

export function dealVersionConflict(dealId?: string): AppError {
  return new AppError(ERROR_IDS.DEAL_PRECONDITION, "Deal changed; refresh before saving", {
    ...(dealId === undefined ? {} : { dealId }),
  });
}

// A legacy request is a conflict, never permission to fall back to a timestamp.
// Malformed present values remain subject to the ordinary boundary schema.
export function missingDealVersion(
  raw: unknown,
  fields: readonly string[] = ["expectedWriteVersion"],
): AppError | null {
  if (raw === null || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  return fields.some((field) => input[field] === undefined) ? dealVersionConflict() : null;
}

export async function readFinalDeal(db: DbOrTx, id: string, signal: AbortSignal): Promise<Deal> {
  signal.throwIfAborted();
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  signal.throwIfAborted();
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Deal disappeared before final acknowledgment", {
      dealId: id,
    });
  return row;
}

// Call only inside an authorized transaction. The lock remains until commit;
// checking equality without an UPDATE also protects logical no-op commands.
export async function lockDealWriteVersion(
  db: DbOrTx,
  id: string,
  expectedWriteVersion: string,
  signal: AbortSignal,
): Promise<Result<Deal, AppError>> {
  signal.throwIfAborted();
  const [row] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
    .for("update");
  signal.throwIfAborted();
  if (row === undefined || row.writeVersion !== expectedWriteVersion.toLowerCase())
    return err(dealVersionConflict(id));
  return ok(row);
}

export type DealActionSnapshot = Omit<Deal, "updatedAt"> & { updatedAt: string };

export function dealActionSnapshot(row: Deal): DealActionSnapshot {
  // Explicitly preserve the existing authorized Deal client shape. New database
  // columns must be reviewed here rather than being exposed by object spreading.
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    value: row.value,
    currency: row.currency,
    expectedCloseDate: row.expectedCloseDate,
    labels: row.labels,
    sourceChannel: row.sourceChannel,
    sourceChannelId: row.sourceChannelId,
    lostReason: row.lostReason,
    lostReasonId: row.lostReasonId,
    wonTime: row.wonTime,
    lostTime: row.lostTime,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    boardPosition: row.boardPosition,
    personId: row.personId,
    orgId: row.orgId,
    ownerId: row.ownerId,
    visibilityLevel: row.visibilityLevel,
    visibilityGroupId: row.visibilityGroupId,
    visibleToUserIds: row.visibleToUserIds,
    lastActivityAt: row.lastActivityAt,
    nextActivityAt: row.nextActivityAt,
    stageEnteredAt: row.stageEnteredAt,
    customFields: row.customFields,
    searchTsv: row.searchTsv,
    createdAt: row.createdAt,
    writeVersion: row.writeVersion,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt,
    archivedAt: row.archivedAt,
  };
}

// UUID spelling is not a second record. Conflicting aliases fail per-record;
// selecting the same ID twice never applies a command twice.
export function dealSelectionVersions(
  versions: Readonly<Record<string, string>>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const [id, version] of Object.entries(versions)) {
    const key = id.toLowerCase();
    const value = version.toLowerCase();
    const previous = result.get(key);
    result.set(key, previous === undefined || previous === value ? value : null);
  }
  return result;
}
