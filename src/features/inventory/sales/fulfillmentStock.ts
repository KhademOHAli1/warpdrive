import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicy } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import type { InventoryStockKind, lockInventoryStock } from "../stock";
import { postInventoryMovement } from "../stock";
import {
  earliestExpiryFirst,
  isStockPositionEligible,
  readStockPositionRows,
  type StockPositionRow,
  stockPositionAvailable,
} from "../warehouse/balances";
import { addOperationEvent } from "../warehouse/operations/shared";
import { inventoryStockPositions } from "../warehouse/schema";
import { failSales } from "./failure";
import { type SalesLineRow, salesAllocationEvents, salesAllocations } from "./schema";

export type SalesStockLocks = Awaited<ReturnType<typeof lockInventoryStock>>;
export type SalesAllocationRow = typeof salesAllocations.$inferSelect;

const stockLedger = {
  "sales-reserve": { movement: "order-reserve", reason: "Reserve stock for sales order" },
  "sales-release": { movement: "cancel-release", reason: "Release sales stock reservation" },
  "sales-shipment": { movement: "shipment", reason: "Ship reserved sales stock" },
} as const satisfies Record<string, { movement: InventoryStockKind; reason: string }>;

type SalesStockEvent = keyof typeof stockLedger;

export function readSalesAllocations(tx: Db, orderId: string) {
  return tx.select().from(salesAllocations).where(eq(salesAllocations.orderId, orderId));
}

export async function salesStockPolicy(tx: Db, line: Pick<SalesLineRow, "itemId" | "stockUnit">) {
  const policy = await catalogItemPolicy(tx, line.itemId);
  if (policy === null || !canHoldInventory(policy) || !policy.flags.salable) return null;
  const [profile] = await tx
    .select({ unit: inventoryPartProfiles.unit })
    .from(inventoryPartProfiles)
    .where(eq(inventoryPartProfiles.itemId, line.itemId));
  if ((profile?.unit ?? "each") !== line.stockUnit) return null;
  return policy;
}

export function isShippablePosition(position: StockPositionRow, trackable: boolean) {
  return (!trackable || position.serial !== null) && isStockPositionEligible(position);
}

export async function readSalesStockCandidates(
  tx: Db,
  siteId: string,
  line: Pick<SalesLineRow, "itemId" | "stockUnit">,
) {
  const policy = await salesStockPolicy(tx, line);
  if (policy === null) return [];
  return (await readStockPositionRows(tx, [line.itemId], [siteId]))
    .filter(
      (position) =>
        isShippablePosition(position, policy.flags.trackable) &&
        stockPositionAvailable(position) > 0,
    )
    .sort(earliestExpiryFirst);
}

/** Call with the inventory item and order rows already locked. */
export async function writeSalesStock(
  tx: Db,
  actorId: string,
  requestId: string,
  stock: SalesStockLocks,
  allocation: Pick<SalesAllocationRow, "id" | "orderId" | "lineId" | "itemId" | "positionId">,
  position: StockPositionRow,
  kind: SalesStockEvent,
  quantity: number,
) {
  const item = stock.get(position.itemId);
  if (
    item === undefined ||
    allocation.itemId !== item.id ||
    allocation.positionId !== position.id
  ) {
    failSales("unavailable");
  }
  const onHandDelta = kind === "sales-shipment" ? -quantity : 0;
  const reservedDelta = kind === "sales-reserve" ? quantity : -quantity;
  const previousOnHand = position.onHand;
  const onHand = previousOnHand + onHandDelta;
  const reserved = position.reserved + reservedDelta;
  if (reserved < 0 || onHand < reserved) failSales("stock");

  const ledger = stockLedger[kind];
  const movementId = await postInventoryMovement(tx, item, {
    actorId,
    requestId,
    kind: ledger.movement,
    onHandDelta,
    reservedDelta,
  });
  const [updated] = await tx
    .update(inventoryStockPositions)
    .set({ onHand, reserved })
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.onHand, previousOnHand),
        eq(inventoryStockPositions.reserved, position.reserved),
      ),
    )
    .returning({ id: inventoryStockPositions.id });
  if (updated === undefined) failSales("stale");

  const eventId = await addOperationEvent(
    tx,
    { id: actorId },
    { requestId, reason: ledger.reason },
    {
      itemId: item.id,
      positionId: position.id,
      movementId,
      kind,
      onHandDelta,
      reservedDelta,
      state: position.state,
    },
    { siteId: position.siteId, locationId: position.locationId, previousOnHand },
  );
  await tx.insert(salesAllocationEvents).values({
    eventId,
    orderId: allocation.orderId,
    lineId: allocation.lineId,
    allocationId: allocation.id,
    positionId: position.id,
    itemId: item.id,
  });
  position.onHand = onHand;
  position.reserved = reserved;
  return eventId;
}

export async function reserveSalesPosition(
  tx: Db,
  actorId: string,
  requestId: string,
  stock: SalesStockLocks,
  line: SalesLineRow,
  position: StockPositionRow,
  quantity: number,
) {
  if (quantity > stockPositionAvailable(position)) failSales("stock");
  const [allocation] = await tx
    .insert(salesAllocations)
    .values({
      orderId: line.orderId,
      lineId: line.id,
      itemId: line.itemId,
      positionId: position.id,
      quantity,
    })
    .onConflictDoUpdate({
      target: [salesAllocations.lineId, salesAllocations.positionId],
      set: { quantity: sql`${salesAllocations.quantity} + excluded.quantity` },
    })
    .returning();
  if (allocation === undefined) failSales("conflict");
  await writeSalesStock(
    tx,
    actorId,
    requestId,
    stock,
    allocation,
    position,
    "sales-reserve",
    quantity,
  );
}

export async function reduceSalesAllocation(
  tx: Db,
  allocation: SalesAllocationRow,
  quantity: number,
) {
  if (quantity > allocation.quantity) failSales("stock");
  const filter = eq(salesAllocations.id, allocation.id);
  if (quantity === allocation.quantity) {
    await tx.delete(salesAllocations).where(filter);
  } else {
    await tx
      .update(salesAllocations)
      .set({ quantity: allocation.quantity - quantity })
      .where(filter);
  }
}
