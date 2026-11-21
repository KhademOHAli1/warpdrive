import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import type { HydratedActor } from "@/server/hydrateActor";
import { readBuildAllocations, readBuildMaterials } from "../production/allocations";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
  type ProductionBuildRow,
} from "../production/buildSchema";
import type { SubcontractCommand } from "../production/contracts";
import { failProduction } from "../production/failure";
import { purchaseOrderLines, purchaseOrders } from "../purchasing/schema";
import {
  readAvailablePurchaseOffers,
  readPurchaseParts,
  readPurchaseSiteAccess,
  requirePurchaseLocation,
} from "../purchasing/scope";
import type { WarehouseAccess } from "../warehouse/access";
import { inventorySubcontractMaterials, inventorySubcontracts } from "./schema";

type Link = Extract<SubcontractCommand, { type: "linkSubcontract" }>;
type Order = typeof purchaseOrders.$inferSelect;

export async function lockSubcontractPurchase(tx: Db, orderId: string) {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for("update");
  if (order === undefined) failProduction("unavailable");
  return order;
}

async function validCompanyMaterials(tx: Db, build: ProductionBuildRow, requested: string[]) {
  const materials = await readBuildMaterials(tx, build.id);
  const company = new Set(requested);
  const selected = materials.filter(({ id, consumable }) => company.has(id) && !consumable);
  if (selected.length !== company.size) failProduction("invalid");
  const allocations = await readBuildAllocations(tx, build.id);
  if (allocations.some(({ material }) => !company.has(material.id))) failProduction("subcontract");
  const vendorAssemblies = materials.flatMap(({ id, requiredReleaseId }) =>
    !company.has(id) && requiredReleaseId !== null ? [requiredReleaseId] : [],
  );
  if (vendorAssemblies.length === 0) return selected;
  const [child] = await tx
    .select({ id: inventoryProductionBuilds.id })
    .from(inventoryProductionBuilds)
    .where(
      and(
        eq(inventoryProductionBuilds.parentId, build.id),
        inArray(inventoryProductionBuilds.releaseId, vendorAssemblies),
        ne(inventoryProductionBuilds.status, "closed"),
        ne(inventoryProductionBuilds.status, "cancelled"),
      ),
    )
    .limit(1);
  if (child !== undefined) failProduction("subcontract");
  return selected;
}

async function requireEligibleDraft(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  order: Order,
  command: Link,
  signal: AbortSignal,
) {
  const sites = await readPurchaseSiteAccess(tx, actor);
  if (!sites.some(({ site }) => site.id === build.siteId && site.canBuy))
    failProduction("unavailable");
  if (order.siteId !== build.siteId) failProduction("unavailable");
  if (order.status !== "draft" || build.status !== "planned") failProduction("subcontract");
  await requirePurchaseLocation(tx, order.siteId, order.locationId);
  const [line] = await tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(eq(purchaseOrderLines.id, command.lineId), eq(purchaseOrderLines.orderId, order.id)),
    );
  if (
    line === undefined ||
    line.itemId !== build.itemId ||
    line.orderedUnits !== build.quantity ||
    line.stockUnit !== build.stockUnit ||
    line.trackable !== build.trackable
  )
    failProduction("subcontract");
  const orgs = await listOrgOptions(tx, actor, signal);
  const offers = await readAvailablePurchaseOffers(
    tx,
    build.siteId,
    await readPurchaseParts(tx, actor),
    orgs,
    [line.offerId],
  );
  const [match] = offers;
  if (
    match?.manufacturerOrganizationId !== order.supplierOrganizationId ||
    match.offer.supplierOrganizationId !== order.supplierOrganizationId ||
    match.offer.version !== line.offerVersion ||
    match.offer.packQuantity !== line.packQuantity
  )
    failProduction("subcontract");
}

export async function linkSubcontract(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  build: ProductionBuildRow,
  order: Order,
  command: Link,
  signal: AbortSignal,
) {
  const vendor = access.locations.find(({ id }) => id === command.supplierBinId);
  if (vendor?.siteId !== build.siteId || vendor.kind !== "external" || vendor.archived)
    failProduction("unavailable");
  await requireEligibleDraft(tx, actor, build, order, command, signal);
  const [output] = await tx
    .select({ id: inventoryProductionOutputs.id })
    .from(inventoryProductionOutputs)
    .where(eq(inventoryProductionOutputs.buildId, build.id))
    .limit(1);
  if (output !== undefined) failProduction("subcontract");
  const [incumbent] = await tx
    .select({ buildId: inventorySubcontracts.buildId })
    .from(inventorySubcontracts)
    .where(eq(inventorySubcontracts.lineId, command.lineId));
  if (incumbent !== undefined) failProduction("subcontract");
  const company = await validCompanyMaterials(tx, build, command.companyMaterialIds);
  const inserted = await tx
    .insert(inventorySubcontracts)
    .values({
      buildId: build.id,
      orderId: order.id,
      lineId: command.lineId,
      siteId: build.siteId,
      supplierBinId: vendor.id,
      createdBy: actor.id,
    })
    .onConflictDoNothing()
    .returning({ id: inventorySubcontracts.buildId });
  if (inserted.length !== 1) failProduction("subcontract");
  if (company.length > 0)
    await tx
      .insert(inventorySubcontractMaterials)
      .values(company.map(({ id }) => ({ buildId: build.id, materialId: id })));
}
