import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockInventoryStock, postInventoryMovement } from "../../stock";
import { inventoryStockEvents, inventoryStockPositions } from "../schema";
import type { WarehouseOperationsCommand } from "./contracts";
import {
  inventoryStockEventDetails,
  inventoryStockInstallations,
  inventoryStockTransferLines,
  inventoryStockTransfers,
} from "./schema";
import {
  type AuditContext,
  addOperationEvent,
  failOperations,
  lockedItem,
  managedEndpoint,
  type OperationsActor,
  type Position,
  readPosition,
  type StockLocks,
  visiblePartPolicy,
} from "./shared";

type Correction = Extract<WarehouseOperationsCommand, { type: "correctStock" }>;
type Reversal = Extract<WarehouseOperationsCommand, { type: "reverseCorrection" }>;

async function guardAssemblyCount(tx: Db, position: Position, quantity: number) {
  if (quantity > position.onHand) {
    const [installed] = await tx
      .select({ id: inventoryStockInstallations.id })
      .from(inventoryStockInstallations)
      .where(
        and(
          eq(inventoryStockInstallations.componentPositionId, position.id),
          isNull(inventoryStockInstallations.removedEventId),
        ),
      )
      .limit(1);
    if (installed !== undefined) failOperations("conflict");
    const [retired] = await tx
      .select({ id: inventoryStockEvents.id })
      .from(inventoryStockEvents)
      .where(
        and(
          eq(inventoryStockEvents.positionId, position.id),
          eq(inventoryStockEvents.kind, "stock-disassemble"),
          lt(inventoryStockEvents.onHandDelta, 0),
        ),
      )
      .limit(1);
    if (retired !== undefined) failOperations("conflict");
  }
  if (quantity === 0 && position.onHand > 0) {
    const [populated] = await tx
      .select({ id: inventoryStockInstallations.id })
      .from(inventoryStockInstallations)
      .where(
        and(
          eq(inventoryStockInstallations.assemblyPositionId, position.id),
          isNull(inventoryStockInstallations.removedEventId),
        ),
      )
      .limit(1);
    if (populated !== undefined) failOperations("conflict");
  }
}

async function validateCount(tx: Db, position: Position, quantity: number, trackable: boolean) {
  if (quantity < position.reserved) failOperations("insufficientStock");
  if (position.serial === null) {
    if (trackable && quantity > position.onHand) failOperations("invalid");
    return;
  }
  if (quantity > 1) failOperations("invalid");
  const [active] = await tx
    .select({ id: inventoryStockTransferLines.id })
    .from(inventoryStockTransferLines)
    .innerJoin(
      inventoryStockTransfers,
      eq(inventoryStockTransfers.id, inventoryStockTransferLines.transferId),
    )
    .where(
      and(
        eq(inventoryStockTransferLines.sourcePositionId, position.id),
        eq(inventoryStockTransfers.status, "in_transit"),
        lt(inventoryStockTransferLines.received, inventoryStockTransferLines.quantity),
      ),
    )
    .limit(1);
  if (active !== undefined) failOperations("conflict");
  await guardAssemblyCount(tx, position, quantity);
}

async function postCorrection(
  tx: Db,
  actor: OperationsActor,
  context: AuditContext,
  position: Position,
  stock: StockLocks,
  countedQuantity: number,
  reversesEventId: string | null,
) {
  const kind = reversesEventId === null ? "correction" : "correction-reversal";
  const onHandDelta = countedQuantity - position.onHand;
  const movementId = await postInventoryMovement(tx, lockedItem(stock, position.itemId), {
    kind,
    onHandDelta,
    reservedDelta: 0,
    actorId: actor.id,
    requestId: context.requestId,
  });
  if (onHandDelta !== 0) {
    await tx
      .update(inventoryStockPositions)
      .set({ onHand: countedQuantity })
      .where(eq(inventoryStockPositions.id, position.id));
  }
  return addOperationEvent(
    tx,
    actor,
    context,
    {
      itemId: position.itemId,
      positionId: position.id,
      kind,
      onHandDelta,
      movementId,
      state: position.state,
    },
    {
      siteId: position.siteId,
      locationId: position.locationId,
      previousOnHand: position.onHand,
      reversesEventId,
    },
  );
}

