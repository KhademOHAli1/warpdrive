import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryStockLimit } from "../../schema";
import { lockInventoryStock, postInventoryMovement } from "../../stock";
import { managedWarehouseLocation, requireWarehouseOwner } from "../access";
import {
  inventoryStockEvents,
  inventoryStockPositions,
  type WarehouseStockEventKind,
} from "../schema";
import type { WarehouseOperationsCommand } from "./contracts";
import { inventoryStockEventDetails, inventoryStockInstallations } from "./schema";
import {
  type AuditContext,
  addOperationEvent,
  type Endpoint,
  failOperations,
  lockedItem,
  managedEndpoint,
  type OperationsActor,
  type Position,
  readPosition,
  requireVisibleParts,
  type StockLocks,
  visiblePartPolicy,
} from "./shared";

type Repartition = Extract<WarehouseOperationsCommand, { type: "splitStock" | "mergeStock" }>;
type Install = Extract<WarehouseOperationsCommand, { type: "installComponent" }>;
type Removal = Extract<WarehouseOperationsCommand, { type: "removeComponent" }>;
type Disassembly = Extract<WarehouseOperationsCommand, { type: "disassembleStock" }>;
type Installation = typeof inventoryStockInstallations.$inferSelect;
const installationLimit = 20;

function positionAt(actor: OperationsActor, position: Position, endpoint: Endpoint) {
  managedEndpoint(actor, position.locationId);
  requireWarehouseOwner(actor.access, position.ownerOrganizationId);
  if (position.locationId !== endpoint.locationId) failOperations("stale");
}

function storageEndpoint(actor: OperationsActor, locationId: string) {
  const endpoint = managedEndpoint(actor, locationId);
  if (managedWarehouseLocation(actor.access, locationId).location.kind !== "storage") {
    failOperations("incompatibleLocation");
  }
  return endpoint;
}

function componentRecoveryEndpoints(actor: OperationsActor, command: Removal | Disassembly) {
  const assembly = storageEndpoint(actor, command.assemblyLocationId);
  const destination = storageEndpoint(actor, command.destinationLocationId);
  if (assembly.siteId !== destination.siteId) failOperations("incompatibleLocation");
  return { assembly, destination };
}

function requireAvailableCompanyStock(position: Position) {
  if (position.state !== "available" || position.ownerOrganizationId !== null) {
    failOperations("incompatibleStock");
  }
}

function requireFreeAssembly(actor: OperationsActor, position: Position, endpoint: Endpoint) {
  positionAt(actor, position, endpoint);
  requireAvailableCompanyStock(position);
  if (position.serial === null) failOperations("incompatibleStock");
  if (position.onHand - position.reserved !== 1) failOperations("insufficientStock");
}

function compatibleBulkPositions(source: Position, destination: Position) {
  return (
    source.id !== destination.id &&
    destination.serial === null &&
    source.itemId === destination.itemId &&
    source.lot === destination.lot &&
    source.expiryDate === destination.expiryDate &&
    source.state === destination.state &&
    source.ownerOrganizationId === destination.ownerOrganizationId
  );
}

async function updateOnHand(tx: Db, position: Position, delta: number) {
  await tx
    .update(inventoryStockPositions)
    .set({ onHand: position.onHand + delta })
    .where(eq(inventoryStockPositions.id, position.id));
}

async function createPosition(
  tx: Db,
  original: Position,
  endpoint: Endpoint,
  quantity: number,
  state = original.state,
) {
  const [position] = await tx
    .insert(inventoryStockPositions)
    .values({
      ...endpoint,
      itemId: original.itemId,
      lot: original.lot,
      expiryDate: original.expiryDate,
      ownerOrganizationId: original.ownerOrganizationId,
      state,
      onHand: quantity,
    })
    .returning();
  if (position === undefined) failOperations("conflict");
  return position;
}

function auditPosition(
  tx: Db,
  actor: OperationsActor,
  context: AuditContext,
  position: Position,
  kind: WarehouseStockEventKind,
  onHandDelta: number,
  options: { sourcePositionId?: string; movementId?: string; previousOnHand?: number } = {},
) {
  return addOperationEvent(
    tx,
    actor,
    context,
    {
      itemId: position.itemId,
      positionId: position.id,
      sourcePositionId: options.sourcePositionId,
      movementId: options.movementId,
      state: position.state,
      kind,
      onHandDelta,
    },
    {
      siteId: position.siteId,
      locationId: position.locationId,
      previousOnHand: options.previousOnHand ?? position.onHand,
    },
  );
}

