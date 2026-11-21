import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryStock } from "../stock";
import {
  managedWarehouseLocation,
  readWarehouseAccess,
  type WarehouseAccess,
  WarehouseFailure,
} from "../warehouse/access";
import { applyWarehouseCommand, resolveWarehouseTarget } from "../warehouse/changes";
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

type Order = typeof purchaseOrders.$inferSelect;
type Receive = Extract<PurchasingCommand, { type: "receive" }>;
type ReceiptLine = Receive["lines"][number];
type PurchaseLine = typeof purchaseOrderLines.$inferSelect;
type InboundPlan = typeof inventoryStockIncoming.$inferSelect;
type ReceiptStock = { positionId: string; eventId: string };

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
    return { entry, incomingId: ordered.plan.id, itemId: ordered.line.itemId };
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
  { incomingId, itemId, entry }: ReturnType<typeof prepareReceipt>["received"][number],
): Promise<ReceiptStock> {
  const command: Extract<WarehouseCommand, { type: "receive" }> = {
    type: "receive",
    requestId,
    itemId,
    locationId: order.locationId,
    quantity: entry.quantity,
    lot: entry.lot,
    serial: entry.serial,
    expiryDate: entry.expiryDate,
    state: "available",
    ownerOrganizationId: null,
    incomingId,
  };
  const target = await resolveWarehouseTarget(tx, access, command);
  const positionId = await applyWarehouseCommand(tx, access, target, actorId, command, order.id);
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
  for (const record of received) {
    signal.throwIfAborted();
    const stock =
      record.entry.disposition === "accepted"
        ? await postWarehouseReceipt(tx, access, actor.id, order, command.requestId, record)
        : { positionId: null, eventId: null };
    recorded.push({ ...record.entry, ...stock, receiptId: receipt.id, orderId: order.id });
  }
  await tx.insert(purchaseReceiptLines).values(recorded);
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
