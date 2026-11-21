import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockInventoryStock, postInventoryMovement } from "../../stock";
import { inventoryStockPositions } from "../schema";
import type { WarehouseOperationsCommand } from "./contracts";
import {
  inventoryStockTransferLines,
  inventoryStockTransfers,
  type WarehouseTransferStatus,
} from "./schema";
import {
  type AuditContext,
  addOperationEvent,
  type Endpoint,
  failOperations,
  lockedItem,
  managedEndpoint,
  type OperationsActor,
  type Position,
  readPosition,
  requireVisibleParts,
  type StockLocks,
} from "./shared";

type NewTransfer = Extract<WarehouseOperationsCommand, { type: "createTransfer" }>;
type TransferChange = Extract<WarehouseOperationsCommand, { id: string }>;
type Receipt = Extract<WarehouseOperationsCommand, { type: "receiveTransfer" }>;
type Transfer = typeof inventoryStockTransfers.$inferSelect;
type TransferLine = typeof inventoryStockTransferLines.$inferSelect;

function onSource(position: Position, source: Endpoint) {
  return position.siteId === source.siteId && position.locationId === source.locationId;
}

function stockIdentity({ lot, serial, expiryDate, state, ownerOrganizationId }: Position) {
  return { lot, serial, expiryDate, state, ownerOrganizationId };
}

const originalSource = (transfer: Transfer): Endpoint => ({
  siteId: transfer.sourceSiteId,
  locationId: transfer.sourceLocationId,
});
const originalDestination = (transfer: Transfer): Endpoint => ({
  siteId: transfer.destinationSiteId,
  locationId: transfer.destinationLocationId,
});

function requireTransferScope(actor: OperationsActor, transfer: Transfer, active: boolean) {
  managedEndpoint(actor, transfer.sourceLocationId, active);
  managedEndpoint(actor, transfer.destinationLocationId, active);
}

async function transferLines(tx: Db, transferId: string) {
  return tx
    .select()
    .from(inventoryStockTransferLines)
    .where(eq(inventoryStockTransferLines.transferId, transferId));
}

/** Replays still require both manager grants and visibility of the original items. */
export async function requireTransferReplay(tx: Db, actor: OperationsActor, id: string) {
  const [transfer] = await tx
    .select()
    .from(inventoryStockTransfers)
    .where(eq(inventoryStockTransfers.id, id));
  if (transfer === undefined) failOperations("unavailable");
  requireTransferScope(actor, transfer, false);
  await requireVisibleParts(
    tx,
    actor,
    (await transferLines(tx, id)).map(({ itemId }) => itemId),
  );
}

function requireFreeQuantity(position: Position, quantity: number) {
  if (quantity > position.onHand - position.reserved) failOperations("insufficientStock");
  if (position.serial !== null && quantity !== 1) failOperations("invalid");
}

async function readDraftStock(tx: Db, actor: OperationsActor, ids: string[]) {
  if (new Set(ids).size !== ids.length) failOperations("invalid");
  const rows = await tx
    .select({ id: inventoryStockPositions.id, itemId: inventoryStockPositions.itemId })
    .from(inventoryStockPositions)
    .where(inArray(inventoryStockPositions.id, ids));
  if (rows.length !== ids.length) failOperations("unavailable");
  const itemIds = rows.map(({ itemId }) => itemId);
  await requireVisibleParts(tx, actor, itemIds);
  await lockInventoryStock(tx, itemIds);
}

export async function createTransfer(tx: Db, actor: OperationsActor, command: NewTransfer) {
  const { lines, sourceLocationId, destinationLocationId, reason } = command;
  const source = managedEndpoint(actor, sourceLocationId);
  const destination = managedEndpoint(actor, destinationLocationId);
  if (sourceLocationId === destinationLocationId) failOperations("incompatibleLocation");
  await readDraftStock(
    tx,
    actor,
    lines.map(({ positionId }) => positionId),
  );

  const [transfer] = await tx
    .insert(inventoryStockTransfers)
    .values({
      sourceSiteId: source.siteId,
      sourceLocationId,
      destinationSiteId: destination.siteId,
      destinationLocationId,
      createdBy: actor.id,
      reason,
    })
    .returning({ id: inventoryStockTransfers.id });
  if (transfer === undefined) failOperations("conflict");
  for (const { positionId, quantity } of lines) {
    const position = await readPosition(tx, positionId);
    if (!onSource(position, source)) failOperations("stale");
    requireFreeQuantity(position, quantity);
    const [line] = await tx
      .insert(inventoryStockTransferLines)
      .values({
        transferId: transfer.id,
        itemId: position.itemId,
        sourcePositionId: position.id,
        quantity,
        ...stockIdentity(position),
      })
      .returning({ id: inventoryStockTransferLines.id });
    if (line === undefined) failOperations("conflict");
    await addOperationEvent(
      tx,
      actor,
      command,
      { itemId: position.itemId, positionId, kind: "transfer-draft" },
      { ...source, transferId: transfer.id, transferLineId: line.id },
    );
  }
  return transfer.id;
}

async function changeStatus(tx: Db, transfer: Transfer, status: WarehouseTransferStatus) {
  await tx
    .update(inventoryStockTransfers)
    .set({ status, version: transfer.version + 1, updatedAt: new Date() })
    .where(eq(inventoryStockTransfers.id, transfer.id));
}

