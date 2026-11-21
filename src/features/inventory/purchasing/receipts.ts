import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { inventoryProductionOutputs } from "../production/buildSchema";
import { lockInventoryStock } from "../stock";
import { inventorySubcontractReceipts } from "../subcontract/schema";
import {
  managedWarehouseLocation,
  readWarehouseAccess,
  type WarehouseAccess,
  WarehouseFailure,
} from "../warehouse/access";
import { applyPurchaseWarehouseReceipt } from "../warehouse/changes";
import type { WarehouseCommand } from "../warehouse/contracts";
import { inventoryStockEvents, inventoryStockIncoming } from "../warehouse/schema";
import type { PurchasingCommand } from "./contracts";
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
} from "./schema";
import { failPurchasing } from "./scope";
import {
  type LinkedPurchaseBuild,
  lockOrderSubcontracts,
  verifyLinkedPurchaseLine,
} from "./subcontract";

type Order = typeof purchaseOrders.$inferSelect;
type Receive = Extract<PurchasingCommand, { type: "receive" }>;
type ReceiptLine = Receive["lines"][number];
type PurchaseLine = typeof purchaseOrderLines.$inferSelect;
type InboundPlan = typeof inventoryStockIncoming.$inferSelect;
type ReceiptStock = { positionId: string; eventId: string };
type ReceiptPlacement = ReturnType<typeof prepareReceipt>["received"][number];

async function readPurchasePlans(tx: Db, orderId: string) {
  return tx
    .select({ line: purchaseOrderLines, plan: inventoryStockIncoming })
    .from(purchaseOrderLines)
    .leftJoin(inventoryStockIncoming, eq(inventoryStockIncoming.id, purchaseOrderLines.incomingId))
    .where(eq(purchaseOrderLines.orderId, orderId))
    .orderBy(asc(purchaseOrderLines.id));
}

function prepareReceipt(
  order: Order,
  plans: Awaited<ReturnType<typeof readPurchasePlans>>,
  entries: ReceiptLine[],
) {
  const byLine = new Map<string, { line: PurchaseLine; plan: InboundPlan }>();
  if (plans.length === 0) failPurchasing("conflict");
  for (const { line, plan } of plans) {
    if (
      plan === null ||
      plan.cancelled ||
      plan.siteId !== order.siteId ||
      plan.locationId !== order.locationId ||
      plan.itemId !== line.itemId ||
      plan.quantity !== line.orderedUnits ||
      plan.ownerOrganizationId !== null
    ) {
      failPurchasing("conflict");
    }
    byLine.set(line.id, { line, plan });
  }

  const remaining = new Map(
    [...byLine].map(([id, { plan }]) => [id, plan.quantity - plan.received]),
  );
  const received = entries.map((entry) => {
    const ordered = byLine.get(entry.lineId);
    const pending = remaining.get(entry.lineId);
    if (ordered === undefined || pending === undefined) failPurchasing("invalid");
    if (entry.serial !== null && entry.quantity !== 1) failPurchasing("invalid");
    if (entry.disposition === "rejected") {
      if (entry.reason === null) failPurchasing("invalid");
    } else {
      if (ordered.line.trackable && entry.serial === null) failPurchasing("invalid");
      if (entry.quantity > pending) failPurchasing("invalid");
      remaining.set(entry.lineId, pending - entry.quantity);
    }
    return { entry, incomingId: ordered.plan.id, line: ordered.line };
  });
  const complete = [...remaining.values()].every((quantity) => quantity === 0);
  const hasAcceptedStock = plans.some(
    ({ line }) => (remaining.get(line.id) ?? line.orderedUnits) < line.orderedUnits,
  );
  return {
    received,
    status: complete ? "received" : hasAcceptedStock ? "partial" : "open",
  } as const;
}

async function postWarehouseReceipt(
  tx: Db,
  access: WarehouseAccess,
  actorId: string,
  order: Order,
  requestId: string,
  { incomingId, line, entry }: ReceiptPlacement,
  buildOutputId?: string,
): Promise<ReceiptStock> {
  const command: Extract<WarehouseCommand, { type: "receive" }> = {
    type: "receive",
    requestId,
    itemId: line.itemId,
    locationId: order.locationId,
    quantity: entry.quantity,
    lot: entry.lot,
    serial: entry.serial,
    expiryDate: entry.expiryDate,
    state: buildOutputId === undefined ? "available" : "hold",
    ownerOrganizationId: null,
    incomingId,
  };
  const positionId = await applyPurchaseWarehouseReceipt(tx, access, actorId, command, {
    orderId: order.id,
    buildOutputId,
  });
  const [event] = await tx
    .select({ id: inventoryStockEvents.id })
    .from(inventoryStockEvents)
    .where(
      and(
        eq(inventoryStockEvents.kind, "receipt"),
        eq(inventoryStockEvents.positionId, positionId),
        eq(inventoryStockEvents.incomingId, incomingId),
        eq(inventoryStockEvents.requestId, requestId),
        eq(inventoryStockEvents.actorId, actorId),
      ),
    )
    .limit(1);
  if (event === undefined) failPurchasing("conflict");
  return { positionId, eventId: event.id };
}

