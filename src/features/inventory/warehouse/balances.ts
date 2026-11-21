import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { InventoryDomainError } from "../errors";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
  type WarehouseLocationKind,
  type WarehouseStockEventKind,
} from "./schema";

type StockPosition = typeof inventoryStockPositions.$inferSelect;

export type StockPositionRow = StockPosition & {
  siteArchived: boolean;
  locationArchived: boolean;
  locationKind: WarehouseLocationKind;
};

type StockBalance = { onHand: number; reserved: number };
type StockItem = StockBalance & { id: string };
type PositionAllocation = { positionId: string; quantity: number };
export type StockReservationPlan = { quantity: number; positions: PositionAllocation[] };

type OrderMovement<K extends WarehouseStockEventKind> = {
  orderId: string;
  actorId: string;
  requestId: string;
  movementId: string;
  kind: K;
};

function warehouseDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Raw internal projections. Apply native site scope before returning positions to a caller. */
export async function readStockPositionRows(
  tx: Db,
  itemIds?: readonly string[],
  siteIds?: readonly string[] | null,
  positionIds?: readonly string[],
): Promise<StockPositionRow[]> {
  if (itemIds?.length === 0 || siteIds?.length === 0 || positionIds?.length === 0) return [];
  const rows = await tx
    .select({
      ...getTableColumns(inventoryStockPositions),
      siteArchived: directorySites.archived,
      locationArchived: directoryLocations.archived,
      locationKind: inventoryStockLocationPolicies.kind,
    })
    .from(inventoryStockPositions)
    .innerJoin(directorySites, eq(directorySites.id, inventoryStockPositions.siteId))
    .innerJoin(
      directoryLocations,
      and(
        eq(directoryLocations.siteId, inventoryStockPositions.siteId),
        eq(directoryLocations.id, inventoryStockPositions.locationId),
      ),
    )
    .leftJoin(
      inventoryStockLocationPolicies,
      and(
        eq(inventoryStockLocationPolicies.siteId, inventoryStockPositions.siteId),
        eq(inventoryStockLocationPolicies.locationId, inventoryStockPositions.locationId),
      ),
    )
    .where(
      and(
        itemIds === undefined ? undefined : inArray(inventoryStockPositions.itemId, itemIds),
        siteIds == null ? undefined : inArray(inventoryStockPositions.siteId, siteIds),
        positionIds === undefined ? undefined : inArray(inventoryStockPositions.id, positionIds),
      ),
    );
  return rows.map((row) => ({ ...row, locationKind: row.locationKind ?? "storage" }));
}

export function groupStockPositionsByItem(rows: readonly StockPositionRow[]) {
  const byItem = new Map<string, StockPositionRow[]>();
  for (const row of rows) {
    const positions = byItem.get(row.itemId);
    if (positions === undefined) byItem.set(row.itemId, [row]);
    else positions.push(row);
  }
  return byItem;
}

export function isStockPositionEligible(row: StockPositionRow, today = warehouseDate()): boolean {
  return (
    row.state === "available" &&
    row.ownerOrganizationId === null &&
    (row.expiryDate === null || row.expiryDate >= today) &&
    row.locationKind === "storage" &&
    !row.locationArchived &&
    !row.siteArchived
  );
}

export function stockPositionAvailable(row: StockPositionRow, today = warehouseDate()): number {
  return isStockPositionEligible(row, today) ? row.onHand - row.reserved : 0;
}

/** Subtract all positioned balances, including sites the reader has no grant for. */
export function unlocatedBalance(item: StockItem, rows: readonly StockPositionRow[]): StockBalance {
  let { onHand, reserved } = item;
  for (const row of rows) {
    if (row.itemId !== item.id) continue;
    onHand -= row.onHand;
    reserved -= row.reserved;
  }
  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    throw new InventoryDomainError("Located and unlocated stock no longer reconcile.");
  }
  return { onHand, reserved };
}

export function summarizeStockAvailability(
  item: StockItem,
  rows: readonly StockPositionRow[],
  readSiteIds: readonly string[] | null,
) {
  const unlocated = unlocatedBalance(item, rows);
  const today = warehouseDate();
  const sites = readSiteIds === null ? null : new Set(readSiteIds);
  let { onHand, reserved } = unlocated;
  let available = onHand - reserved;
  for (const row of rows) {
    if (row.itemId !== item.id || (sites !== null && !sites.has(row.siteId))) continue;
    onHand += row.onHand;
    reserved += row.reserved;
    available += stockPositionAvailable(row, today);
  }
  return {
    onHand,
    reserved,
    available,
    unlocatedOnHand: unlocated.onHand,
    unlocatedReserved: unlocated.reserved,
  };
}

