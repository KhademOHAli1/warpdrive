import { eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { inventoryItems } from "../schema";
import type { StockPositionRow } from "./balances";
import { hasOpenWarehouseTransfer } from "./operations/placement";
import {
  inventoryStockIncoming,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
  type WarehouseLocationKind,
} from "./schema";

type ItemBalance = { id: string; onHand: number; reserved: number };

/** Read aggregate and positioned quantities in the same PostgreSQL statement snapshot. */
export async function readStockSnapshot(tx: Db, itemIds: readonly string[]) {
  const balances = new Map<string, ItemBalance>();
  const positions = new Map<string, StockPositionRow[]>();
  if (itemIds.length === 0) return { balances, positions };
  const details = tx
    .select({
      ...getTableColumns(inventoryStockPositions),
      siteArchived: sql<boolean>`${directorySites.archived}`.as("site_archived"),
      locationArchived: sql<boolean>`${directoryLocations.archived}`.as("location_archived"),
      locationKind:
        sql<WarehouseLocationKind>`coalesce(${inventoryStockLocationPolicies.kind}, 'storage')`.as(
          "location_kind",
        ),
    })
    .from(inventoryStockPositions)
    .innerJoin(directorySites, eq(directorySites.id, inventoryStockPositions.siteId))
    .innerJoin(directoryLocations, eq(directoryLocations.id, inventoryStockPositions.locationId))
    .leftJoin(
      inventoryStockLocationPolicies,
      eq(inventoryStockLocationPolicies.locationId, inventoryStockPositions.locationId),
    )
    .where(inArray(inventoryStockPositions.itemId, itemIds))
    .as("warehouse_stock_snapshot");
  const rows = await tx
    .select({
      id: inventoryItems.id,
      onHand: inventoryItems.onHand,
      reserved: inventoryItems.reserved,
      position: {
        id: details.id,
        itemId: details.itemId,
        siteId: details.siteId,
        locationId: details.locationId,
        lot: details.lot,
        serial: details.serial,
        expiryDate: details.expiryDate,
        state: details.state,
        ownerOrganizationId: details.ownerOrganizationId,
        onHand: details.onHand,
        reserved: details.reserved,
        siteArchived: details.siteArchived,
        locationArchived: details.locationArchived,
        locationKind: details.locationKind,
      },
    })
    .from(inventoryItems)
    .leftJoin(details, eq(details.itemId, inventoryItems.id))
    .where(inArray(inventoryItems.id, itemIds));
  for (const { position, ...item } of rows) {
    balances.set(item.id, item);
    if (position === null) continue;
    const current = positions.get(item.id);
    if (current === undefined) positions.set(item.id, [position]);
    else current.push(position);
  }
  return { balances, positions };
}

/** Call beneath the directory write lock, which fences receipts and inbound plans. */
export async function hasWarehouseStock(tx: Db, siteId: string, locationId: string | null) {
  const positionScope =
    locationId === null
      ? eq(inventoryStockPositions.siteId, siteId)
      : eq(inventoryStockPositions.locationId, locationId);
  const incomingScope =
    locationId === null
      ? eq(inventoryStockIncoming.siteId, siteId)
      : eq(inventoryStockIncoming.locationId, locationId);
  const rows = await tx.execute<{ has_stock: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM ${inventoryStockPositions}
      WHERE ${positionScope} AND ${inventoryStockPositions.onHand} > 0)
      OR EXISTS(SELECT 1 FROM ${inventoryStockIncoming}
        WHERE ${incomingScope} AND NOT ${inventoryStockIncoming.cancelled}
          AND ${inventoryStockIncoming.received} < ${inventoryStockIncoming.quantity}) AS has_stock
  `);
  return (
    rows.rows[0]?.has_stock === true || (await hasOpenWarehouseTransfer(tx, siteId, locationId))
  );
}
