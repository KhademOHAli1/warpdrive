import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
import {
  operationsSiteCapabilities,
  readOperationsSiteGrants,
} from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { catalogItemPolicies } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryItems } from "../schema";
import { inventoryManufacturerParts, inventorySupplierOffers } from "../sourcing/schema";
import { canSourcePart, requireVisibleSourcingOrganizations } from "../sourcing/scope";
import { inventoryStockLocationPolicies } from "../warehouse/schema";
import type {
  PurchaseOffer,
  PurchasingError,
  PurchasingLocation,
  PurchasingSite,
} from "./contracts";

export class PurchasingFailure extends Error {
  constructor(readonly code: PurchasingError) {
    super(code);
  }
}

export function failPurchasing(code: PurchasingError): never {
  throw new PurchasingFailure(code);
}

export type PurchaseSiteAccess = {
  site: PurchasingSite;
  canBrowseDrafts: boolean;
};

export async function readPurchaseSiteAccess(
  tx: Db,
  actor: HydratedActor,
): Promise<PurchaseSiteAccess[]> {
  const isAdmin = actor.type === "admin";
  const grants = isAdmin ? [] : await readOperationsSiteGrants(tx, actor.id);
  const relevant = grants.filter(({ role }) => role !== "asset_viewer" && role !== "asset_manager");
  const rows = await tx
    .select({ site: directorySites, directoryRole: directorySiteGrants.role })
    .from(directorySites)
    .leftJoin(
      directorySiteGrants,
      and(
        eq(directorySites.id, directorySiteGrants.siteId),
        eq(directorySiteGrants.userId, actor.id),
      ),
    )
    .where(
      isAdmin
        ? undefined
        : or(
            eq(directorySiteGrants.role, "manager"),
            eq(directorySiteGrants.role, "viewer"),
            inArray(
              directorySites.id,
              relevant.map(({ siteId }) => siteId),
            ),
          ),
    )
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  return rows.map(({ site, directoryRole }) => {
    const capabilities = operationsSiteCapabilities(relevant, isAdmin, site.id);
    return {
      site: {
        ...site,
        canBuy: capabilities.canBuy && !site.archived,
        canReceive:
          (capabilities.canManageWarehouse || directoryRole === "manager") && !site.archived,
        canReadCosts: capabilities.canViewCosts,
      },
      canBrowseDrafts: capabilities.canBuy,
    };
  });
}

export async function readPurchaseLocations(tx: Db, siteId: string) {
  return tx
    .select({
      id: directoryLocations.id,
      name: directoryLocations.name,
      code: directoryLocations.code,
      archived: directoryLocations.archived,
      kind: inventoryStockLocationPolicies.kind,
    })
    .from(directoryLocations)
    .leftJoin(
      inventoryStockLocationPolicies,
      and(
        eq(directoryLocations.siteId, inventoryStockLocationPolicies.siteId),
        eq(directoryLocations.id, inventoryStockLocationPolicies.locationId),
      ),
    )
    .where(eq(directoryLocations.siteId, siteId))
    .orderBy(asc(directoryLocations.code), asc(directoryLocations.id));
}

type SiteLocation = Awaited<ReturnType<typeof readPurchaseLocations>>[number];

function eligiblePurchaseLocation(location: SiteLocation) {
  return !location.archived && (location.kind === null || location.kind === "storage");
}

export function purchaseLocationChoices(rows: SiteLocation[]): PurchasingLocation[] {
  return rows.filter(eligiblePurchaseLocation).map(({ id, name, code }) => ({ id, name, code }));
}

export async function requirePurchaseLocation(tx: Db, siteId: string, locationId: string) {
  const rows = await readPurchaseLocations(tx, siteId);
  const location = rows.find(({ id }) => id === locationId);
  if (location === undefined || !eligiblePurchaseLocation(location)) failPurchasing("unavailable");
}

export async function readPurchaseParts(tx: Db, actor: HydratedActor) {
  const policies = await catalogItemPolicies(tx);
  const rows = await tx
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
      unit: inventoryPartProfiles.unit,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryItems.id, inventoryPartProfiles.itemId));
  return new Map(
    rows.flatMap(({ id, name, revision, unit }) => {
      const policy = policies.get(id);
      if (policy === undefined || (actor.type !== "admin" && policy.visibility !== "staff")) {
        return [];
      }
      return [
        [
          id,
          {
            code: policy.code,
            name,
            revision,
            unit: unit ?? ("each" as const),
            canSource: canSourcePart(policy),
            trackable: policy.flags.trackable,
          },
        ] as const,
      ];
    }),
  );
}

export { requireVisibleSourcingOrganizations as requirePurchaseOrganizations };

type PurchaseParts = Awaited<ReturnType<typeof readPurchaseParts>>;
type EligibleOffer = { offer: PurchaseOffer; manufacturerOrganizationId: string | null };

export async function readAvailablePurchaseOffers(
  tx: Db,
  siteId: string,
  parts: PurchaseParts,
  organizations: { id: string; name: string }[],
  /** Limit mutation checks to the requested source offers. */
  offerIds?: string[],
): Promise<EligibleOffer[]> {
  const offers = inventorySupplierOffers;
  const rows = await tx
    .select({
      id: offers.id,
      itemId: offers.itemId,
      version: offers.version,
      supplierOrganizationId: offers.supplierOrganizationId,
      partNumber: offers.partNumber,
      packQuantity: offers.packQuantity,
      stockUnit: offers.stockUnit,
      manufacturerOrganizationId: inventoryManufacturerParts.organizationId,
    })
    .from(offers)
    .leftJoin(
      inventoryManufacturerParts,
      eq(offers.manufacturerPartId, inventoryManufacturerParts.id),
    )
    .where(
      and(
        eq(offers.siteId, siteId),
        eq(offers.approved, true),
        eq(offers.available, true),
        offerIds === undefined ? undefined : inArray(offers.id, offerIds),
      ),
    )
    .orderBy(asc(offers.partNumber), asc(offers.id));
  const labels = new Map(organizations.map(({ id, name }) => [id, name]));
  return rows.flatMap(({ manufacturerOrganizationId, ...row }): EligibleOffer[] => {
    const part = parts.get(row.itemId);
    const supplierName = labels.get(row.supplierOrganizationId);
    if (
      part?.canSource !== true ||
      part.unit !== row.stockUnit ||
      supplierName === undefined ||
      (manufacturerOrganizationId !== null && !labels.has(manufacturerOrganizationId))
    ) {
      return [];
    }
    return [
      {
        manufacturerOrganizationId,
        offer: {
          ...row,
          supplierName,
          partCode: part.code,
          partName: part.name,
          revision: part.revision,
          trackable: part.trackable,
        },
      },
    ];
  });
}
