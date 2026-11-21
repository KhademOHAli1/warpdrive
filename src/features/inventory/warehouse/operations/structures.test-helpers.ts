import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { sessions, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import type { TestDb } from "@/test/db";
import { createLegacyPartProfile } from "../../catalog/policy";
import { inventoryItems, inventoryMovements, inventoryOrders } from "../../schema";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../schema";
import { inventoryStockEventDetails } from "./schema";
import { runWarehouseOperationsCommand } from "./service";

export const signal = () => AbortSignal.timeout(20_000);

export function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      `Warehouse structure operation failed: ${result.error}`,
    );
  }
  return result.value;
}

export async function actor(h: TestDb, name: string, isAdmin = false): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({ id: userId, name, isAdmin, email: `${userId}@example.test` });
  await h.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

type Endpoint = { siteId: string; locationId: string };

async function endpoint(h: TestDb, code: string, siteId: string = randomUUID()): Promise<Endpoint> {
  await h.db.insert(directorySites).values({ id: siteId, name: code, code }).onConflictDoNothing();
  const locationId = randomUUID();
  await h.db.insert(directoryLocations).values({ id: locationId, siteId, name: code, code });
  return { siteId, locationId };
}

type PartSpec = {
  sku: string;
  kind: "product" | "component";
  onHand: number;
  reserved?: number;
  lot?: string;
  serial?: string;
  expiry?: string;
};

/** Keep the INSERT columns compatible with the populated 0132 prefix. */
async function stock(h: TestDb, who: NativeSessionRef, bin: Endpoint, spec: PartSpec) {
  const itemId = randomUUID();
  const positionId = randomUUID();
  const eventId = randomUUID();
  const movementId = randomUUID();
  const requestId = randomUUID();
  const item = {
    id: itemId,
    sku: spec.sku,
    name: spec.sku,
    kind: spec.kind,
    revision: "A",
  } as const;
  await h.db.insert(inventoryItems).values({
    ...item,
    onHand: spec.onHand,
    reserved: spec.reserved ?? 0,
  });
  if (!(await createLegacyPartProfile(h.db, item))) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Duplicate fixture part");
  }
  await h.db.execute(sql`
    INSERT INTO inventory_stock_positions (
      id, item_id, site_id, location_id, lot, serial, expiry_date, on_hand, reserved
    ) VALUES (
      ${positionId}, ${itemId}, ${bin.siteId}, ${bin.locationId}, ${spec.lot ?? null},
      ${spec.serial ?? null}, ${spec.expiry ?? null}, ${spec.onHand}, ${spec.reserved ?? 0}
    )
  `);
  await h.db.insert(inventoryMovements).values({
    id: movementId,
    itemId,
    actorId: who.userId,
    requestId,
    kind: "receipt",
    onHandDelta: spec.onHand,
    reservedDelta: 0,
  });
  await h.db.insert(inventoryStockEvents).values({
    id: eventId,
    itemId,
    positionId,
    movementId,
    actorId: who.userId,
    requestId,
    kind: "receipt",
    onHandDelta: spec.onHand,
    state: "available",
  });
  return { itemId, positionId, eventId, movementId };
}

export async function seedStructures(h: TestDb) {
  const admin = await actor(h, "Warehouse assembly operator", true);
  const source = await endpoint(h, "ASSEMBLY");
  const recovery = await endpoint(h, "RECOVERY", source.siteId);
  const remote = await endpoint(h, "REMOTE");
  const parent = await stock(h, admin, source, {
    sku: "ENCLOSURE-0132",
    kind: "product",
    onHand: 1,
    serial: "PARENT-001",
  });
  const child = await stock(h, admin, source, {
    sku: "CONTROL-0132",
    kind: "component",
    onHand: 1,
    serial: "CHILD-001",
  });
  const lot = await stock(h, admin, source, {
    sku: "MODULE-0132",
    kind: "product",
    onHand: 10,
    reserved: 4,
    lot: "MODULE-LOT-01",
    expiry: "2099-12-31",
  });
  const orderId = randomUUID();
  const reservedMovement = randomUUID();
  const requestId = randomUUID();
  await h.db.insert(inventoryOrders).values({
    id: orderId,
    itemId: lot.itemId,
    quantity: 4,
    reserved: 4,
    buildQuantity: 0,
    status: "ready",
    createdBy: admin.userId,
  });
  await h.db.insert(inventoryStockAllocations).values({
    orderId,
    itemId: lot.itemId,
    positionId: lot.positionId,
    quantity: 4,
  });
  await h.db.insert(inventoryMovements).values({
    id: reservedMovement,
    itemId: lot.itemId,
    orderId,
    actorId: admin.userId,
    requestId,
    kind: "order-reserve",
    onHandDelta: 0,
    reservedDelta: 4,
  });
  await h.db.insert(inventoryStockEvents).values({
    itemId: lot.itemId,
    positionId: lot.positionId,
    movementId: reservedMovement,
    orderId,
    actorId: admin.userId,
    requestId,
    kind: "order-reserve",
    reservedDelta: 4,
  });
  return { admin, source, recovery, remote, parent, child, lot, orderId };
}

export function command(h: TestDb, who: NativeSessionRef, input: Record<string, unknown>) {
  return runWarehouseOperationsCommand(h.db, who, { requestId: randomUUID(), ...input }, signal());
}

export async function counts(h: TestDb, itemId: string) {
  const [row] = await h.db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  return row;
}

export async function position(h: TestDb, id: string) {
  const [row] = await h.db
    .select()
    .from(inventoryStockPositions)
    .where(eq(inventoryStockPositions.id, id));
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Warehouse fixture position is missing");
  return row;
}

export async function incumbentRows(h: TestDb) {
  const [items, positions, orders, allocations, movements, events, details] = await Promise.all([
    h.db.select().from(inventoryItems).orderBy(asc(inventoryItems.id)),
    h.db.execute(sql`SELECT id, item_id, site_id, location_id, lot, serial, expiry_date, state,
          owner_organization_id, on_hand, reserved FROM inventory_stock_positions ORDER BY id`),
    h.db.select().from(inventoryOrders).orderBy(asc(inventoryOrders.id)),
    h.db
      .select()
      .from(inventoryStockAllocations)
      .orderBy(asc(inventoryStockAllocations.positionId)),
    h.db.select().from(inventoryMovements).orderBy(asc(inventoryMovements.id)),
    h.db.select().from(inventoryStockEvents).orderBy(asc(inventoryStockEvents.id)),
    h.db
      .select()
      .from(inventoryStockEventDetails)
      .orderBy(asc(inventoryStockEventDetails.sequence)),
  ]);
  return { items, positions: positions.rows, orders, allocations, movements, events, details };
}
