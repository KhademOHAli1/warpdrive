import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type CatalogItemPolicy, catalogItemPolicy } from "../catalog/policy";
import { purchaseOrderLines } from "../purchasing/schema";
import { isQualityControlledPosition } from "../quality/gates";
import { isEngineeringControlledPosition } from "../releases/changes/dispositionGuards";
import { isReturnControlledPosition } from "../returns/protection";
import { InventoryStockError, lockInventoryStock, postInventoryMovement } from "../stock";
import {
  failWarehouse,
  managedWarehouseLocation,
  requireWarehouseOwner,
  type WarehouseAccess,
} from "./access";
import { readStockPositionRows, unlocatedBalance } from "./balances";
import type { WarehouseCommand } from "./contracts";
import { hasOpenProductionBuild, hasOpenWarehouseTransfer } from "./operations/placement";
import { isReceivableStockItem } from "./reads";
import {
  inventoryStockEvents,
  inventoryStockIncoming,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
} from "./schema";

import {
  hasSubcontractLocationUse,
  isSubcontractControlledPosition,
} from "./subcontractProtection";

type PositionRow = typeof inventoryStockPositions.$inferSelect;
type PositionInsert = typeof inventoryStockPositions.$inferInsert;
type IncomingRow = typeof inventoryStockIncoming.$inferSelect;
type Policy = Extract<WarehouseCommand, { type: "saveLocationPolicy" }>;
type Placement = Extract<WarehouseCommand, { type: "receive" | "reconcile" }>;
type Incoming = Extract<WarehouseCommand, { type: "createIncoming" }>;
type PositionState = Extract<WarehouseCommand, { type: "setPositionState" }>;
type CancelIncoming = Extract<WarehouseCommand, { type: "cancelIncoming" }>;
type ResolvedLocation = ReturnType<typeof managedWarehouseLocation>;

type Target = ResolvedLocation & { itemId: string | null; policy: CatalogItemPolicy | null };
type PurchaseOrigin = { orderId: string; buildOutputId?: string };

async function readPosition(tx: Db, id: string) {
  return (
    await tx.select().from(inventoryStockPositions).where(eq(inventoryStockPositions.id, id))
  )[0];
}

async function readPlan(tx: Db, id: string) {
  return (
    await tx.select().from(inventoryStockIncoming).where(eq(inventoryStockIncoming.id, id))
  )[0];
}

/** Check only after taking the SKU lock, which also serializes issuing the owning PO. */
async function requireIncomingOwnership(tx: Db, planId: string, purchaseOrderId: string | null) {
  const [line] = await tx
    .select({ orderId: purchaseOrderLines.orderId })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.incomingId, planId));
  if ((line?.orderId ?? null) !== purchaseOrderId) failWarehouse("unavailable");
}

export async function resolveWarehouseTarget(
  tx: Db,
  access: WarehouseAccess,
  command: WarehouseCommand,
): Promise<Target> {
  if (command.type === "reconcile" && !access.isAdmin) failWarehouse("unavailable");
  const row =
    "locationId" in command
      ? command
      : command.type === "cancelIncoming"
        ? await readPlan(tx, command.id)
        : await readPosition(tx, command.id);
  if (row === undefined) failWarehouse("unavailable");
  const location = managedWarehouseLocation(access, row.locationId);
  if (!("itemId" in row)) return { ...location, itemId: null, policy: null };
  const policy = await catalogItemPolicy(tx, row.itemId);
  if (policy === null || (!access.isAdmin && policy.visibility !== "staff"))
    failWarehouse("unavailable");
  return { ...location, itemId: row.itemId, policy };
}

function requirePlaceable({ site, location }: ResolvedLocation) {
  if (site.archived || location.archived || location.kind === "structure")
    failWarehouse("incompatibleLocation");
}

