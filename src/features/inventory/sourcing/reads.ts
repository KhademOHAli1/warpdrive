import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import { lockDirectory } from "@/features/locations/service";
import { currentOperationsActor } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryCatalog } from "../catalog/policy";
import type {
  SourcingManufacturer,
  SourcingOffer,
  SourcingQuery,
  SourcingResult,
  SourcingWorkspace,
} from "./contracts";
import {
  inventoryItemCostOverrides,
  inventoryManufacturerParts,
  inventorySupplierOffers,
  inventorySupplierPriceTiers,
} from "./schema";
import { lockSourcingRecords, readSourcingParts, readSourcingSites } from "./scope";

type OrganizationLabels = ReadonlyMap<string, string>;
type Pricing = NonNullable<SourcingWorkspace["pricing"]>;

async function readManufacturers(
  tx: Db,
  siteId: string,
  itemId: string,
  organizations: OrganizationLabels,
) {
  const table = inventoryManufacturerParts;
  const rows = await tx
    .select({
      id: table.id,
      organizationId: table.organizationId,
      partNumber: table.partNumber,
      version: table.version,
    })
    .from(table)
    .where(and(eq(table.siteId, siteId), eq(table.itemId, itemId)))
    .orderBy(asc(table.partNumber), asc(table.id));
  return rows.flatMap((row): SourcingManufacturer[] => {
    const organizationName = organizations.get(row.organizationId);
    return organizationName === undefined ? [] : [{ ...row, organizationName }];
  });
}

async function readOffers(
  tx: Db,
  siteId: string,
  itemId: string,
  organizations: OrganizationLabels,
  manufacturerIds: ReadonlySet<string>,
) {
  const table = inventorySupplierOffers;
  const rows = await tx
    .select({
      id: table.id,
      supplierOrganizationId: table.supplierOrganizationId,
      manufacturerPartId: table.manufacturerPartId,
      partNumber: table.partNumber,
      packQuantity: table.packQuantity,
      stockUnit: table.stockUnit,
      approved: table.approved,
      available: table.available,
      version: table.version,
    })
    .from(table)
    .where(and(eq(table.siteId, siteId), eq(table.itemId, itemId)))
    .orderBy(asc(table.partNumber), asc(table.id));
  return rows.flatMap((row): SourcingOffer[] => {
    const supplierName = organizations.get(row.supplierOrganizationId);
    if (supplierName === undefined) return [];
    if (row.manufacturerPartId !== null && !manufacturerIds.has(row.manufacturerPartId)) return [];
    return [{ ...row, supplierName }];
  });
}

async function readPricing(
  tx: Db,
  siteId: string,
  itemId: string,
  offerIds: string[],
): Promise<Pricing> {
  const table = inventoryItemCostOverrides;
  const [override] = await tx
    .select({ currency: table.currency, amount: table.amount })
    .from(table)
    .where(and(eq(table.siteId, siteId), eq(table.itemId, itemId)));
  const prices = inventorySupplierPriceTiers;
  const offers = inventorySupplierOffers;
  const tiers =
    offerIds.length === 0
      ? []
      : await tx
          .select({
            offerId: prices.offerId,
            minPacks: prices.minPacks,
            currency: prices.currency,
            amount: prices.amount,
          })
          .from(prices)
          .innerJoin(
            offers,
            and(
              eq(prices.offerId, offers.id),
              eq(prices.packQuantity, offers.packQuantity),
              eq(prices.stockUnit, offers.stockUnit),
            ),
          )
          .where(inArray(prices.offerId, offerIds))
          .orderBy(asc(prices.offerId), asc(prices.currency), asc(prices.minPacks));
  return { tiers, override: override ?? null };
}

async function projectWorkspace(
  tx: Db,
  actor: HydratedActor,
  query: SourcingQuery,
  signal: AbortSignal,
): Promise<SourcingWorkspace | null> {
  const sites = await readSourcingSites(tx, actor);
  if (sites.length === 0 && actor.type !== "admin") return null;
  const site =
    query.siteId === undefined
      ? (sites.find((entry) => !entry.archived) ?? sites[0])
      : sites.find(({ id }) => id === query.siteId);
  if (query.siteId !== undefined && site === undefined) return null;

  const parts = site === undefined ? [] : await readSourcingParts(tx, actor);
  const part =
    query.itemId === undefined
      ? (parts.find(({ canSource }) => canSource) ?? parts[0])
      : parts.find(({ id }) => id === query.itemId);
  if (query.itemId !== undefined && part === undefined) return null;

  const base = { sites, selectedSiteId: site?.id ?? null, parts, selectedItemId: part?.id ?? null };
  if (site === undefined || part === undefined) {
    return { ...base, organizations: [], manufacturers: [], offers: [] };
  }

  await lockSourcingRecords(tx, site.id, part.id, "read", signal);
  const organizations = await listOrgOptions(tx, actor, signal);
  const labels = new Map(organizations.map(({ id, name }) => [id, name]));
  const manufacturers = await readManufacturers(tx, site.id, part.id, labels);
  const offers = await readOffers(
    tx,
    site.id,
    part.id,
    labels,
    new Set(manufacturers.map(({ id }) => id)),
  );
  const workspace = { ...base, organizations, manufacturers, offers };
  if (!site.canViewCosts) return workspace;
  const pricing = await readPricing(
    tx,
    site.id,
    part.id,
    offers.map(({ id }) => id),
  );
  return { ...workspace, pricing };
}

export function readSourcingWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: SourcingQuery,
  signal: AbortSignal,
): Promise<SourcingResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    await lockDirectory(tx, "read", signal);
    const actor = await currentOperationsActor(tx, who, signal);
    if (actor === null) return { ok: false, error: "unavailable" };
    const value = await projectWorkspace(tx, actor, query, signal);
    if (value === null || (await currentOperationsActor(tx, who, signal)) === null) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  });
}