export function earliestExpiryFirst(a: StockPositionRow, b: StockPositionRow) {
  const aExpiry = a.expiryDate ?? "9999-12-31";
  const bExpiry = b.expiryDate ?? "9999-12-31";
  return (
    aExpiry.localeCompare(bExpiry) ||
    a.siteId.localeCompare(b.siteId) ||
    a.locationId.localeCompare(b.locationId) ||
    (a.lot ?? "").localeCompare(b.lot ?? "") ||
    (a.serial ?? "").localeCompare(b.serial ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/** Call while holding the inventory item row lock and the shared directory policy lock. */
export async function planStockReservation(
  tx: Db,
  item: StockItem,
  quantity: number,
  readSiteIds: readonly string[] | null,
): Promise<StockReservationPlan> {
  const rows = await readStockPositionRows(tx, [item.id]);
  const unlocated = unlocatedBalance(item, rows);
  const today = warehouseDate();
  const sites = readSiteIds === null ? null : new Set(readSiteIds);
  const candidates = rows
    .filter(
      (row) => (sites === null || sites.has(row.siteId)) && stockPositionAvailable(row, today) > 0,
    )
    .sort(earliestExpiryFirst);
  const positions: PositionAllocation[] = [];
  let remaining = quantity;
  for (const row of candidates) {
    if (remaining === 0) break;
    const allocated = Math.min(remaining, row.onHand - row.reserved);
    positions.push({ positionId: row.id, quantity: allocated });
    remaining -= allocated;
  }
  remaining -= Math.min(remaining, unlocated.onHand - unlocated.reserved);
  return { quantity: quantity - remaining, positions };
}

const writeBatchSize = 512;

async function adjustPositionBalances(
  tx: Db,
  itemId: string,
  batch: PositionAllocation[],
  reservedFactor: 1 | -1,
  physicalFactor: 0 | -1,
) {
  const values = sql.join(
    batch.map(({ positionId, quantity }) => sql`(${positionId}::uuid, ${quantity}::int)`),
    sql`, `,
  );
  const written = await tx.execute<{ id: string }>(sql`
    UPDATE ${inventoryStockPositions} AS stock
    SET reserved = stock.reserved + (${reservedFactor}::int * changes.quantity),
        on_hand = stock.on_hand + (${physicalFactor}::int * changes.quantity)
    FROM (VALUES ${values}) AS changes(id, quantity)
    WHERE stock.id = changes.id AND stock.item_id = ${itemId}::uuid
      AND stock.reserved + (${reservedFactor}::int * changes.quantity)
        BETWEEN 0 AND stock.on_hand + (${physicalFactor}::int * changes.quantity)
    RETURNING stock.id
  `);
  if (written.rows.length !== batch.length) {
    throw new InventoryDomainError("A stock position changed. Refresh and try again.");
  }
}

/** Persist the exact positions selected for an order alongside the canonical reservation. */
export async function applyStockReservation(
  tx: Db,
  itemId: string,
  plan: StockReservationPlan,
  movement: OrderMovement<"order-reserve" | "materials-reserve">,
): Promise<void> {
  for (let i = 0; i < plan.positions.length; i += writeBatchSize) {
    const batch = plan.positions.slice(i, i + writeBatchSize);
    await adjustPositionBalances(tx, itemId, batch, 1, 0);
    await tx
      .insert(inventoryStockAllocations)
      .values(batch.map((allocation) => ({ itemId, orderId: movement.orderId, ...allocation })))
      .onConflictDoUpdate({
        target: [inventoryStockAllocations.orderId, inventoryStockAllocations.positionId],
        set: { quantity: sql`${inventoryStockAllocations.quantity} + excluded.quantity` },
      });
    await tx.insert(inventoryStockEvents).values(
      batch.map(({ positionId, quantity }) => ({
        itemId,
        ...movement,
        positionId,
        reservedDelta: quantity,
      })),
    );
  }
}

/** Settle this order's exact allocations and confirm that the remainder has a legacy reservation. */
export async function settleStockReservation(
  tx: Db,
  priorItem: StockItem,
  quantity: number,
  movement: OrderMovement<"shipment" | "build-consume" | "cancel-release">,
): Promise<void> {
  const { orderId } = movement;
  const rows = await readStockPositionRows(tx, [priorItem.id]);
  const unlocated = unlocatedBalance(priorItem, rows);
  const activeAllocations = and(
    eq(inventoryStockAllocations.orderId, orderId),
    eq(inventoryStockAllocations.itemId, priorItem.id),
  );
  const allocations = await tx
    .select({
      positionId: inventoryStockAllocations.positionId,
      quantity: inventoryStockAllocations.quantity,
    })
    .from(inventoryStockAllocations)
    .where(activeAllocations);
  const located = allocations.reduce((total, allocation) => total + allocation.quantity, 0);
  if (located > quantity || quantity - located > unlocated.reserved) {
    throw new InventoryDomainError("The stock reservation cannot be reconciled to this order.");
  }

  const consuming = movement.kind !== "cancel-release";
  const byId = new Map(rows.map((row) => [row.id, row]));
  const today = warehouseDate();
  for (const allocation of allocations) {
    const row = byId.get(allocation.positionId);
    if (row === undefined || (consuming && !isStockPositionEligible(row, today))) {
      throw new InventoryDomainError("A reserved position is no longer eligible for use.");
    }
  }

  for (let i = 0; i < allocations.length; i += writeBatchSize) {
    const batch = allocations.slice(i, i + writeBatchSize);
    await adjustPositionBalances(tx, priorItem.id, batch, -1, consuming ? -1 : 0);
    await tx.insert(inventoryStockEvents).values(
      batch.map(({ positionId, quantity }) => ({
        itemId: priorItem.id,
        ...movement,
        positionId,
        onHandDelta: consuming ? -quantity : 0,
        reservedDelta: -quantity,
      })),
    );
  }
  if (allocations.length > 0) {
    await tx.delete(inventoryStockAllocations).where(activeAllocations);
  }
}