async function stockItem(tx: Db, itemId: string) {
  const item = (await lockInventoryStock(tx, [itemId])).get(itemId);
  if (item === undefined) failWarehouse("unavailable");
  return item;
}

async function requireBinClearForDemotion(
  tx: Db,
  siteId: string,
  locationId: string,
  kind: "structure" | "external",
) {
  if (await hasOpenProductionBuild(tx, siteId, locationId)) failWarehouse("conflict");
  const [stock] = await tx
    .select({ id: inventoryStockPositions.id })
    .from(inventoryStockPositions)
    .where(
      and(
        eq(inventoryStockPositions.locationId, locationId),
        gt(
          kind === "structure" ? inventoryStockPositions.onHand : inventoryStockPositions.reserved,
          0,
        ),
      ),
    )
    .limit(1);
  if (stock !== undefined) failWarehouse("conflict");
}

async function updateLocationPolicy(
  tx: Db,
  { site, location }: ResolvedLocation,
  { kind }: Policy,
) {
  if (site.archived || location.archived) failWarehouse("incompatibleLocation");
  if (kind === location.kind) return location.id;
  if (await hasSubcontractLocationUse(tx, site.id, location.id)) failWarehouse("conflict");
  if (kind !== "storage") await requireBinClearForDemotion(tx, site.id, location.id, kind);
  if (kind === "external") {
    const [pendingPurchase] = await tx
      .select({ id: purchaseOrderLines.id })
      .from(inventoryStockIncoming)
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.incomingId, inventoryStockIncoming.id))
      .where(
        and(
          eq(inventoryStockIncoming.locationId, location.id),
          eq(inventoryStockIncoming.cancelled, false),
          lt(inventoryStockIncoming.received, inventoryStockIncoming.quantity),
        ),
      )
      .limit(1);
    if (pendingPurchase !== undefined) failWarehouse("conflict");
  }
  if (kind === "structure") {
    if (await hasOpenWarehouseTransfer(tx, site.id, location.id)) failWarehouse("conflict");
    const [incoming] = await tx
      .select({ id: inventoryStockIncoming.id })
      .from(inventoryStockIncoming)
      .where(
        and(
          eq(inventoryStockIncoming.locationId, location.id),
          eq(inventoryStockIncoming.cancelled, false),
          lt(inventoryStockIncoming.received, inventoryStockIncoming.quantity),
        ),
      )
      .limit(1);
    if (incoming !== undefined) failWarehouse("conflict");
  }
  await tx
    .insert(inventoryStockLocationPolicies)
    .values({ siteId: site.id, locationId: location.id, kind })
    .onConflictDoUpdate({
      target: [inventoryStockLocationPolicies.siteId, inventoryStockLocationPolicies.locationId],
      set: { kind },
    });
  return location.id;
}

async function insertPosition(tx: Db, values: PositionInsert) {
  const [created] = await tx
    .insert(inventoryStockPositions)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: inventoryStockPositions.id });
  if (created === undefined) failWarehouse(values.serial == null ? "conflict" : "duplicateSerial");
  return created.id;
}

async function deliverIncoming(
  tx: Db,
  command: Extract<Placement, { type: "receive" }>,
  purchaseOrderId: string | null,
): Promise<void> {
  if (command.incomingId === null) {
    if (purchaseOrderId !== null) failWarehouse("planMismatch");
    return;
  }
  await requireIncomingOwnership(tx, command.incomingId, purchaseOrderId);
  const plan = await readPlan(tx, command.incomingId);
  if (
    plan === undefined ||
    plan.cancelled ||
    plan.itemId !== command.itemId ||
    plan.locationId !== command.locationId ||
    plan.ownerOrganizationId !== command.ownerOrganizationId ||
    command.quantity > plan.quantity - plan.received
  )
    failWarehouse("planMismatch");
  await tx
    .update(inventoryStockIncoming)
    .set({ received: plan.received + command.quantity })
    .where(eq(inventoryStockIncoming.id, plan.id));
}

