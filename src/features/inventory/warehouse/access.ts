import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import type { WarehouseError, WarehouseLocation, WarehouseSite } from "./contracts";
import { inventoryStockLocationPolicies } from "./schema";

export class WarehouseFailure extends Error {
  constructor(readonly code: WarehouseError) {
    super(code);
  }
}

export function failWarehouse(code: WarehouseError): never {
  throw new WarehouseFailure(code);
}

export interface WarehouseAccess {
  isAdmin: boolean;
  sites: WarehouseSite[];
  locations: WarehouseLocation[];
  organizations: { id: string; name: string }[];
}

export async function readWarehouseAccess(
  tx: Db,
  actor: HydratedActor,
  signal: AbortSignal,
): Promise<WarehouseAccess> {
  const isAdmin = actor.type === "admin";
  const siteRows = await tx
    .select({ site: directorySites, role: directorySiteGrants.role })
    .from(directorySites)
    .leftJoin(
      directorySiteGrants,
      and(
        eq(directorySiteGrants.siteId, directorySites.id),
        eq(directorySiteGrants.userId, actor.id),
      ),
    )
    .where(isAdmin ? undefined : isNotNull(directorySiteGrants.role))
    .orderBy(asc(directorySites.code));
  const sites = siteRows.map(({ site, role }) => ({
    ...site,
    canManage: isAdmin || role === "manager",
  }));
  const locationRows = await tx
    .select({ location: directoryLocations, kind: inventoryStockLocationPolicies.kind })
    .from(directoryLocations)
    .leftJoin(
      inventoryStockLocationPolicies,
      and(
        eq(inventoryStockLocationPolicies.siteId, directoryLocations.siteId),
        eq(inventoryStockLocationPolicies.locationId, directoryLocations.id),
      ),
    )
    .where(
      isAdmin
        ? undefined
        : inArray(
            directoryLocations.siteId,
            sites.map(({ id }) => id),
          ),
    )
    .orderBy(asc(directoryLocations.siteId), asc(directoryLocations.code));
  const locations = locationRows.map(({ location, kind }) => ({
    ...location,
    kind: kind ?? "storage",
  }));
  const organizations = isAdmin || sites.length > 0 ? await listOrgOptions(tx, actor, signal) : [];
  signal.throwIfAborted();
  return { isAdmin, sites, locations, organizations };
}

export function managedWarehouseLocation(access: WarehouseAccess, locationId: string) {
  const location = access.locations.find(({ id }) => id === locationId);
  const site = access.sites.find(({ id }) => id === location?.siteId);
  if (location === undefined || site?.canManage !== true) failWarehouse("unavailable");
  return { location, site };
}

export function requireWarehouseOwner(access: WarehouseAccess, ownerOrganizationId: string | null) {
  if (
    ownerOrganizationId !== null &&
    !access.organizations.some(({ id }) => id === ownerOrganizationId)
  ) {
    failWarehouse("unavailable");
  }
}