export async function repartitionStock(tx: Db, actor: OperationsActor, command: Repartition) {
  const endpoint = managedEndpoint(actor, command.locationId);
  const hint = await readPosition(tx, command.sourcePositionId);
  positionAt(actor, hint, endpoint);
  await visiblePartPolicy(tx, actor, hint.itemId);
  if (command.type === "mergeStock") {
    const destination = await readPosition(tx, command.destinationPositionId);
    positionAt(actor, destination, endpoint);
    await visiblePartPolicy(tx, actor, destination.itemId);
    if (!compatibleBulkPositions(hint, destination)) failOperations("incompatibleStock");
  }

  await lockInventoryStock(tx, [hint.itemId]);
  const source = await readPosition(tx, command.sourcePositionId);
  positionAt(actor, source, endpoint);
  if (source.serial !== null) failOperations("incompatibleStock");
  if (command.quantity > source.onHand - source.reserved) failOperations("insufficientStock");
  if (command.type === "splitStock" && command.quantity === source.onHand)
    failOperations("incompatibleStock");

  const kind = command.type === "mergeStock" ? "stock-merge" : "stock-split";
  await updateOnHand(tx, source, -command.quantity);
  await auditPosition(tx, actor, command, source, kind, -command.quantity);
  if (command.type === "mergeStock") {
    const destination = await readPosition(tx, command.destinationPositionId);
    positionAt(actor, destination, endpoint);
    if (!compatibleBulkPositions(source, destination)) failOperations("incompatibleStock");
    if (destination.onHand + command.quantity > inventoryStockLimit)
      failOperations("insufficientStock");
    await updateOnHand(tx, destination, command.quantity);
    await auditPosition(tx, actor, command, destination, kind, command.quantity, {
      sourcePositionId: source.id,
    });
  } else {
    const destination = await createPosition(tx, source, endpoint, command.quantity);
    await auditPosition(tx, actor, command, destination, kind, command.quantity, {
      sourcePositionId: source.id,
      previousOnHand: 0,
    });
  }
  return command.requestId;
}

function activeInstallations(tx: Db, assemblyId: string, limit: number) {
  return tx
    .select()
    .from(inventoryStockInstallations)
    .where(
      and(
        eq(inventoryStockInstallations.assemblyPositionId, assemblyId),
        isNull(inventoryStockInstallations.removedEventId),
      ),
    )
    .orderBy(asc(inventoryStockInstallations.id))
    .limit(limit);
}

function postStructureMovement(
  tx: Db,
  actor: OperationsActor,
  context: AuditContext,
  stock: StockLocks,
  position: Position,
  kind: "component-install" | "component-remove" | "stock-disassemble",
  onHandDelta: number,
) {
  return postInventoryMovement(tx, lockedItem(stock, position.itemId), {
    actorId: actor.id,
    requestId: context.requestId,
    kind,
    onHandDelta,
    reservedDelta: 0,
  });
}

export async function installComponent(tx: Db, actor: OperationsActor, command: Install) {
  const endpoint = storageEndpoint(actor, command.locationId);
  const assemblyHint = await readPosition(tx, command.assemblyPositionId);
  const componentHint = await readPosition(tx, command.componentPositionId);
  positionAt(actor, assemblyHint, endpoint);
  positionAt(actor, componentHint, endpoint);
  await visiblePartPolicy(tx, actor, assemblyHint.itemId);
  await visiblePartPolicy(tx, actor, componentHint.itemId);
  if (assemblyHint.itemId === componentHint.itemId) failOperations("incompatibleStock");
  const stock = await lockInventoryStock(tx, [assemblyHint.itemId, componentHint.itemId]);

  const assembly = await readPosition(tx, assemblyHint.id);
  requireFreeAssembly(actor, assembly, endpoint);
  const component = await readPosition(tx, componentHint.id);
  positionAt(actor, component, endpoint);
  requireAvailableCompanyStock(component);
  if (command.quantity > component.onHand - component.reserved) failOperations("insufficientStock");
  if ((await activeInstallations(tx, component.id, 1)).length > 0) {
    failOperations("incompatibleStock");
  }
  if ((await activeInstallations(tx, assembly.id, installationLimit)).length >= installationLimit) {
    failOperations("assemblyLimit");
  }

  const delta = -command.quantity;
  const kind = "component-install";
  const movementId = await postStructureMovement(tx, actor, command, stock, component, kind, delta);
  await updateOnHand(tx, component, delta);
  const installedEventId = await auditPosition(tx, actor, command, component, kind, delta, {
    movementId,
  });
  await tx.insert(inventoryStockInstallations).values({
    assemblyPositionId: assembly.id,
    componentPositionId: component.id,
    quantity: command.quantity,
    installedEventId,
  });
  await auditPosition(tx, actor, command, assembly, kind, 0);
  return command.requestId;
}

async function readActiveInstallation(tx: Db, id: string) {
  const [installation] = await tx
    .select()
    .from(inventoryStockInstallations)
    .where(
      and(
        eq(inventoryStockInstallations.id, id),
        isNull(inventoryStockInstallations.removedEventId),
      ),
    );
  if (installation === undefined) failOperations("unavailable");
  return installation;
}