async function dispatchLine(
  tx: Db,
  actor: OperationsActor,
  command: AuditContext,
  transfer: Transfer,
  line: TransferLine,
  locked: StockLocks,
) {
  const source = originalSource(transfer);
  const position = await readPosition(tx, line.sourcePositionId);
  if (!onSource(position, source)) failOperations("stale");
  requireFreeQuantity(position, line.quantity);
  const onHandDelta = -line.quantity;
  const movementId = await postInventoryMovement(tx, lockedItem(locked, line.itemId), {
    actorId: actor.id,
    requestId: command.requestId,
    kind: "transfer-dispatch",
    onHandDelta,
    reservedDelta: 0,
  });
  await tx
    .update(inventoryStockPositions)
    .set({ onHand: position.onHand + onHandDelta })
    .where(eq(inventoryStockPositions.id, position.id));
  await tx
    .update(inventoryStockTransferLines)
    .set(stockIdentity(position))
    .where(eq(inventoryStockTransferLines.id, line.id));
  await addOperationEvent(
    tx,
    actor,
    command,
    {
      itemId: line.itemId,
      positionId: position.id,
      kind: "transfer-dispatch",
      movementId,
      onHandDelta,
      state: position.state,
    },
    {
      ...source,
      transferId: transfer.id,
      transferLineId: line.id,
      previousOnHand: position.onHand,
    },
  );
}

async function receivePosition(tx: Db, transfer: Transfer, line: TransferLine, quantity: number) {
  const target = originalDestination(transfer);
  const identity = {
    lot: line.lot,
    serial: line.serial,
    expiryDate: line.expiryDate,
    state: line.state,
    ownerOrganizationId: line.ownerOrganizationId,
  };
  if (line.serial !== null) {
    const position = await readPosition(tx, line.sourcePositionId);
    if (
      quantity !== 1 ||
      !onSource(position, originalSource(transfer)) ||
      position.onHand !== 0 ||
      position.reserved !== 0 ||
      position.serial !== line.serial
    ) {
      failOperations("stale");
    }
    await tx
      .update(inventoryStockPositions)
      .set({ ...target, ...identity, onHand: 1 })
      .where(eq(inventoryStockPositions.id, position.id));
    return position.id;
  }
  const [created] = await tx
    .insert(inventoryStockPositions)
    .values({
      ...target,
      ...identity,
      itemId: line.itemId,
      onHand: quantity,
    })
    .returning({ id: inventoryStockPositions.id });
  if (created === undefined) failOperations("conflict");
  return created.id;
}

async function receiveLine(
  tx: Db,
  actor: OperationsActor,
  command: AuditContext,
  transfer: Transfer,
  line: TransferLine,
  quantity: number,
  locked: StockLocks,
) {
  const positionId = await receivePosition(tx, transfer, line, quantity);
  const movementId = await postInventoryMovement(tx, lockedItem(locked, line.itemId), {
    actorId: actor.id,
    requestId: command.requestId,
    kind: "transfer-receive",
    onHandDelta: quantity,
    reservedDelta: 0,
  });
  await tx
    .update(inventoryStockTransferLines)
    .set({ received: line.received + quantity })
    .where(eq(inventoryStockTransferLines.id, line.id));
  await addOperationEvent(
    tx,
    actor,
    command,
    {
      itemId: line.itemId,
      positionId,
      sourcePositionId: line.sourcePositionId === positionId ? null : line.sourcePositionId,
      kind: "transfer-receive",
      movementId,
      onHandDelta: quantity,
      state: line.state,
    },
    {
      ...originalDestination(transfer),
      transferId: transfer.id,
      transferLineId: line.id,
      previousOnHand: 0,
    },
  );
}

async function receiveTransfer(
  tx: Db,
  actor: OperationsActor,
  command: Receipt,
  transfer: Transfer,
  lines: TransferLine[],
  locked: StockLocks,
) {
  const requested = new Map(command.lines.map(({ lineId, quantity }) => [lineId, quantity]));
  if (requested.size !== command.lines.length) failOperations("invalid");
  const byId = new Map(lines.map((line) => [line.id, line]));
  for (const [id, quantity] of requested) {
    const line = byId.get(id);
    if (line === undefined) failOperations("invalid");
    if (quantity > line.quantity - line.received) failOperations("stale");
    await receiveLine(tx, actor, command, transfer, line, quantity, locked);
  }
  const completed = lines.every(
    (line) => line.received + (requested.get(line.id) ?? 0) === line.quantity,
  );
  await changeStatus(tx, transfer, completed ? "received" : "in_transit");
}

export async function changeTransfer(tx: Db, actor: OperationsActor, command: TransferChange) {
  const [transfer] = await tx
    .select()
    .from(inventoryStockTransfers)
    .where(eq(inventoryStockTransfers.id, command.id))
    .for("update");
  if (transfer === undefined) failOperations("unavailable");
  requireTransferScope(actor, transfer, command.type !== "cancelTransfer");
  const lines = await transferLines(tx, transfer.id);
  const itemIds = lines.map(({ itemId }) => itemId);
  await requireVisibleParts(tx, actor, itemIds);
  const expected = command.type === "receiveTransfer" ? "in_transit" : "draft";
  if (transfer.version !== command.version || transfer.status !== expected) failOperations("stale");

  if (command.type === "cancelTransfer") {
    for (const line of lines) {
      await addOperationEvent(
        tx,
        actor,
        command,
        { itemId: line.itemId, positionId: line.sourcePositionId, kind: "transfer-cancel" },
        { ...originalSource(transfer), transferId: transfer.id, transferLineId: line.id },
      );
    }
    await changeStatus(tx, transfer, "cancelled");
  } else {
    const locked = await lockInventoryStock(tx, itemIds);
    if (command.type === "dispatchTransfer") {
      for (const line of lines) await dispatchLine(tx, actor, command, transfer, line, locked);
      await changeStatus(tx, transfer, "in_transit");
    } else {
      await receiveTransfer(tx, actor, command, transfer, lines, locked);
    }
  }
  return transfer.id;
}
