import { eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals, pipelines } from "@/db/schema";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import { toVisibleDeal } from "./dealAuth";
import type { NativeStageFailure, NativeStageSnapshot } from "./nativeStageTypes";

export function stageSnapshot(row: typeof deals.$inferSelect): NativeStageSnapshot {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    status: row.status,
    boardPosition: row.boardPosition,
    updatedAt: row.updatedAt.toISOString(),
    writeVersion: row.writeVersion,
  };
}
export function stageFailure(
  reason: NativeStageFailure["reason"],
  errorId?: string,
): NativeStageFailure {
  return { ok: false, reason, ...(errorId === undefined ? {} : { errorId }) };
}
// Always pipeline before deal. A read's unlocked hint is checked again after both locks;
// never chase another earlier-order pipeline while holding a deal after a concurrent transfer.
export async function lockStageDeal(tx: Db, id: string, pipelineId: string, write: boolean) {
  const [pipeline] = await tx
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .for("share");
  const query = tx.select().from(deals).where(eq(deals.id, id));
  const [deal] = await (write ? query.for("update") : query.for("share"));
  return { pipeline, deal };
}
export async function authorizeStageDeal(
  tx: Db,
  who: NativeSessionRef,
  locked: Awaited<ReturnType<typeof lockStageDeal>>,
  edit: boolean,
  signal: AbortSignal,
): Promise<NativeStageFailure | null> {
  const current = await currentNativeActor(tx, who, signal);
  if (current === null) return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
  const { pipeline, deal } = locked;
  if (
    pipeline === undefined ||
    pipeline.isArchived ||
    deal === undefined ||
    deal.pipelineId !== pipeline.id ||
    deal.deletedAt !== null ||
    deal.archivedAt !== null
  )
    return stageFailure("unavailable", ERROR_IDS.DEAL_NOT_FOUND);
  const visible = toVisibleDeal(deal, pipeline.visibilityGroupId);
  if (!canSee(current.actor, visible)) return stageFailure("unavailable", ERROR_IDS.DEAL_NOT_FOUND);
  if (edit && !can(current.actor, "deal.edit", visible))
    return stageFailure("denied", ERROR_IDS.PERM_DENIED);
  return null;
}
