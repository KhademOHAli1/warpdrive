import { and, asc, eq, getTableColumns, inArray, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { type CatalogItemPolicy, catalogItemPolicies } from "../catalog/policy";
import { purchaseOrderLines, purchaseOrders } from "../purchasing/schema";
import { inventoryItems } from "../schema";
import type { WarehouseAccess } from "./access";
import { stockPositionAvailable, unlocatedBalance } from "./balances";
import type {
  WarehouseBalance,
  WarehouseIncoming,
  WarehousePart,
  WarehousePosition,
  WarehouseQuery,
  WarehouseWorkspace,
} from "./contracts";
import { inventoryStockIncoming } from "./schema";
import { readStockSnapshot } from "./snapshot";

type InventoryItemRow = typeof inventoryItems.$inferSelect;

export function isReceivableStockItem(policy: CatalogItemPolicy) {
  return policy.active && !policy.isTemplate && policy.stockMode !== "virtual";
}

function ownedStock(
  ownerOrganizationId: string | null,
  visibleOwners: ReadonlyMap<string, string>,
) {
  return {
    ownerOrganizationId:
      ownerOrganizationId !== null && visibleOwners.has(ownerOrganizationId)
        ? ownerOrganizationId
        : null,
    owned: ownerOrganizationId !== null,
  };
}

function partIdentity(item: InventoryItemRow, policy: CatalogItemPolicy): WarehousePart {
  const { id, sku, name, revision, kind } = item;
  return {
    id,
    code: policy.code,
    sku,
    name,
    revision,
    kind,
    trackable: policy.flags.trackable,
    canReceive: isReceivableStockItem(policy),
  };
}

function queryAllowsPlacement(query: WarehouseQuery, row: { siteId: string; locationId: string }) {
  return (
    (query.siteId === undefined || query.siteId === row.siteId) &&
    (query.locationId === undefined || query.locationId === row.locationId)
  );
}

function matchingText(query: string, values: (string | null | undefined)[]) {
  return (
    query.length === 0 || values.some((value) => value?.toLowerCase().includes(query) === true)
  );
}

function partTerms(part: WarehousePart) {
  return [part.name, part.code, part.revision, part.sku];
}

async function readVisibleParts(tx: Db, access: WarehouseAccess) {
  if (!access.isAdmin && access.sites.length === 0) return [];
  const [items, policies] = await Promise.all([
    tx.select().from(inventoryItems).orderBy(asc(inventoryItems.name), asc(inventoryItems.id)),
    catalogItemPolicies(tx),
  ]);
  return items.flatMap((item) => {
    const policy = policies.get(item.id);
    if (policy === undefined || (!access.isAdmin && policy.visibility !== "staff")) return [];
    return [{ item, part: partIdentity(item, policy) }];
  });
}

async function readIncoming(
  tx: Db,
  itemIds: string[],
  siteIds: string[],
  visibleItemIds: string[],
  visibleSupplierIds: string[],
) {
  if (itemIds.length === 0 || siteIds.length === 0) return [];
  const siblings = alias(purchaseOrderLines, "warehouse_purchase_siblings");
  const inaccessibleParts = tx
    .select({ id: siblings.id })
    .from(siblings)
    .where(
      and(eq(siblings.orderId, purchaseOrders.id), notInArray(siblings.itemId, visibleItemIds)),
    );
  const canSeePurchase = and(
    inArray(purchaseOrders.supplierOrganizationId, visibleSupplierIds),
    notExists(inaccessibleParts),
  );
  return tx
    .select({
      ...getTableColumns(inventoryStockIncoming),
      purchaseOwned: sql<boolean>`${purchaseOrderLines.orderId} IS NOT NULL`,
      purchaseOrderId: sql<
        string | null
      >`CASE WHEN ${canSeePurchase} THEN ${purchaseOrders.id} END`,
    })
    .from(inventoryStockIncoming)
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.incomingId, inventoryStockIncoming.id))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(
      and(
        inArray(inventoryStockIncoming.siteId, siteIds),
        inArray(inventoryStockIncoming.itemId, itemIds),
      ),
    )
    .orderBy(asc(inventoryStockIncoming.expectedDate), asc(inventoryStockIncoming.id));
}

