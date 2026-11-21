import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { catalogItemPolicy } from "../../catalog/policy";
import type { lockInventoryStock } from "../../stock";
import { managedWarehouseLocation, type WarehouseAccess } from "../access";
import { inventoryStockEvents, inventoryStockPositions } from "../schema";
import { isSubcontractControlledPosition } from "../subcontractProtection";
import type { WarehouseOperationsError } from "./contracts";
import { inventoryStockEventDetails } from "./schema";

export class WarehouseOperationsFailure extends Error {
  constructor(readonly code: WarehouseOperationsError) {
    super(code);
  }
}

export function failOperations(code: WarehouseOperationsError): never {
  throw new WarehouseOperationsFailure(code);
}

export type OperationsActor = { id: string; access: WarehouseAccess };
export type Position = typeof inventoryStockPositions.$inferSelect;
export type StockLocks = Awaited<ReturnType<typeof lockInventoryStock>>;
export type AuditContext = { requestId: string; reason: string };
export type Endpoint = { siteId: string; locationId: string };

export function managedEndpoint(
  actor: OperationsActor,
  locationId: string,
  active = true,
): Endpoint {
  const { site, location } = managedWarehouseLocation(actor.access, locationId);
  if (active && (site.archived || location.archived || location.kind === "structure")) {
    failOperations("incompatibleLocation");
  }
  return { siteId: site.id, locationId };
}

export async function visiblePartPolicy(tx: Db, actor: OperationsActor, itemId: string) {
  const policy = await catalogItemPolicy(tx, itemId);
  if (policy === null || (!actor.access.isAdmin && policy.visibility !== "staff")) {
    failOperations("unavailable");
  }
  return policy;
}

export async function requireVisibleParts(tx: Db, actor: OperationsActor, itemIds: string[]) {
  for (const itemId of new Set(itemIds)) await visiblePartPolicy(tx, actor, itemId);
}

export async function readPosition(tx: Db, id: string) {
  const [position] = await tx
    .select()
    .from(inventoryStockPositions)
    .where(eq(inventoryStockPositions.id, id));
  if (position === undefined) failOperations("unavailable");
  if (await isSubcontractControlledPosition(tx, position)) failOperations("incompatibleStock");
  return position;
}

export function lockedItem(locked: StockLocks, itemId: string) {
  const item = locked.get(itemId);
  if (item === undefined) failOperations("unavailable");
  return item;
}

export async function addOperationEvent(
  tx: Db,
  actor: Pick<OperationsActor, "id">,
  context: AuditContext,
  event: Omit<typeof inventoryStockEvents.$inferInsert, "actorId" | "requestId">,
  details: Omit<typeof inventoryStockEventDetails.$inferInsert, "eventId" | "reason">,
) {
  const [created] = await tx
    .insert(inventoryStockEvents)
    .values({ ...event, actorId: actor.id, requestId: context.requestId })
    .returning({ id: inventoryStockEvents.id });
  if (created === undefined) failOperations("conflict");
  await tx
    .insert(inventoryStockEventDetails)
    .values({ ...details, eventId: created.id, reason: context.reason });
  return created.id;
}