function assertPhysicalInput(target: Target, command: Placement | Incoming) {
  requirePlaceable(target);
  if (target.policy === null || !isReceivableStockItem(target.policy)) failWarehouse("invalid");
  if (command.type === "createIncoming") return;
  if (command.serial === null && target.policy.flags.trackable) failWarehouse("invalid");
  if (command.serial !== null && command.quantity !== 1) failWarehouse("invalid");
}

async function placeStock(
  tx: Db,
  access: WarehouseAccess,
  target: Target,
  actorId: string,
  command: Placement,
  purchase?: PurchaseOrigin,
) {
  assertPhysicalInput(target, command);
  if (purchase !== undefined) {
    if (target.location.kind !== "storage") failWarehouse("incompatibleLocation");
    if (purchase.buildOutputId !== undefined && command.state !== "hold") {
      failWarehouse("planMismatch");
    }
  }
  requireWarehouseOwner(access, command.ownerOrganizationId);
  const {
    itemId,
    locationId,
    quantity,
    lot,
    serial,
    expiryDate,
    state,
    ownerOrganizationId,
    requestId,
  } = command;
  const item = await stockItem(tx, itemId);
  let movementId: string | null = null;
  let incomingId: string | null = null;
  if (command.type === "reconcile") {
    const balance = unlocatedBalance(item, await readStockPositionRows(tx, [itemId]));
    if (quantity > balance.onHand - balance.reserved) failWarehouse("insufficientStock");
  } else {
    await deliverIncoming(tx, command, purchase?.orderId ?? null);
    movementId = await postInventoryMovement(tx, item, {
      actorId,
      requestId,
      kind: "receipt",
      onHandDelta: quantity,
      reservedDelta: 0,
    });
    incomingId = command.incomingId;
  }
  const positionId = await insertPosition(tx, {
    itemId,
    siteId: target.site.id,
    locationId,
    lot,
    serial,
    expiryDate,
    state,
    ownerOrganizationId,
    onHand: quantity,
    buildOutputId: purchase?.buildOutputId,
  });
  await tx.insert(inventoryStockEvents).values({
    itemId,
    positionId,
    incomingId,
    movementId,
    actorId,
    requestId,
    kind: command.type === "receive" ? "receipt" : "reconcile",
    onHandDelta: quantity,
    incomingDelta: incomingId === null ? 0 : -quantity,
    state,
  });
  return positionId;
}

/** Core purchasing owns the order and build locks before attributing a supplier receipt. */
export async function applyPurchaseWarehouseReceipt(
  tx: Db,
  access: WarehouseAccess,
  actorId: string,
  command: Extract<Placement, { type: "receive" }>,
  purchase: PurchaseOrigin,
) {
  const target = await resolveWarehouseTarget(tx, access, command);
  return placeStock(tx, access, target, actorId, command, purchase);
}

async function createIncoming(
  tx: Db,
  access: WarehouseAccess,
  target: Target,
  actorId: string,
  command: Incoming,
) {
  assertPhysicalInput(target, command);
  requireWarehouseOwner(access, command.ownerOrganizationId);
  const { itemId, locationId, quantity, expectedDate, reference, ownerOrganizationId, requestId } =
    command;
  await stockItem(tx, itemId);
  const [plan] = await tx
    .insert(inventoryStockIncoming)
    .values({
      itemId,
      siteId: target.site.id,
      locationId,
      quantity,
      expectedDate,
      reference,
      ownerOrganizationId,
    })
    .returning({ id: inventoryStockIncoming.id });
  if (plan === undefined) failWarehouse("conflict");
  await tx.insert(inventoryStockEvents).values({
    itemId,
    incomingId: plan.id,
    actorId,
    requestId,
    kind: "incoming-create",
    incomingDelta: quantity,
  });
  return plan.id;
}