function buildWarehouseBalances(
  positions: WarehousePosition[],
  incoming: WarehouseIncoming[],
  unlocated: WarehouseBalance[],
): WarehouseBalance[] {
  const balances = new Map<string, WarehouseBalance>();
  function ensure({
    itemId,
    siteId,
    locationId,
  }: Pick<WarehouseBalance, "itemId" | "siteId" | "locationId">) {
    const key = `${itemId}:${siteId ?? ""}:${locationId ?? ""}`;
    const found = balances.get(key);
    if (found !== undefined) return found;
    const created = {
      itemId,
      siteId,
      locationId,
      onHand: 0,
      reserved: 0,
      incoming: 0,
      available: 0,
    };
    balances.set(key, created);
    return created;
  }
  for (const position of positions) {
    const balance = ensure(position);
    balance.onHand += position.onHand;
    balance.reserved += position.reserved;
    balance.available += position.available;
  }
  for (const plan of incoming) {
    if (plan.cancelled || plan.received === plan.quantity) continue;
    ensure(plan).incoming += plan.quantity - plan.received;
  }
  return [...balances.values(), ...unlocated];
}

export async function projectWarehouse(
  tx: Db,
  access: WarehouseAccess,
  query: WarehouseQuery,
): Promise<WarehouseWorkspace> {
  const items = await readVisibleParts(tx, access);
  const selected = items.filter(
    ({ part }) => query.itemId === undefined || part.id === query.itemId,
  );
  const byItem = new Map(selected.map(({ part }) => [part.id, part]));
  const byLocation = new Map(access.locations.map((location) => [location.id, location]));
  const ownerNames = new Map(access.organizations.map(({ id, name }) => [id, name]));
  const siteIds = access.sites.map(({ id }) => id);
  const partIds = [...byItem.keys()];
  // Warehouse reads take sorted SKU locks before either quantity source. The same rows
  // serialize inbound plan updates and all position mutations.
  if (partIds.length > 0) {
    await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, partIds))
      .orderBy(asc(inventoryItems.id))
      .for("share");
  }
  const [snapshot, plans] = await Promise.all([
    readStockSnapshot(tx, partIds),
    readIncoming(
      tx,
      partIds,
      siteIds,
      items.map(({ item }) => item.id),
      [...ownerNames.keys()],
    ),
  ]);
  const allowedSites = new Set(siteIds);
  const positionRows = [...snapshot.positions.values()]
    .flat()
    .filter(({ siteId }) => allowedSites.has(siteId));
  const search = query.search?.trim().toLowerCase() ?? "";
  const visiblePositionRows = positionRows.filter((row) => {
    const part = byItem.get(row.itemId);
    const location = byLocation.get(row.locationId);
    return (
      part !== undefined &&
      queryAllowsPlacement(query, row) &&
      (query.showEmpty === true || row.onHand > 0) &&
      matchingText(search, [
        ...partTerms(part),
        row.lot,
        row.serial,
        location?.name,
        location?.code,
      ])
    );
  });
  const positions = visiblePositionRows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    siteId: row.siteId,
    locationId: row.locationId,
    lot: row.lot,
    serial: row.serial,
    expiryDate: row.expiryDate,
    state: row.state,
    onHand: row.onHand,
    reserved: row.reserved,
    available: byItem.get(row.itemId)?.canReceive === true ? stockPositionAvailable(row) : 0,
    ...ownedStock(row.ownerOrganizationId, ownerNames),
  }));
  const incoming = plans.flatMap((row) => {
    const part = byItem.get(row.itemId);
    const location = byLocation.get(row.locationId);
    const reference = row.purchaseOwned && row.purchaseOrderId === null ? null : row.reference;
    if (
      part === undefined ||
      !queryAllowsPlacement(query, row) ||
      !matchingText(search, [...partTerms(part), reference, location?.name, location?.code])
    )
      return [];
    return [{ ...row, reference, ...ownedStock(row.ownerOrganizationId, ownerNames) }];
  });
  const unlocated =
    access.isAdmin && query.siteId === undefined && query.locationId === undefined
      ? selected.flatMap(({ item, part }) => {
          if (!matchingText(search, partTerms(part))) return [];
          const aggregate = snapshot.balances.get(item.id);
          if (aggregate === undefined) return [];
          const balance = unlocatedBalance(aggregate, snapshot.positions.get(item.id) ?? []);
          if (balance.onHand === 0 && query.showEmpty !== true) return [];
          return [
            {
              itemId: item.id,
              siteId: null,
              locationId: null,
              incoming: 0,
              onHand: balance.onHand,
              reserved: balance.reserved,
              available: part.canReceive ? balance.onHand - balance.reserved : 0,
            },
          ];
        })
      : [];
  return {
    sites: access.sites,
    locations: access.locations,
    organizations: access.organizations,
    canManageUnlocated: access.isAdmin,
    parts: items.map(({ part }) => part),
    positions,
    incoming,
    balances: buildWarehouseBalances(positions, incoming, unlocated),
  };
}
