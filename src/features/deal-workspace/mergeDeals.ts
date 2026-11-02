// mergeDeals: merge source deal S into target deal T in ONE transaction. T is the survivor and
// KEEPS all of its own core field values (target-wins precedence; see the unit-D implementation
// notes); S contributes only its child rows, which are re-parented onto T (activities, notes,
// email threads, files, participants, followers, followers/participants deduped). S is then
// soft-deleted and the merge is logged on T. Both deals must be visible+editable by the actor, and
// each is CAS-locked on its writeVersion so a stale header cannot merge a concurrently-modified deal.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { BOARD_EVENT, dealChannel, dealMovedChannel } from "@/constants/boardChannels";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type Deal, deals } from "@/db/schema/deals";
import { recordChange } from "@/features/collaboration/changeLog";
import { loadEditableDeal } from "@/features/deals/dealAuth";
import {
  lockDealWriteVersion,
  missingDealVersion,
  readFinalDeal,
} from "@/features/deals/dealVersion";
import { lockImportMutation } from "@/features/import/importLock";
import { repointMappings } from "@/features/import/repointMappings";
import type { PermSetUser } from "@/features/permissions/effective";
import { publishBoardEvent } from "@/server/realtime/events";
import { err, ok, type Result } from "@/types/result";
import { repointDealChildren } from "./mergeReparent";

export const mergeDealsInput = z.object({
  targetDealId: z.string().uuid(),
  sourceDealId: z.string().uuid(),
  expectedTargetWriteVersion: z.string().uuid(),
  expectedSourceWriteVersion: z.string().uuid(),
  expectedTargetUpdatedAt: z.string().datetime().optional(), // metadata only
  expectedSourceUpdatedAt: z.string().datetime().optional(), // metadata only
});

// Thrown inside the transaction to roll the whole merge back when either CAS lock loses.
class MergeConflict extends Error {}

async function casTouch(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  id: string,
  expected: string,
): Promise<void> {
  const now = new Date();
  const [row] = await tx
    .update(deals)
    .set({ updatedAt: now })
    .where(and(eq(deals.id, id), isNull(deals.deletedAt), eq(deals.writeVersion, expected)))
    .returning({ id: deals.id });
  if (row === undefined) throw new MergeConflict();
}

export async function mergeDeals(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<{ targetId: string; deal: Deal }, AppError>> {
  const versionError = missingDealVersion(raw, [
    "expectedTargetWriteVersion",
    "expectedSourceWriteVersion",
  ]);
  if (versionError !== null) return err(versionError);
  const parsedInput = mergeDealsInput.parse(raw);
  const input = {
    ...parsedInput,
    targetDealId: parsedInput.targetDealId.toLowerCase(),
    sourceDealId: parsedInput.sourceDealId.toLowerCase(),
  };
  signal.throwIfAborted();

  if (input.targetDealId.toLowerCase() === input.sourceDealId.toLowerCase()) {
    return err(
      new AppError(ERROR_IDS.DEAL_MERGE_SAME, "Cannot merge a deal into itself", {
        dealId: input.targetDealId,
      }),
    );
  }

  // Gate visibility + edit on BOTH deals (404-on-invisible, PERM_DENIED-on-unowned).
  const target = await loadEditableDeal(db, actor, input.targetDealId, signal);
  if (!target.ok) return target;
  const source = await loadEditableDeal(db, actor, input.sourceDealId, signal);
  if (!source.ok) return source;
  signal.throwIfAborted();

  try {
    return await db.transaction(async (tx) => {
      await lockImportMutation(tx, signal);
      // Acquire both rows in UUID order before changing either, so reverse merges cannot deadlock.
      for (const item of [
        { id: input.targetDealId, version: input.expectedTargetWriteVersion },
        { id: input.sourceDealId, version: input.expectedSourceWriteVersion },
      ].sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()))) {
        const locked = await lockDealWriteVersion(tx, item.id, item.version, signal);
        if (!locked.ok) throw new MergeConflict();
      }
      await casTouch(tx, input.targetDealId, input.expectedTargetWriteVersion);
      const now = new Date();
      const [deleted] = await tx
        .update(deals)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(deals.id, input.sourceDealId),
            isNull(deals.deletedAt),
            eq(deals.writeVersion, input.expectedSourceWriteVersion),
          ),
        )
        .returning({ id: deals.id });
      if (deleted === undefined) throw new MergeConflict();

      await repointDealChildren(tx, input.sourceDealId, input.targetDealId, signal);
      await repointMappings(tx, "deal", input.targetDealId, input.sourceDealId, signal);

      await recordChange(
        tx,
        {
          entityType: "deal",
          entityId: input.targetDealId,
          field: "mergedDealId",
          oldValue: null,
          newValue: input.sourceDealId,
          actorId: actor.id,
        },
        signal,
      );

      // Realtime: T changed (absorbed children), S is gone. Notify each deal channel and the
      // pipeline channel(s) so open board/detail views refetch.
      await publishBoardEvent(
        tx,
        {
          channel: dealChannel(input.targetDealId),
          type: BOARD_EVENT.dealUpdated,
          actorId: actor.id,
          data: { dealId: input.targetDealId },
        },
        signal,
      );
      await publishBoardEvent(
        tx,
        {
          channel: dealChannel(input.sourceDealId),
          type: BOARD_EVENT.dealUpdated,
          actorId: actor.id,
          data: { dealId: input.sourceDealId },
        },
        signal,
      );
      await publishBoardEvent(
        tx,
        {
          channel: dealMovedChannel(source.value.deal.pipelineId),
          type: BOARD_EVENT.dealUpdated,
          actorId: actor.id,
          data: { dealId: input.sourceDealId, pipelineId: source.value.deal.pipelineId },
        },
        signal,
      );

      if (target.value.deal.pipelineId !== source.value.deal.pipelineId) {
        await publishBoardEvent(
          tx,
          {
            channel: dealMovedChannel(target.value.deal.pipelineId),
            type: BOARD_EVENT.dealUpdated,
            actorId: actor.id,
            data: { dealId: input.targetDealId, pipelineId: target.value.deal.pipelineId },
          },
          signal,
        );
      }

      return ok({
        targetId: input.targetDealId,
        deal: await readFinalDeal(tx, input.targetDealId, signal),
      });
    });
  } catch (e) {
    if (e instanceof MergeConflict) {
      return err(
        new AppError(ERROR_IDS.DEAL_PRECONDITION, "A deal changed before merge (stale)", {
          targetDealId: input.targetDealId,
          sourceDealId: input.sourceDealId,
        }),
      );
    }
    throw e;
  }
}