async function restoreComponent(
  tx: Db,
  actor: OperationsActor,
  command: AuditContext,
  stock: StockLocks,
  installation: Installation,
  destination: Endpoint,
) {
  const component = await readPosition(tx, installation.componentPositionId);
  const quantity = installation.quantity;
  const kind = "component-remove";
  const movementId = await postStructureMovement(
    tx,
    actor,
    command,
    stock,
    component,
    kind,
    quantity,
  );
  let returned: Position;
  if (component.serial === null) {
    returned = await createPosition(tx, component, destination, quantity, "available");
  } else {
    if (quantity !== 1 || component.onHand !== 0 || component.reserved !== 0) {
      failOperations("conflict");
    }
    const state = "available";
    await tx
      .update(inventoryStockPositions)
      .set({ ...destination, onHand: quantity, state })
      .where(eq(inventoryStockPositions.id, component.id));
    returned = { ...component, ...destination, onHand: quantity, state };
  }
  const removedEventId = await auditPosition(tx, actor, command, returned, kind, quantity, {
    movementId,
    sourcePositionId: returned.id === component.id ? undefined : component.id,
    previousOnHand: 0,
  });
  await tx
    .update(inventoryStockInstallations)
    .set({ removedEventId, recoveredPositionId: returned.id })
    .where(eq(inventoryStockInstallations.id, installation.id));
}

async function readRecoveryAssembly(
  tx: Db,
  actor: OperationsActor,
  assemblyId: string,
  endpoint: Endpoint,
) {
  const position = await readPosition(tx, assemblyId);
  positionAt(actor, position, endpoint);
  await visiblePartPolicy(tx, actor, position.itemId);
  return position.itemId;
}

export async function removeComponent(tx: Db, actor: OperationsActor, command: Removal) {
  const endpoints = componentRecoveryEndpoints(actor, command);
  const target = await readActiveInstallation(tx, command.installationId);
  const assemblyItemId = await readRecoveryAssembly(
    tx,
    actor,
    target.assemblyPositionId,
    endpoints.assembly,
  );
  const component = await readPosition(tx, target.componentPositionId);
  await visiblePartPolicy(tx, actor, component.itemId);
  const stock = await lockInventoryStock(tx, [assemblyItemId, component.itemId]);
  const assembly = await readPosition(tx, target.assemblyPositionId);
  requireFreeAssembly(actor, assembly, endpoints.assembly);
  const installation = await readActiveInstallation(tx, command.installationId);
  await restoreComponent(tx, actor, command, stock, installation, endpoints.destination);
  await auditPosition(tx, actor, command, assembly, "component-remove", 0);
  return command.requestId;
}

export async function disassembleStock(tx: Db, actor: OperationsActor, command: Disassembly) {
  const endpoints = componentRecoveryEndpoints(actor, command);
  const assemblyItemId = await readRecoveryAssembly(
    tx,
    actor,
    command.assemblyPositionId,
    endpoints.assembly,
  );
  const known = await activeInstallations(tx, command.assemblyPositionId, installationLimit + 1);
  if (known.length === 0) failOperations("incompatibleStock");
  if (known.length > installationLimit) failOperations("assemblyLimit");

  const componentItems: string[] = [];
  for (const entry of known) {
    const component = await readPosition(tx, entry.componentPositionId);
    componentItems.push(component.itemId);
  }
  await requireVisibleParts(tx, actor, componentItems);
  const stock = await lockInventoryStock(tx, [assemblyItemId, ...componentItems]);

  const assembly = await readPosition(tx, command.assemblyPositionId);
  requireFreeAssembly(actor, assembly, endpoints.assembly);
  const current = await activeInstallations(tx, assembly.id, installationLimit + 1);
  // A concurrent installation could introduce an item outside the set of locked balances.
  if (
    known.length !== current.length ||
    known.some((entry, index) => entry.id !== current[index]?.id)
  ) {
    failOperations("stale");
  }
  const kind = "stock-disassemble";
  const movementId = await postStructureMovement(tx, actor, command, stock, assembly, kind, -1);
  await updateOnHand(tx, assembly, -1);
  await auditPosition(tx, actor, command, assembly, kind, -1, { movementId });
  for (const installation of current) {
    await restoreComponent(tx, actor, command, stock, installation, endpoints.destination);
  }
  return command.requestId;
}

export async function replayStructureCommand(tx: Db, actor: OperationsActor, requestId: string) {
  const records = await tx
    .select({
      itemId: inventoryStockEvents.itemId,
      locationId: inventoryStockEventDetails.locationId,
      ownerOrganizationId: inventoryStockPositions.ownerOrganizationId,
    })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .innerJoin(
      inventoryStockPositions,
      eq(inventoryStockPositions.id, inventoryStockEvents.positionId),
    )
    .where(
      and(
        eq(inventoryStockEvents.actorId, actor.id),
        eq(inventoryStockEvents.requestId, requestId),
      ),
    );
  if (records.length === 0) failOperations("conflict");
  for (const { locationId, ownerOrganizationId } of records) {
    if (locationId === null) failOperations("conflict");
    managedEndpoint(actor, locationId, false);
    requireWarehouseOwner(actor.access, ownerOrganizationId);
  }
  await requireVisibleParts(
    tx,
    actor,
    records.map(({ itemId }) => itemId),
  );
  return requestId;
}
