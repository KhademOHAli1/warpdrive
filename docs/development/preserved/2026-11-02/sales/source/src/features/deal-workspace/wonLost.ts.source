// markWon / markLost: dedicated won/lost workspace actions.
// Reuses loadEditableDeal (the single shared deal-auth authority) and mirrors the
// publishBoardEvent pattern from updateDeal so the board reflects transitions.
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { BOARD_EVENT, dealChannel, dealMovedChannel } from "@/constants/boardChannels";
import { CHANGE_FIELD_STATUS } from "@/constants/changeLogFields";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals, lostReasons } from "@/db/schema";
import type { Deal } from "@/db/schema/deals";
import { recordChange } from "@/features/collaboration/changeLog";
import { loadEditableDeal } from "@/features/deals/dealAuth";
import {
  dealVersionConflict,
  missingDealVersion,
  readFinalDeal,
} from "@/features/deals/dealVersion";
import { versionedDealInput } from "@/features/deals/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { publishBoardEvent } from "@/server/realtime/events";
import { err, ok, type Result } from "@/types/result";
import { markLostInput } from "./dealCloseSchemas";
import { lostStatusValue } from "./lostStatusValue";

export async function markWon(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<Deal, AppError>> {
  const versionError = missingDealVersion(raw);
  if (versionError !== null) return err(versionError);
  const input = versionedDealInput.parse(raw);
  const dealId = input.dealId;
  return db.transaction(async (tx) => {
    const editable = await loadEditableDeal(tx, actor, dealId, signal);
    if (editable.ok === false) return editable;

    const oldStatus = editable.value.deal.status;

    const [row] = await tx
      .update(deals)
      .set({
        status: "won",
        wonTime: new Date(),
        lostTime: null,
        lostReason: null,
        lostReasonId: null,
      })
      .where(and(eq(deals.id, dealId), eq(deals.writeVersion, input.expectedWriteVersion)))
      .returning();

    if (row === undefined) return err(dealVersionConflict(dealId));

    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: dealId,
        field: "status",
        oldValue: oldStatus,
        newValue: "won",
        actorId: actor.id,
      },
      signal,
    );

    await publishBoardEvent(
      tx,
      {
        channel: dealChannel(dealId),
        type: BOARD_EVENT.dealUpdated,
        actorId: actor.id,
        data: { dealId },
      },
      signal,
    );

    return ok(await readFinalDeal(tx, row.id, signal));
  });
}

// Reopen a won/lost deal back to open (recovery from a mis-click, since Won/Convert commit on a
// single click). Clears the won/lost timestamps and reason, mirroring updateDeal's open transition.
// Reuses loadEditableDeal so the same edit-permission gate applies as Won/Lost.
export async function reopenDeal(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<Deal, AppError>> {
  const versionError = missingDealVersion(raw);
  if (versionError !== null) return err(versionError);
  const input = versionedDealInput.parse(raw);
  const dealId = input.dealId;
  return db.transaction(async (tx) => {
    const editable = await loadEditableDeal(tx, actor, dealId, signal);
    if (editable.ok === false) return editable;

    const oldStatus = editable.value.deal.status;

    const [row] = await tx
      .update(deals)
      .set({ status: "open", wonTime: null, lostTime: null, lostReason: null, lostReasonId: null })
      .where(and(eq(deals.id, dealId), eq(deals.writeVersion, input.expectedWriteVersion)))
      .returning();

    if (row === undefined) return err(dealVersionConflict(dealId));

    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: dealId,
        field: "status",
        oldValue: oldStatus,
        newValue: "open",
        actorId: actor.id,
      },
      signal,
    );

    await publishBoardEvent(
      tx,
      {
        channel: dealChannel(dealId),
        type: BOARD_EVENT.dealUpdated,
        actorId: actor.id,
        data: { dealId },
      },
      signal,
    );

    // ALSO publish on the pipeline channel: the board subscribes only to pipeline:<id>
    // (useBoardRealtime), and a reopened deal becomes open again, so without this it would not
    // reappear on an open board until a manual refresh. Mirrors deleteDeal's dual publish.
    await publishBoardEvent(
      tx,
      {
        channel: dealMovedChannel(row.pipelineId),
        type: BOARD_EVENT.dealUpdated,
        actorId: actor.id,
        data: { dealId, pipelineId: row.pipelineId },
      },
      signal,
    );

    return ok(await readFinalDeal(tx, row.id, signal));
  });
}

export type MarkLostReasonInput = Omit<z.infer<typeof markLostInput>, "dealId">;

export async function markLost(
  db: Db,
  actor: PermSetUser,
  dealId: string,
  raw: MarkLostReasonInput,
  signal: AbortSignal,
): Promise<Result<Deal, AppError>> {
  const versionError = missingDealVersion(raw);
  if (versionError !== null) return err(versionError);
  const input = markLostInput.parse({ dealId, ...raw });
  return db.transaction(async (tx) => {
    const editable = await loadEditableDeal(tx, actor, dealId, signal);
    if (editable.ok === false) return editable;

    const oldStatus = editable.value.deal.status;

    // Validate the predefined reason only when one was chosen. A missing reason is allowed
    // (Pipedrive parity: a deal can be marked lost with a free-text reason, or none at all).
    let reasonName: string | null = null;
    if (input.lostReasonId !== null) {
      const [reason] = await tx
        .select()
        .from(lostReasons)
        .where(and(eq(lostReasons.id, input.lostReasonId), isNull(lostReasons.archivedAt)));

      if (reason === undefined) {
        return err(
          new AppError(
            ERROR_IDS.DEAL_LOST_REASON_INVALID,
            "Lost reason does not exist or is archived",
            { lostReasonId: input.lostReasonId },
          ),
        );
      }
      reasonName = reason.name;
    }

    const [row] = await tx
      .update(deals)
      .set({
        status: "lost",
        lostTime: new Date(),
        wonTime: null,
        lostReasonId: input.lostReasonId,
        lostReason: input.lostReason,
      })
      .where(and(eq(deals.id, dealId), eq(deals.writeVersion, input.expectedWriteVersion)))
      .returning();

    if (row === undefined) return err(dealVersionConflict(dealId));

    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: dealId,
        field: CHANGE_FIELD_STATUS,
        oldValue: oldStatus,
        // The reason NAME, not its id: the history row is read straight out of the log and
        // nothing downstream resolves ids.
        newValue: lostStatusValue(reasonName, input.lostReason),
        actorId: actor.id,
      },
      signal,
    );

    await publishBoardEvent(
      tx,
      {
        channel: dealChannel(dealId),
        type: BOARD_EVENT.dealUpdated,
        actorId: actor.id,
        data: { dealId },
      },
      signal,
    );

    return ok(await readFinalDeal(tx, row.id, signal));
  });
}
