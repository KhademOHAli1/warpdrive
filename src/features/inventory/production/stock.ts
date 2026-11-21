import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicy } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryStockLimit } from "../schema";
import { type lockInventoryStock, postInventoryMovement } from "../stock";
import { addOperationEvent } from "../warehouse/operations/shared";
import { inventoryStockLocationPolicies, inventoryStockPositions } from "../warehouse/schema";
import { failProduction } from "./failure";

export type ProductionPositionRow = typeof inventoryStockPositions.$inferSelect;
export type ProductionStockLocks = Awaited<ReturnType<typeof lockInventoryStock>>;

const ledgerReasons = {
  "production-reserve": "Reserve production material",
  "production-release": "Release production material reservation",
  "production-consume": "Consume reserved production material",
  "production-output": "Post approved production output",
  "production-reversal": "Reverse production output and return consumed material",
} as const;

type ProductionStockKind = keyof typeof ledgerReasons;

export type ProductionStockDelta = {
  position: ProductionPositionRow;
  onHandDelta: number;
  reservedDelta: number;
  reversesEventId?: string;
};

export async function requireStorageBin(tx: Db, siteId: string, locationId: string) {
  const [location] = await tx
    .select({ id: directoryLocations.id })
    .from(directoryLocations)
    .innerJoin(directorySites, eq(directorySites.id, directoryLocations.siteId))
    .leftJoin(
      inventoryStockLocationPolicies,
      eq(inventoryStockLocationPolicies.locationId, directoryLocations.id),
    )
    .where(
      and(
        eq(directoryLocations.id, locationId),
        eq(directoryLocations.siteId, siteId),
        eq(directoryLocations.archived, false),
        eq(directorySites.archived, false),
        or(
          isNull(inventoryStockLocationPolicies.kind),
          eq(inventoryStockLocationPolicies.kind, "storage"),
        ),
      ),
    );
  if (location === undefined) failProduction("state");
}

export async function productionStockUnits(tx: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, CatalogUnit>();
  const rows = await tx
    .select({ itemId: inventoryPartProfiles.itemId, unit: inventoryPartProfiles.unit })
    .from(inventoryPartProfiles)
    .where(inArray(inventoryPartProfiles.itemId, ids));
  return new Map(rows.map(({ itemId, unit }) => [itemId, unit]));
}

export async function currentProductionPolicy(tx: Db, itemId: string) {
  const policy = await catalogItemPolicy(tx, itemId);
  if (!canHoldInventory(policy) || policy === null) failProduction("stock");
  return policy;
}

/** The caller holds all relevant item rows before reading position balances. */
export async function writeProductionStock(
  tx: Db,
  actorId: string,
  requestId: string,
  stock: ProductionStockLocks,
  kind: ProductionStockKind,
  delta: ProductionStockDelta,
) {
  const { position, onHandDelta, reservedDelta, reversesEventId } = delta;
  const item = stock.get(position.itemId);
  if (item === undefined) failProduction("unavailable");
  const update = {
    onHand: position.onHand + onHandDelta,
    reserved: position.reserved + reservedDelta,
  };
  if (
    update.reserved < 0 ||
    update.onHand < update.reserved ||
    update.onHand > inventoryStockLimit
  ) {
    failProduction("stock");
  }
  const movementId = await postInventoryMovement(tx, item, {
    actorId,
    requestId,
    kind,
    onHandDelta,
    reservedDelta,
  });
  const [applied] = await tx
    .update(inventoryStockPositions)
    .set(update)
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.onHand, position.onHand),
        eq(inventoryStockPositions.reserved, position.reserved),
      ),
    )
    .returning({ id: inventoryStockPositions.id });
  if (applied === undefined) failProduction("stale");
  const eventId = await addOperationEvent(
    tx,
    { id: actorId },
    { requestId, reason: ledgerReasons[kind] },
    {
      itemId: position.itemId,
      positionId: position.id,
      movementId,
      kind,
      onHandDelta,
      reservedDelta,
      state: position.state,
    },
    {
      siteId: position.siteId,
      locationId: position.locationId,
      previousOnHand: position.onHand,
      reversesEventId,
    },
  );
  // Later lines in the same request can touch the same retained lot.
  Object.assign(position, update);
  return eventId;
}