async function openSupplierOutput(
  tx: Db,
  actorId: string,
  order: Order,
  record: ReceiptPlacement,
  associated: LinkedPurchaseBuild,
) {
  verifyLinkedPurchaseLine(order, record.line, associated);
  const { build } = associated;
  if (build.status !== "issued") failPurchasing("conflict");
  const { quantity, lot, serial } = record.entry;
  if (lot === null) failPurchasing("invalid");

  const [output] = await tx
    .insert(inventoryProductionOutputs)
    .values({
      buildId: build.id,
      itemId: build.itemId,
      releaseId: build.releaseId,
      createdBy: actorId,
      quantity,
      lot,
      serials: serial === null ? [] : [serial],
    })
    .returning({ id: inventoryProductionOutputs.id });
  if (output === undefined) failPurchasing("conflict");
  return output.id;
}

async function writeReceipt(
  tx: Db,
  actor: HydratedActor,
  order: Order,
  command: Receive,
  signal: AbortSignal,
) {
  const access = await readWarehouseAccess(tx, actor, signal);
  const { site, location } = managedWarehouseLocation(access, order.locationId);
  if (site.id !== order.siteId) failPurchasing("unavailable");
  if (site.archived || location.archived || location.kind !== "storage") failPurchasing("invalid");

  const plans = await readPurchasePlans(tx, order.id);
  const { received, status } = prepareReceipt(order, plans, command.lines);
  const subcontracts = await lockOrderSubcontracts(tx, order.id);
  await lockInventoryStock(
    tx,
    plans.map(({ line }) => line.itemId),
  );
  const [receipt] = await tx
    .insert(purchaseReceipts)
    .values({
      orderId: order.id,
      actorId: actor.id,
      requestId: command.requestId,
      supplierSlip: command.supplierSlip,
    })
    .returning({ id: purchaseReceipts.id });
  if (receipt === undefined) failPurchasing("conflict");

  const recorded: (typeof purchaseReceiptLines.$inferInsert)[] = [];
  const links: (typeof inventorySubcontractReceipts.$inferInsert)[] = [];
  for (const record of received) {
    signal.throwIfAborted();
    const id = randomUUID();
    const row = { ...record.entry, id, receiptId: receipt.id, orderId: order.id };
    if (record.entry.disposition === "rejected") {
      recorded.push({ ...row, positionId: null, eventId: null });
      continue;
    }
    const linked = subcontracts.get(row.lineId);
    const outputId =
      linked === undefined
        ? undefined
        : await openSupplierOutput(tx, actor.id, order, record, linked);
    const stock = await postWarehouseReceipt(
      tx,
      access,
      actor.id,
      order,
      command.requestId,
      record,
      outputId,
    );
    recorded.push({ ...row, ...stock });
    if (linked !== undefined && outputId !== undefined) {
      links.push({
        outputId,
        buildId: linked.build.id,
        receiptLineId: id,
        positionId: stock.positionId,
        orderId: order.id,
      });
    }
  }
  await tx.insert(purchaseReceiptLines).values(recorded);
  if (links.length > 0) await tx.insert(inventorySubcontractReceipts).values(links);
  await tx
    .update(purchaseOrders)
    .set({ status, version: order.version + 1, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, order.id));
  return receipt.id;
}

/** The purchase handler owns the authorization fences and the purchase order row lock. */
export async function postPurchaseReceipt(
  tx: Db,
  actor: HydratedActor,
  order: Order,
  command: Receive,
  signal: AbortSignal,
): Promise<string> {
  if (order.version !== command.expectedVersion) failPurchasing("stale");
  if (order.status !== "open" && order.status !== "partial") failPurchasing("invalid");
  try {
    return await writeReceipt(tx, actor, order, command, signal);
  } catch (error) {
    if (!(error instanceof WarehouseFailure)) throw error;
    if (error.code === "unavailable" || error.code === "insufficientStock")
      failPurchasing(error.code);
    if (error.code === "duplicateSerial" || error.code === "conflict") failPurchasing("conflict");
    failPurchasing("invalid");
  }
}
