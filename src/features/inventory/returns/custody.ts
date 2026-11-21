import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicy } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { lockInventoryStock, postInventoryMovement } from "../stock";
import { addOperationEvent } from "../warehouse/operations/shared";
import type { ReturnCommand } from "./contracts";
import {
  creditQuarantine,
  custodyPosition,
  postedStockSource,
  receivingEndpoint,
  updateCustodyPosition,
} from "./custodyStock";
import { failReturn } from "./failure";
import {
  type ReturnCaseRow,
  type ReturnLineRow,
  returnDispositions,
  returnLines,
  returnReceipts,
} from "./schema";

type Receive = Extract<ReturnCommand, { type: "receive" }>;
type Disposition = Extract<ReturnCommand, { type: "disposition" }>;

async function readCustodyLine(tx: Db, caseId: string, lineId: string) {
  const [line] = await tx
    .select()
    .from(returnLines)
    .where(and(eq(returnLines.caseId, caseId), eq(returnLines.id, lineId)));
  if (line === undefined) failReturn("unavailable");
  return line;
}

async function verifyReceiptQuantity(
  tx: Db,
  line: ReturnLineRow,
  quantity: number,
  shipped: number,
) {
  const [progress] = await tx
    .select({
      forLine:
        sql<number>`COALESCE(SUM(${returnReceipts.quantity}) FILTER (WHERE ${returnReceipts.lineId} = ${line.id}), 0)`.mapWith(
          Number,
        ),
      againstShipmentLine: sql<number>`COALESCE(SUM(${returnReceipts.quantity}), 0)`.mapWith(
        Number,
      ),
    })
    .from(returnReceipts)
    .where(eq(returnReceipts.shipmentLineId, line.shipmentLineId));
  if (
    quantity > line.quantity - (progress?.forLine ?? 0) ||
    quantity > shipped - (progress?.againstShipmentLine ?? 0)
  )
    failReturn("stock");
}

async function currentStockUnit(tx: Db, itemId: string) {
  const [profile] = await tx
    .select({ unit: inventoryPartProfiles.unit })
    .from(inventoryPartProfiles)
    .where(eq(inventoryPartProfiles.itemId, itemId));
  return profile?.unit ?? "each";
}

/** The command service holds and authorizes the case and its posted shipment. */
export async function receiveReturn(
  tx: Db,
  actorId: string,
  order: ReturnCaseRow,
  command: Receive,
  signal: AbortSignal,
) {
  if (order.status !== "issued") failReturn("state");
  const target = await receivingEndpoint(tx, order.siteId, command.locationId);
  const line = await readCustodyLine(tx, order.id, command.lineId);
  const items = await lockInventoryStock(tx, [line.itemId]);
  signal.throwIfAborted();
  const item = items.get(line.itemId);
  if (item === undefined) failReturn("unavailable");
  const source = await postedStockSource(tx, order.shipmentId, line.shipmentLineId);
  if (source.line.itemId !== line.itemId || source.line.orderId !== order.orderId)
    failReturn("stock");
  if (
    (command.serial?.trim().toUpperCase() ?? null) !== source.line.serial ||
    (source.line.serial !== null && command.quantity !== 1)
  )
    failReturn("invalid");

  const policy = await catalogItemPolicy(tx, line.itemId);
  // Inactive products can still be taken back for inspection and disposal.
  if (
    policy === null ||
    policy.isTemplate ||
    policy.stockMode === "virtual" ||
    (await currentStockUnit(tx, line.itemId)) !== source.unit
  )
    failReturn("stock");
  await verifyReceiptQuantity(tx, line, command.quantity, source.line.quantity);
  const positionId = await creditQuarantine(tx, source, target, command.quantity);
  const movementId = await postInventoryMovement(tx, item, {
    actorId,
    requestId: command.requestId,
    kind: "receipt",
    onHandDelta: command.quantity,
    reservedDelta: 0,
  });
  const eventId = await addOperationEvent(
    tx,
    { id: actorId },
    { requestId: command.requestId, reason: "Receive customer stock into return quarantine" },
    {
      itemId: line.itemId,
      kind: "customer-return",
      positionId,
      sourcePositionId: positionId === source.line.positionId ? null : source.line.positionId,
      movementId,
      onHandDelta: command.quantity,
      state: "quarantine",
    },
    { ...target, previousOnHand: 0 },
  );
  const [receipt] = await tx
    .insert(returnReceipts)
    .values({
      caseId: order.id,
      lineId: line.id,
      shipmentLineId: line.shipmentLineId,
      itemId: line.itemId,
      positionId,
      locationId: target.locationId,
      quantity: command.quantity,
      condition: command.condition,
      note: command.note,
      eventId,
      actorId,
      physical: "quarantine",
    })
    .returning({ id: returnReceipts.id });
  if (receipt === undefined) failReturn("conflict");
  return receipt.id;
}