export async function correctStock(tx: Db, actor: OperationsActor, command: Correction) {
  const hint = await readPosition(tx, command.positionId);
  managedEndpoint(actor, hint.locationId);
  const policy = await visiblePartPolicy(tx, actor, hint.itemId);
  const stock = await lockInventoryStock(tx, [hint.itemId]);
  const position = await readPosition(tx, command.positionId);
  if (position.locationId !== command.locationId || position.onHand !== command.expectedOnHand) {
    failOperations("stale");
  }
  managedEndpoint(actor, position.locationId);
  if (position.buildOutputId !== null && command.countedQuantity > position.onHand) {
    failOperations("incompatibleStock");
  }
  await validateCount(tx, position, command.countedQuantity, policy.flags.trackable);
  return postCorrection(tx, actor, command, position, stock, command.countedQuantity, null);
}

async function originalCorrection(tx: Db, actor: OperationsActor, eventId: string) {
  const [found] = await tx
    .select({ event: inventoryStockEvents, details: inventoryStockEventDetails })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(and(eq(inventoryStockEvents.id, eventId), eq(inventoryStockEvents.kind, "correction")));
  if (
    found === undefined ||
    found.event.positionId === null ||
    found.details.locationId === null ||
    found.details.previousOnHand === null
  ) {
    failOperations("unavailable");
  }
  const { event, details } = found;
  const positionId = event.positionId;
  const locationId = details.locationId;
  const previousOnHand = details.previousOnHand;
  if (positionId === null || locationId === null || previousOnHand === null)
    failOperations("unavailable");
  managedEndpoint(actor, locationId);
  return {
    itemId: event.itemId,
    onHandDelta: event.onHandDelta,
    positionId,
    locationId,
    previousOnHand,
    sequence: details.sequence,
  };
}

async function requireUnreversed(tx: Db, eventId: string, positionId: string, sequence: bigint) {
  const [reversed] = await tx
    .select({ eventId: inventoryStockEventDetails.eventId })
    .from(inventoryStockEventDetails)
    .where(eq(inventoryStockEventDetails.reversesEventId, eventId))
    .limit(1);
  if (reversed !== undefined) failOperations("alreadyReversed");
  const [later] = await tx
    .select({ id: inventoryStockEvents.id })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(
      and(
        gt(inventoryStockEventDetails.sequence, sequence),
        ne(inventoryStockEvents.onHandDelta, 0),
        or(
          eq(inventoryStockEvents.positionId, positionId),
          and(
            eq(inventoryStockEvents.sourcePositionId, positionId),
            eq(inventoryStockEvents.kind, "state"),
          ),
        ),
      ),
    )
    .limit(1);
  if (later !== undefined) failOperations("stale");
}

export async function reverseCorrection(tx: Db, actor: OperationsActor, command: Reversal) {
  const original = await originalCorrection(tx, actor, command.eventId);
  const policy = await visiblePartPolicy(tx, actor, original.itemId);
  const stock = await lockInventoryStock(tx, [original.itemId]);
  await requireUnreversed(tx, command.eventId, original.positionId, original.sequence);
  const position = await readPosition(tx, original.positionId);
  if (
    original.onHandDelta === 0 ||
    position.locationId !== original.locationId ||
    position.onHand !== command.expectedOnHand ||
    position.onHand !== original.previousOnHand + original.onHandDelta
  ) {
    failOperations("stale");
  }
  await validateCount(tx, position, original.previousOnHand, policy.flags.trackable);
  return postCorrection(
    tx,
    actor,
    command,
    position,
    stock,
    original.previousOnHand,
    command.eventId,
  );
}
