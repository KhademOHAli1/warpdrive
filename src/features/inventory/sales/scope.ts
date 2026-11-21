import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { canSee } from "@/features/permissions/canSee";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor, readInventoryDeal } from "../access";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicies } from "../catalog/policy";
import { inventoryPartFamilies, inventoryPartProfiles } from "../catalog/schema";
import { inventoryItems } from "../schema";
import type { SalesPart, SalesWorkspace } from "./contracts";
import { failSales } from "./failure";

export async function requireSalesActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const actor = await currentInventoryActor(tx, who, signal);
  if (actor === null || actor.projectsGuestOnly === true) failSales("unavailable");
  return actor;
}

function postalAddress(address: Record<string, unknown> | null) {
  if (address === null) return null;
  function field(key: string) {
    const value = address?.[key];
    return typeof value === "string" ? value.trim() : "";
  }
  const city = [field("postal") || field("postalCode") || field("zip"), field("city")]
    .filter(Boolean)
    .join(" ");
  const lines = [
    field("street") || field("line1"),
    field("line2"),
    city,
    field("region") || field("state"),
    field("country"),
  ].filter(Boolean);
  return lines.length === 0 ? null : lines.join("\n").slice(0, 1000);
}

export async function readSalesDeal(
  tx: Db,
  actor: HydratedActor,
  dealId: string,
): Promise<SalesWorkspace["deal"]> {
  const visible = await readInventoryDeal(tx, actor, dealId);
  if (visible === null) return null;
  const [deal] = await tx
    .select({ currency: deals.currency, organizationId: deals.orgId, personId: deals.personId })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (deal === undefined) return null;
  let customerName = null;
  let address = null;
  if (deal.organizationId !== null) {
    const [customer] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        address: organizations.address,
        ownerId: organizations.ownerId,
        visibilityLevel: organizations.visibilityLevel,
        visibilityGroupId: organizations.visibilityGroupId,
        visibleToUserIds: organizations.visibleToUserIds,
      })
      .from(organizations)
      .where(and(eq(organizations.id, deal.organizationId), isNull(organizations.deletedAt)));
    if (customer !== undefined && canSee(actor, { ...customer, kind: "organization" })) {
      customerName = customer.name;
      address = postalAddress(customer.address);
    }
  }
  if (customerName === null && deal.personId !== null) {
    const [person] = await tx
      .select({
        name: persons.name,
        ownerId: persons.ownerId,
        visibilityLevel: persons.visibilityLevel,
        visibilityGroupId: persons.visibilityGroupId,
        visibleToUserIds: persons.visibleToUserIds,
      })
      .from(persons)
      .where(and(eq(persons.id, deal.personId), isNull(persons.deletedAt)));
    if (person !== undefined && canSee(actor, { kind: "person", ...person }))
      customerName = person.name;
  }
  return { ...visible, currency: deal.currency, customerName, address };
}

export async function readSalesSites(tx: Db) {
  return tx
    .select({
      id: directorySites.id,
      code: directorySites.code,
      name: directorySites.name,
      archived: directorySites.archived,
    })
    .from(directorySites)
    .orderBy(asc(directorySites.code), asc(directorySites.id));
}

export async function readSalesPartAccess(tx: Db, actor: HydratedActor) {
  const policies = await catalogItemPolicies(tx);
  const visible = new Set<string>();
  const sellable = new Set<string>();
  for (const [id, policy] of policies) {
    if (actor.type !== "admin" && policy.visibility !== "staff") continue;
    visible.add(id);
    if (canHoldInventory(policy) && policy.flags.salable) sellable.add(id);
  }
  return { visible, sellable };
}

export async function readSellableParts(tx: Db, ids: ReadonlySet<string>): Promise<SalesPart[]> {
  if (ids.size === 0) return [];
  const code = sql<string>`coalesce(${inventoryPartFamilies.code}, ${inventoryItems.sku})`;
  const rows = await tx
    .select({
      id: inventoryItems.id,
      code,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
      unit: inventoryPartProfiles.unit,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, inventoryItems.id))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartFamilies.id, inventoryPartProfiles.familyId))
    .where(inArray(inventoryItems.id, [...ids]))
    .orderBy(asc(code), asc(inventoryItems.revision), asc(inventoryItems.id));
  return rows.map(({ unit, ...row }) => ({ ...row, unit: unit ?? "each" }));
}
