// moveDeal: compare-and-swap stage transition with realtime event (ops spec A5).
// Native authority is rebound separately from the displayed deal revision.
import { and, eq, isNull, sql } from "drizzle-orm";
import { BOARD_EVENT, dealMovedChannel } from "@/constants/boardChannels";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals } from "@/db/schema/deals";
import { pipelines } from "@/db/schema/pipelines";
import { stages } from "@/db/schema/stages";
import { recordChange } from "@/features/collaboration/changeLog";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { publishBoardEvent } from "@/server/realtime/events";
import { err, ok, type Result } from "@/types/result";
import { midpoint } from "./boardPosition";
import { loadEditableDeal } from "./dealAuth";
import { admitLockedDealMove, type NativeMoveSession, reloadMoveActor } from "./dealMoveAuthority";
import { dealVersionConflict, missingDealVersion, readFinalDeal } from "./dealVersion";
import { dealMoveInput } from "./schemas";

export async function moveDeal(
  db: DbOrTx,
  session: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
  // Server-only binding from createContext().session; never part of the client DTO.
  nativeSession?: NativeMoveSession,
): Promise<Result<typeof deals.$inferSelect, AppError>> {
  const versionError = missingDealVersion(raw);
  if (versionError !== null) return err(versionError);
  const input = dealMoveInput.parse(raw);
  signal.throwIfAborted();

  const initialActor = await reloadMoveActor(db, session.id, nativeSession, signal);
  if (!initialActor.ok) return initialActor;
  const editable = await loadEditableDeal(db, initialActor.value, input.dealId, signal);
  if (!editable.ok) return editable;
  const preflight = editable.value.deal;
  const [stage] = await db
    .select({ id: stages.id })
    .from(stages)
    .where(and(eq(stages.id, input.toStageId), eq(stages.pipelineId, preflight.pipelineId)));
  signal.throwIfAborted();
  if (stage === undefined)
    return err(
      new AppError(ERROR_IDS.DEAL_STAGE_MISMATCH, "Stage does not belong to the deal's pipeline", {
        stageId: input.toStageId,
        pipelineId: preflight.pipelineId,
      }),
    );

  const position = midpoint(input.beforePosition, input.afterPosition);
  let rejectedAfterWrite: AppError | undefined;
  try {
    return await db.transaction(async (tx) => {
      // Root integration slot: acquire the one shared authority fence before domain locks,
      // with the same order used by every participating authority writer. Hold through commit.
      // This draft deliberately does not invent a local substitute for that shared fence.
      const [pipeline] = await tx
        .select({ id: pipelines.id, isArchived: pipelines.isArchived })
        .from(pipelines)
        .where(eq(pipelines.id, preflight.pipelineId))
        .for("share");
      signal.throwIfAborted();
      if (pipeline === undefined || pipeline.isArchived)
        return err(
          new AppError(ERROR_IDS.DEAL_NOT_FOUND, "Deal not found", { dealId: input.dealId }),
        );

      // Pipeline always precedes deal. If the actual deal moved to another pipeline,
      // reject rather than acquire a different pipeline lock while holding its deal lock.
      const [deal] = await tx
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.dealId), isNull(deals.deletedAt)))
        .for("update");
      signal.throwIfAborted();
      if (deal === undefined)
        return err(
          new AppError(ERROR_IDS.DEAL_NOT_FOUND, "Deal not found", { dealId: input.dealId }),
        );
      if (
        deal.pipelineId !== pipeline.id ||
        deal.writeVersion !== input.expectedWriteVersion.toLowerCase()
      )
        return err(dealVersionConflict(input.dealId));

      // Reload stored flags, direct groups and managed teams after the pipeline/deal waits.
      // Admission uses the locked preimage and current source/target stage membership.
      const admitted = await admitLockedDealMove(
        tx,
        session.id,
        nativeSession,
        deal,
        input.toStageId,
        signal,
      );
      if (!admitted.ok) return admitted;
      const updated = await tx
        .update(deals)
        .set({
          stageId: input.toStageId,
          boardPosition: position,
          stageEnteredAt: sql<Date>`CASE
            WHEN ${deals.stageId} = ${input.toStageId} THEN ${deals.stageEnteredAt}
            ELSE ${new Date().toISOString()}
          END`,
          updatedAt: new Date(),
        })
        .where(and(eq(deals.id, input.dealId), eq(deals.writeVersion, input.expectedWriteVersion)))
        .returning();
      signal.throwIfAborted();
      if (updated.length === 0) {
        rejectedAfterWrite = dealVersionConflict(input.dealId);
        throw rejectedAfterWrite;
      }
      const row = updated[0];
      if (row === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "moveDeal: UPDATE RETURNING produced undefined");

      // UPDATE can wait on other rows (including FK checks). A later denial must roll back.
      const afterWrite = await admitLockedDealMove(
        tx,
        session.id,
        nativeSession,
        deal,
        input.toStageId,
        signal,
      );
      if (!afterWrite.ok) {
        rejectedAfterWrite = afterWrite.error;
        throw rejectedAfterWrite;
      }
      if (row.stageId !== deal.stageId)
        await recordChange(
          tx,
          {
            entityType: "deal",
            entityId: input.dealId,
            field: "stageId",
            oldValue: deal.stageId,
            newValue: row.stageId,
            actorId: afterWrite.value.id,
          },
          signal,
        );
      await publishBoardEvent(
        tx,
        {
          channel: dealMovedChannel(deal.pipelineId),
          type: BOARD_EVENT.dealMoved,
          actorId: afterWrite.value.id,
          data: {
            dealId: row.id,
            fromStageId: deal.stageId,
            toStageId: row.stageId,
            boardPosition: row.boardPosition,
          },
        },
        signal,
      );
      const finalDeal = await readFinalDeal(tx, row.id, signal);
      // Root's clock-correct final native verifier must bind at this checkpoint, after
      // audit/event/final-read waits, under the shared fence retained until commit.
      const finalAdmission = await admitLockedDealMove(
        tx,
        session.id,
        nativeSession,
        deal,
        input.toStageId,
        signal,
      );
      if (!finalAdmission.ok) {
        rejectedAfterWrite = finalAdmission.error;
        throw rejectedAfterWrite;
      }
      signal.throwIfAborted();
      return ok(finalDeal);
    });
  } catch (error) {
    signal.throwIfAborted();
    // Convert only our deliberate denial after transaction rollback. Preserve other failures.
    if (rejectedAfterWrite !== undefined && error === rejectedAfterWrite)
      return err(rejectedAfterWrite);
    throw error;
  }
}