async function appendDisposition(
  tx: Db,
  actorId: string,
  receipt: typeof returnReceipts.$inferSelect,
  command: Disposition,
  physical: "repair" | "restocked" | "scrapped",
  eventId: string | null,
) {
  await tx.insert(returnDispositions).values({
    receiptId: receipt.id,
    kind: command.kind,
    reason: command.reason,
    eventId,
    actorId,
  });
  const [updated] = await tx
    .update(returnReceipts)
    .set({ physical })
    .where(and(eq(returnReceipts.id, receipt.id), eq(returnReceipts.physical, receipt.physical)))
    .returning({ id: returnReceipts.id });
  if (updated === undefined) failReturn("stale");
}

async function requireRestockable(
  tx: Db,
  order: ReturnCaseRow,
  shipmentLineId: string,
  itemId: string,
  serial: string | null,
  expiryDate: string | null,
) {
  const policy = await catalogItemPolicy(tx, itemId);
  const source = await postedStockSource(tx, order.shipmentId, shipmentLineId);
  if (
    !canHoldInventory(policy) ||
    (policy?.flags.trackable === true && serial === null) ||
    (expiryDate !== null && expiryDate < new Date().toISOString().slice(0, 10)) ||
    (await currentStockUnit(tx, itemId)) !== source.unit
  )
    failReturn("stock");
}

async function readDispositionReceipt(tx: Db, caseId: string, command: Disposition) {
  const [receipt] = await tx
    .select()
    .from(returnReceipts)
    .where(and(eq(returnReceipts.caseId, caseId), eq(returnReceipts.id, command.receiptId)));
  if (receipt === undefined) failReturn("unavailable");
  if (
    receipt.physical === "restocked" ||
    receipt.physical === "scrapped" ||
    (command.kind === "repair" && receipt.physical === "repair")
  )
    failReturn("state");
  return receipt;
}

/** The command service holds and authorizes the parent case. Custody effects are atomic. */
export async function disposeReturn(
  tx: Db,
  actorId: string,
  order: ReturnCaseRow,
  command: Disposition,
  signal: AbortSignal,
) {
  if (order.status !== "issued" && order.status !== "onHold") failReturn("state");
  const receipt = await readDispositionReceipt(tx, order.id, command);
  const target = await receivingEndpoint(tx, order.siteId, receipt.locationId);
  const items = await lockInventoryStock(tx, [receipt.itemId]);
  signal.throwIfAborted();
  const item = items.get(receipt.itemId);
  if (item === undefined) failReturn("unavailable");
  const position = await custodyPosition(tx, receipt.positionId);
  if (
    position.siteId !== target.siteId ||
    position.locationId !== target.locationId ||
    position.itemId !== receipt.itemId ||
    position.onHand !== receipt.quantity ||
    position.reserved !== 0 ||
    position.state !== "quarantine" ||
    position.ownerOrganizationId !== null
  )
    failReturn("stock");

  if (command.kind === "repair") {
    await appendDisposition(tx, actorId, receipt, command, "repair", null);
    return receipt.id;
  }
  const restock = command.kind === "restock";
  if (restock)
    await requireRestockable(
      tx,
      order,
      receipt.shipmentLineId,
      receipt.itemId,
      position.serial,
      position.expiryDate,
    );
  const movementId = restock
    ? undefined
    : await postInventoryMovement(tx, item, {
        actorId,
        requestId: command.requestId,
        kind: "correction",
        onHandDelta: -receipt.quantity,
        reservedDelta: 0,
      });
  const state = restock ? "available" : "quarantine";
  const eventId = await addOperationEvent(
    tx,
    { id: actorId },
    {
      requestId: command.requestId,
      reason: restock ? "Return inspection released stock" : "Scrap returned stock",
    },
    {
      itemId: receipt.itemId,
      positionId: receipt.positionId,
      kind: restock ? "return-restock" : "return-scrap",
      movementId,
      onHandDelta: restock ? 0 : -receipt.quantity,
      previousState: "quarantine",
      state,
    },
    { ...target, previousOnHand: receipt.quantity },
  );
  // End custody before editing the stock row. A failure rolls back the ledger and both records.
  await appendDisposition(
    tx,
    actorId,
    receipt,
    command,
    restock ? "restocked" : "scrapped",
    eventId,
  );
  await updateCustodyPosition(tx, position, { onHand: restock ? receipt.quantity : 0, state });
  return receipt.id;
}
