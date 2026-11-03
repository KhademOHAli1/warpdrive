import { and, eq, sql } from "drizzle-orm";
import { BOARD_EVENT, dealMovedChannel } from "@/constants/boardChannels";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals, stages } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { recordChange } from "@/features/collaboration/changeLog";
import { publishBoardEvent } from "@/server/realtime/events";
import { midpoint } from "./boardPosition";
import {
  authorizeStageDeal,
  lockStageDeal,
  stageFailure,
  stageSnapshot,
} from "./nativeStageAccess";
import {
  type NativeStageFailure,
  type NativeStageMoveResult,
  type NativeStageReadResult,
  nativeStageMoveInput,
  nativeStageReadInput,
} from "./nativeStageTypes";

class StageRollback extends AppError {
  constructor(readonly result: NativeStageFailure) {
    super(ERROR_IDS.DB_WRITE_FAILED, "Native stage move rolled back");
  }
}

// Unknown database/commit/transport errors escape. UUID CAS is not a command receipt:
// after an unknown response the client may only explicitly read current state, not replay.
export async function moveNativeDealStage(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<NativeStageMoveResult> {
  const parsed = nativeStageMoveInput.safeParse(raw);
  if (!parsed.success) return stageFailure("invalid");
  const input = parsed.data;
  if (input.expectedActorId !== who.userId.toLowerCase())
    return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
  try {
    return await withCurrentAuthority(
      db,
      "read",
      signal,
      async (tx): Promise<NativeStageMoveResult> => {
        if ((await currentNativeActor(tx, who, signal)) === null)
          return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
        const locked = await lockStageDeal(tx, input.dealId, input.pipelineId, true);
        const denied = await authorizeStageDeal(tx, who, locked, true, signal);
        if (denied !== null) return denied;
        const previous = locked.deal;
        if (previous === undefined)
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing locked deal");
        if (previous.writeVersion !== input.expectedWriteVersion)
          return stageFailure("conflict", ERROR_IDS.DEAL_PRECONDITION);
        const [stage] = await tx
          .select({ id: stages.id })
          .from(stages)
          .where(and(eq(stages.id, input.toStageId), eq(stages.pipelineId, input.pipelineId)))
          .for("share");
        signal.throwIfAborted();
        if (stage === undefined) return stageFailure("unavailable", ERROR_IDS.DEAL_STAGE_MISMATCH);
        // Target-stage waits can outlive a session. Rehydrate and sample PG wall time after them.
        const afterWait = await authorizeStageDeal(tx, who, locked, true, signal);
        if (afterWait !== null) return afterWait;
        const [row] = await tx
          .update(deals)
          .set({
            stageId: input.toStageId,
            boardPosition: midpoint(input.beforePosition, input.afterPosition),
            stageEnteredAt: sql`CASE WHEN ${deals.stageId} = ${input.toStageId}
          THEN ${deals.stageEnteredAt} ELSE clock_timestamp() END`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(eq(deals.id, input.dealId), eq(deals.writeVersion, input.expectedWriteVersion)),
          )
          .returning();
        if (row === undefined) return stageFailure("conflict", ERROR_IDS.DEAL_PRECONDITION);
        if (row.stageId !== previous.stageId)
          await recordChange(
            tx,
            {
              entityType: "deal",
              entityId: row.id,
              field: "stageId",
              oldValue: previous.stageId,
              newValue: row.stageId,
              actorId: who.userId,
            },
            signal,
          );
        await publishBoardEvent(
          tx,
          {
            channel: dealMovedChannel(row.pipelineId),
            type: BOARD_EVENT.dealMoved,
            actorId: who.userId,
            data: {
              dealId: row.id,
              fromStageId: previous.stageId,
              toStageId: row.stageId,
              boardPosition: row.boardPosition,
            },
          },
          signal,
        );
        // Denial after effects MUST roll back audit, channel version and row, not commit an Err.
        const final = await authorizeStageDeal(tx, who, { ...locked, deal: row }, true, signal);
        if (final !== null) throw new StageRollback(final);
        signal.throwIfAborted();
        return { ok: true, deal: stageSnapshot(row) };
      },
    );
  } catch (error) {
    if (error instanceof StageRollback) return error.result;
    throw error;
  }
}

export async function readNativeDealStage(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<NativeStageReadResult> {
  const parsed = nativeStageReadInput.safeParse(raw);
  if (!parsed.success) return stageFailure("invalid");
  const input = parsed.data;
  if (input.expectedActorId !== who.userId.toLowerCase())
    return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
  return withCurrentAuthority(db, "read", signal, async (tx): Promise<NativeStageReadResult> => {
    if ((await currentNativeActor(tx, who, signal)) === null)
      return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
    const [hint] = await tx
      .select({ pipelineId: deals.pipelineId })
      .from(deals)
      .where(eq(deals.id, input.dealId));
    if (hint === undefined) {
      if ((await currentNativeActor(tx, who, signal)) === null)
        return stageFailure("denied", ERROR_IDS.AUTH_SESSION_DEAD);
      return { ok: true, deal: null };
    }
    const locked = await lockStageDeal(tx, input.dealId, hint.pipelineId, false);
    const denied = await authorizeStageDeal(tx, who, locked, false, signal);
    if (
      denied?.reason === "unavailable" &&
      locked.deal !== undefined &&
      locked.deal.pipelineId !== hint.pipelineId
    )
      return stageFailure("conflict", ERROR_IDS.DEAL_PRECONDITION);
    if (denied?.reason === "unavailable") return { ok: true, deal: null };
    if (denied !== null) return denied;
    return { ok: true, deal: locked.deal === undefined ? null : stageSnapshot(locked.deal) };
  });
}