async function cancelIncoming(
  tx: Db,
  actorId: string,
  target: Target,
  { id, requestId }: CancelIncoming,
) {
  if (target.itemId === null) failWarehouse("unavailable");
  await stockItem(tx, target.itemId);
  const plan: IncomingRow | undefined = await readPlan(tx, id);
  if (plan === undefined) failWarehouse("unavailable");
  await requireIncomingOwnership(tx, id, null);
  if (plan.cancelled) return plan.id;
  const remaining = plan.quantity - plan.received;
  if (remaining === 0) failWarehouse("planMismatch");
  await tx
    .update(inventoryStockIncoming)
    .set({ cancelled: true })
    .where(eq(inventoryStockIncoming.id, id));
  await tx.insert(inventoryStockEvents).values({
    itemId: plan.itemId,
    incomingId: id,
    actorId,
    requestId,
    kind: "incoming-cancel",
    incomingDelta: -remaining,
  });
  return id;
}

export async function movePositionState(
  tx: Db,
  position: PositionRow,
  state: PositionState["state"],
  quantity: number,
) {
  if (quantity > position.onHand - position.reserved) failWarehouse("insufficientStock");
  if (quantity === position.onHand) {
    await tx
      .update(inventoryStockPositions)
      .set({ state })
      .where(eq(inventoryStockPositions.id, position.id));
    return { positionId: position.id, sourcePositionId: null, onHandDelta: 0 };
  }
  const {
    id,
    itemId,
    siteId,
    locationId,
    buildOutputId,
    lot,
    serial,
    expiryDate,
    ownerOrganizationId,
  } = position;
  await tx
    .update(inventoryStockPositions)
    .set({ onHand: position.onHand - quantity })
    .where(eq(inventoryStockPositions.id, id));
  const positionId = await insertPosition(tx, {
    itemId,
    siteId,
    locationId,
    buildOutputId,
    onHand: quantity,
    lot,
    serial,
    expiryDate,
    ownerOrganizationId,
    state,
  });
  return { positionId, sourcePositionId: id, onHandDelta: quantity };
}

async function setPositionState(tx: Db, actorId: string, target: Target, command: PositionState) {
  const { id, state, quantity, requestId } = command;
  if (target.itemId === null) failWarehouse("unavailable");
  await stockItem(tx, target.itemId);
  const position = await readPosition(tx, id);
  if (position === undefined) failWarehouse("unavailable");
  if (position.locationId !== target.location.id) failWarehouse("conflict");
  if (
    (await isSubcontractControlledPosition(tx, position)) ||
    (await isQualityControlledPosition(tx, position)) ||
    (await isReturnControlledPosition(tx, position)) ||
    (await isEngineeringControlledPosition(tx, position))
  )
    failWarehouse("conflict");
  if (position.state === state) {
    if (quantity > position.onHand) failWarehouse("insufficientStock");
    return id;
  }
  const effect = await movePositionState(tx, position, state, quantity);
  await tx.insert(inventoryStockEvents).values({
    itemId: position.itemId,
    actorId,
    requestId,
    kind: "state",
    previousState: position.state,
    state,
    ...effect,
  });
  return effect.positionId;
}

export async function applyWarehouseCommand(
  tx: Db,
  access: WarehouseAccess,
  target: Target,
  actorId: string,
  command: WarehouseCommand,
) {
  try {
    switch (command.type) {
      case "saveLocationPolicy":
        return await updateLocationPolicy(tx, target, command);
      case "receive":
      case "reconcile":
        return await placeStock(tx, access, target, actorId, command);
      case "createIncoming":
        return await createIncoming(tx, access, target, actorId, command);
      case "cancelIncoming":
        return await cancelIncoming(tx, actorId, target, command);
      case "setPositionState":
        return await setPositionState(tx, actorId, target, command);
    }
  } catch (error) {
    if (error instanceof InventoryStockError) failWarehouse("insufficientStock");
    throw error;
  }
}
