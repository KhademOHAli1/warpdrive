import { eq, inArray } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Deal, pipelines, stages } from "@/db/schema";
import { loadLiveSessionById } from "@/features/auth/session";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { AppContext } from "@/server/trpc/context";
import { err, ok, type Result } from "@/types/result";
import { toVisibleDeal } from "./dealAuth";

// Only the server action binds this from genuine createContext().session.
// Structural typing or a caller-supplied AppContext is not proof of native provenance.
export type NativeMoveSession = NonNullable<AppContext["session"]>;

export async function reloadMoveActor(
  db: DbOrTx,
  actorId: string,
  nativeSession: NativeMoveSession | undefined,
  signal: AbortSignal,
): Promise<Result<PermSetUser, AppError>> {
  signal.throwIfAborted();
  if (nativeSession !== undefined) {
    if (nativeSession.userId !== actorId || nativeSession.sessionId.startsWith("mcp:"))
      return err(new AppError(ERROR_IDS.AUTH_SESSION_DEAD, "Native session is unavailable"));
    // No-touch liveness lookup of an already-authenticated internal ID. It never
    // authenticates a new caller, adds MFA, or refreshes idle-session timestamps.
    // IMPORTANT: this legacy helper uses transaction-start now() for SQL expiry.
    // Root must replace/bind its clock-correct final verifier before authority acceptance.
    const live = await loadLiveSessionById(db, nativeSession.sessionId, signal);
    if (
      !live.ok ||
      live.value.userId !== nativeSession.userId ||
      live.value.sessionId !== nativeSession.sessionId
    )
      return err(new AppError(ERROR_IDS.AUTH_SESSION_DEAD, "Native session is unavailable"));
  }
  // The trusted server caller supplies identity; fabricated flags are never authority.
  const actor = await hydrateActor(db, actorId, signal);
  signal.throwIfAborted();
  if (actor === null)
    return err(new AppError(ERROR_IDS.PERM_DENIED, "Not permitted to edit this deal"));
  return ok(actor);
}

// Call with the pipeline share lock and the actual deal row lock held by moveDeal.
// These reads create checkpoints, not a substitute for Root's shared authority fence.
export async function admitLockedDealMove(
  db: DbOrTx,
  actorId: string,
  nativeSession: NativeMoveSession | undefined,
  deal: Deal,
  toStageId: string,
  signal: AbortSignal,
): Promise<Result<PermSetUser, AppError>> {
  signal.throwIfAborted();
  const [pipeline] = await db
    .select({ visibilityGroupId: pipelines.visibilityGroupId, isArchived: pipelines.isArchived })
    .from(pipelines)
    .where(eq(pipelines.id, deal.pipelineId));
  signal.throwIfAborted();
  if (pipeline === undefined || pipeline.isArchived)
    return err(new AppError(ERROR_IDS.DEAL_NOT_FOUND, "Deal not found", { dealId: deal.id }));
  const targetStageId = toStageId.toLowerCase();
  const currentStages = await db
    .select({ id: stages.id, pipelineId: stages.pipelineId })
    .from(stages)
    .where(inArray(stages.id, [deal.stageId, targetStageId]));
  signal.throwIfAborted();
  const currentActor = await reloadMoveActor(db, actorId, nativeSession, signal);
  if (!currentActor.ok) return currentActor;
  const visible = toVisibleDeal(deal, pipeline.visibilityGroupId);
  if (!canSee(currentActor.value, visible))
    return err(
      new AppError(ERROR_IDS.DEAL_NOT_FOUND, "Deal not found or not visible", { dealId: deal.id }),
    );
  if (!can(currentActor.value, "deal.edit", visible))
    return err(
      new AppError(ERROR_IDS.PERM_DENIED, "Not permitted to edit this deal", {
        userId: actorId,
        dealId: deal.id,
      }),
    );
  if (
    !currentStages.some(
      (stage) => stage.id === deal.stageId && stage.pipelineId === deal.pipelineId,
    ) ||
    !currentStages.some(
      (stage) => stage.id === targetStageId && stage.pipelineId === deal.pipelineId,
    )
  )
    return err(
      new AppError(ERROR_IDS.DEAL_STAGE_MISMATCH, "Stage does not belong to the deal's pipeline", {
        stageId: toStageId,
        pipelineId: deal.pipelineId,
      }),
    );
  return ok(currentActor.value);
}
