import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { calculateStockUnits, type SourcingCommand, type SourcingPart } from "./contracts";
import {
  inventoryItemCostOverrides,
  inventoryManufacturerParts,
  inventorySupplierOffers,
  inventorySupplierPriceTiers,
} from "./schema";
import { failSourcing, requireVisibleSourcingOrganizations } from "./scope";

type ScopedId = Pick<SourcingCommand, "siteId" | "itemId">;
type ManufacturerChange = Extract<SourcingCommand, { type: "saveManufacturer" }>;
type OfferChange = Extract<SourcingCommand, { type: "saveOffer" }>;
type TierChange = Extract<SourcingCommand, { type: "setPriceTier" }>;
type OverrideChange = Extract<SourcingCommand, { type: "setCostOverride" }>;

async function findManufacturer(tx: Db, scope: ScopedId, id: string) {
  const table = inventoryManufacturerParts;
  const [entry] = await tx
    .select()
    .from(table)
    .where(and(eq(table.siteId, scope.siteId), eq(table.itemId, scope.itemId), eq(table.id, id)));
  if (entry === undefined) failSourcing("unavailable");
  return entry;
}

async function findOffer(tx: Db, scope: ScopedId, id: string) {
  const table = inventorySupplierOffers;
  const [entry] = await tx
    .select()
    .from(table)
    .where(and(eq(table.siteId, scope.siteId), eq(table.itemId, scope.itemId), eq(table.id, id)));
  if (entry === undefined) failSourcing("unavailable");
  return entry;
}

async function manufacturerOrganizationIds(
  tx: Db,
  scope: ScopedId,
  ...manufacturerIds: (string | null)[]
) {
  const organizations: string[] = [];
  for (const id of new Set(manufacturerIds)) {
    if (id === null) continue;
    organizations.push((await findManufacturer(tx, scope, id)).organizationId);
  }
  return organizations;
}

async function prepareManufacturer(
  tx: Db,
  actor: HydratedActor,
  part: SourcingPart,
  command: ManufacturerChange,
) {
  const { id, itemId, siteId, expectedVersion, organizationId, partNumber } = command;
  const table = inventoryManufacturerParts;
  const existing = id === null ? null : await findManufacturer(tx, command, id);
  await requireVisibleSourcingOrganizations(tx, actor, [
    organizationId,
    ...(existing === null ? [] : [existing.organizationId]),
  ]);
  return async () => {
    if (existing === null) {
      if (!part.canSource) failSourcing("invalid");
      const [created] = await tx
        .insert(table)
        .values({ siteId, itemId, organizationId, partNumber })
        .onConflictDoNothing()
        .returning({ id: table.id });
      if (created === undefined) failSourcing("conflict");
      return;
    }
    if (existing.version !== expectedVersion) failSourcing("stale");
    await tx
      .update(table)
      .set({ organizationId, partNumber, version: existing.version + 1 })
      .where(eq(table.id, existing.id));
  };
}

async function prepareOffer(
  tx: Db,
  actor: HydratedActor,
  part: SourcingPart,
  command: OfferChange,
) {
  const {
    id,
    itemId,
    siteId,
    expectedVersion,
    supplierOrganizationId,
    manufacturerPartId,
    partNumber,
    packQuantity,
    approved,
    available,
  } = command;
  const table = inventorySupplierOffers;
  const existing = id === null ? null : await findOffer(tx, command, id);
  const manufacturerOrganizations = await manufacturerOrganizationIds(
    tx,
    command,
    manufacturerPartId,
    existing?.manufacturerPartId ?? null,
  );
  await requireVisibleSourcingOrganizations(tx, actor, [
    supplierOrganizationId,
    ...(existing === null ? [] : [existing.supplierOrganizationId]),
    ...manufacturerOrganizations,
  ]);
  const changes = {
    supplierOrganizationId,
    manufacturerPartId,
    partNumber,
    packQuantity,
    approved,
    available,
    stockUnit: existing?.packQuantity === packQuantity ? existing.stockUnit : part.unit,
  };
  return async () => {
    if (existing === null) {
      if (!part.canSource) failSourcing("invalid");
      const [created] = await tx
        .insert(table)
        .values({ siteId, itemId, ...changes })
        .onConflictDoNothing()
        .returning({ id: table.id });
      if (created === undefined) failSourcing("conflict");
      return;
    }
    if (existing.version !== expectedVersion) failSourcing("stale");
    await tx
      .update(table)
      .set({ ...changes, version: existing.version + 1 })
      .where(eq(table.id, existing.id));
  };
}

async function prepareTier(tx: Db, actor: HydratedActor, command: TierChange) {
  const { offerId, currency, minPacks, amount } = command;
  const offer = await findOffer(tx, command, offerId);
  await requireVisibleSourcingOrganizations(tx, actor, [
    offer.supplierOrganizationId,
    ...(await manufacturerOrganizationIds(tx, command, offer.manufacturerPartId)),
  ]);
  return async () => {
    const table = inventorySupplierPriceTiers;
    const basis = { packQuantity: offer.packQuantity, stockUnit: offer.stockUnit };
    if (amount === null) {
      await tx
        .delete(table)
        .where(
          and(
            eq(table.offerId, offerId),
            eq(table.currency, currency),
            eq(table.minPacks, minPacks),
            eq(table.packQuantity, basis.packQuantity),
            eq(table.stockUnit, basis.stockUnit),
          ),
        );
      return;
    }
    if (calculateStockUnits(minPacks, offer.packQuantity) === null) failSourcing("invalid");
    await tx
      .insert(table)
      .values({ offerId, currency, minPacks, amount, ...basis })
      .onConflictDoUpdate({
        target: [table.offerId, table.currency, table.minPacks],
        set: { amount, ...basis },
      });
  };
}

async function applyOverride(tx: Db, { itemId, siteId, cost }: OverrideChange) {
  const table = inventoryItemCostOverrides;
  if (cost === null) {
    await tx.delete(table).where(and(eq(table.siteId, siteId), eq(table.itemId, itemId)));
    return;
  }
  await tx
    .insert(table)
    .values({ siteId, itemId, ...cost })
    .onConflictDoUpdate({ target: [table.siteId, table.itemId], set: cost });
}

export async function prepareSourcingChange(
  tx: Db,
  actor: HydratedActor,
  part: SourcingPart,
  command: SourcingCommand,
): Promise<() => Promise<void>> {
  switch (command.type) {
    case "saveManufacturer":
      return prepareManufacturer(tx, actor, part, command);
    case "saveOffer":
      return prepareOffer(tx, actor, part, command);
    case "setPriceTier":
      return prepareTier(tx, actor, command);
    case "setCostOverride":
      return () => applyOverride(tx, command);
  }
}
