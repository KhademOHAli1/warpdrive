import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { organizations } from "@/db/schema/organizations";
import { toVisibleRecord } from "@/features/contacts/orgsRepo";
import { catalogItemPolicies } from "@/features/inventory/catalog/policy";
import {
  inventoryProductReleases,
  inventoryReleaseGrants,
} from "@/features/inventory/releases/schema";
import { inventoryItems } from "@/features/inventory/schema";
import {
  inventoryManufacturerParts,
  inventorySupplierOffers,
} from "@/features/inventory/sourcing/schema";
import {
  canSourcePart,
  lockSourcingRecords,
  readSourcingSites,
} from "@/features/inventory/sourcing/scope";
import { readWarehouseAccess } from "@/features/inventory/warehouse/access";
import { inventoryStockPositions } from "@/features/inventory/warehouse/schema";
import { canSee } from "@/features/permissions/canSee";
import type { HydratedActor } from "@/server/hydrateActor";
import type { LabelTarget, LabelTargetKind, LabelTargetRef } from "./contracts";

export function selectedTargets(
  kind: LabelTargetKind,
  refs: readonly LabelTargetRef[] | undefined,
): string[] | undefined {
  return refs?.filter((ref) => ref.kind === kind).map(({ id }) => id);
}

async function partTargets(tx: Db, actor: HydratedActor, ids?: string[]) {
  const items = await tx
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
    })
    .from(inventoryItems)
    .where(ids === undefined ? undefined : inArray(inventoryItems.id, ids));
  const policies = await catalogItemPolicies(
    tx,
    items.map(({ id }) => id),
  );
  const admin = actor.type === "admin";
  return items.flatMap((item): LabelTarget[] => {
    const policy = policies.get(item.id);
    if (policy === undefined || (!admin && policy.visibility !== "staff")) return [];
    return [
      {
        kind: "part",
        id: item.id,
        title: item.name,
        subtitle: `${policy.code} · ${item.revision}`,
        href: `/inventory?itemId=${item.id}`,
        canManage: admin && policy.active && !policy.locked,
      },
    ];
  });
}

async function lockSubjectItems(tx: Db, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, [...new Set(itemIds)]))
    .orderBy(asc(inventoryItems.id))
    .for("share");
}

async function lockStockSubjects(tx: Db, ids: string[]) {
  const hints = await tx
    .select({ itemId: inventoryStockPositions.itemId })
    .from(inventoryStockPositions)
    .where(inArray(inventoryStockPositions.id, ids));
  await lockSubjectItems(
    tx,
    hints.map(({ itemId }) => itemId),
  );
}

async function stockTargets(tx: Db, actor: HydratedActor, signal: AbortSignal, ids?: string[]) {
  const access = await readWarehouseAccess(tx, actor, signal);
  const sites = new Map(access.sites.map((site) => [site.id, site]));
  if (sites.size === 0) return [];
  const locations = new Map(access.locations.map((location) => [location.id, location]));
  const stock = inventoryStockPositions;
  if (ids !== undefined) await lockStockSubjects(tx, ids);
  const positions = await tx
    .select({
      id: stock.id,
      siteId: stock.siteId,
      locationId: stock.locationId,
      lot: stock.lot,
      serial: stock.serial,
      itemId: stock.itemId,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
    })
    .from(stock)
    .innerJoin(inventoryItems, eq(stock.itemId, inventoryItems.id))
    .where(
      and(
        inArray(stock.siteId, [...sites.keys()]),
        ids === undefined ? undefined : inArray(stock.id, ids),
      ),
    );
  const policies = await catalogItemPolicies(tx, [
    ...new Set(positions.map(({ itemId }) => itemId)),
  ]);
  return positions.flatMap((position): LabelTarget[] => {
    const policy = policies.get(position.itemId);
    const site = sites.get(position.siteId);
    const location = locations.get(position.locationId);
    if (policy === undefined || site === undefined || location === undefined) return [];
    if (!access.isAdmin && policy.visibility !== "staff") return [];
    return [
      {
        kind: "stock_position",
        id: position.id,
        title: position.name,
        subtitle: [
          policy.code,
          position.revision,
          site.code,
          location.code,
          position.lot,
          position.serial,
        ]
          .filter((field) => field !== null)
          .join(" · "),
        href: null,
        canManage: site.canManage && !site.archived && !location.archived,
      },
    ];
  });
}

async function releaseTargets(tx: Db, actor: HydratedActor, ids?: string[]) {
  const release = inventoryProductReleases;
  const grants = inventoryReleaseGrants;
  const admin = actor.type === "admin";
  if (ids !== undefined) {
    const hints = await tx
      .select({ itemId: release.itemId })
      .from(release)
      .where(inArray(release.id, ids));
    await lockSubjectItems(
      tx,
      hints.map(({ itemId }) => itemId),
    );
  }
  const rows = await tx
    .select({
      id: release.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      revision: release.revision,
      role: grants.role,
    })
    .from(release)
    .innerJoin(inventoryItems, eq(release.itemId, inventoryItems.id))
    .leftJoin(grants, and(eq(grants.itemId, release.itemId), eq(grants.userId, actor.id)))
    .where(
      and(
        eq(release.status, "released"),
        eq(inventoryItems.kind, "product"),
        ids === undefined ? undefined : inArray(release.id, ids),
      ),
    );
  return rows.flatMap((row): LabelTarget[] =>
    !admin && row.role === null
      ? []
      : [
          {
            kind: "release",
            id: row.id,
            title: row.name,
            subtitle: `${row.sku} · ${row.revision}`,
            href: null,
            canManage: admin || row.role === "editor",
          },
        ],
  );
}

const supplierOrganization = alias(organizations, "label_supplier_org");
const manufacturerOrganization = alias(organizations, "label_manufacturer_org");

function scopedOffers(tx: Db, siteIds: string[], ids: string[] | undefined) {
  const offer = inventorySupplierOffers;
  const manufacturer = inventoryManufacturerParts;
  return tx
    .select({
      id: offer.id,
      siteId: offer.siteId,
      itemId: offer.itemId,
      partNumber: offer.partNumber,
      supplier: supplierOrganization,
      manufacturerId: offer.manufacturerPartId,
      manufacturer: manufacturerOrganization,
    })
    .from(offer)
    .innerJoin(supplierOrganization, eq(supplierOrganization.id, offer.supplierOrganizationId))
    .leftJoin(manufacturer, eq(manufacturer.id, offer.manufacturerPartId))
    .leftJoin(
      manufacturerOrganization,
      eq(manufacturerOrganization.id, manufacturer.organizationId),
    )
    .where(
      and(inArray(offer.siteId, siteIds), ids === undefined ? undefined : inArray(offer.id, ids)),
    );
}

async function lockOfferScope(tx: Db, siteIds: string[], ids: string[], signal: AbortSignal) {
  const offer = inventorySupplierOffers;
  const scopes = await tx
    .selectDistinct({ siteId: offer.siteId, itemId: offer.itemId })
    .from(offer)
    .where(and(inArray(offer.siteId, siteIds), inArray(offer.id, ids)))
    .orderBy(asc(offer.siteId), asc(offer.itemId));
  for (const { siteId, itemId } of scopes) {
    await lockSourcingRecords(tx, siteId, itemId, "read", signal);
  }
}

async function lockOfferOrganizations(tx: Db, offers: OfferLabelRow[]) {
  const ids = new Set(offers.map(({ supplier }) => supplier.id));
  for (const { manufacturer } of offers) {
    if (manufacturer !== null) ids.add(manufacturer.id);
  }
  if (ids.size === 0) return;
  await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(inArray(organizations.id, [...ids]))
    .orderBy(asc(organizations.id))
    .for("share");
}

type OfferLabelRow = Awaited<ReturnType<typeof scopedOffers>>[number];

function visibleOffer(
  actor: HydratedActor,
  { supplier, manufacturerId, manufacturer }: OfferLabelRow,
) {
  if (supplier.deletedAt !== null || !canSee(actor, toVisibleRecord(supplier))) return false;
  return (
    manufacturerId === null ||
    (manufacturer !== null &&
      manufacturer.deletedAt === null &&
      canSee(actor, toVisibleRecord(manufacturer)))
  );
}

async function supplierTargets(tx: Db, actor: HydratedActor, signal: AbortSignal, ids?: string[]) {
  const sites = new Map((await readSourcingSites(tx, actor)).map((site) => [site.id, site]));
  if (sites.size === 0) return [];
  const siteIds = [...sites.keys()];
  if (ids !== undefined) await lockOfferScope(tx, siteIds, ids, signal);
  let offers = await scopedOffers(tx, siteIds, ids);
  if (ids !== undefined) {
    await lockOfferOrganizations(tx, offers);
    offers = await scopedOffers(tx, siteIds, ids);
  }
  const policies = await catalogItemPolicies(tx, [...new Set(offers.map(({ itemId }) => itemId))]);
  return offers.flatMap((offer): LabelTarget[] => {
    const policy = policies.get(offer.itemId);
    if (!visibleOffer(actor, offer) || policy === undefined) return [];
    if (actor.type !== "admin" && policy.visibility !== "staff") return [];
    return [
      {
        kind: "supplier_offer",
        id: offer.id,
        title: offer.partNumber,
        subtitle: [offer.supplier.name, policy.code, sites.get(offer.siteId)?.code].join(" · "),
        href: null,
        canManage: sites.get(offer.siteId)?.canBuy === true && canSourcePart(policy),
      },
    ];
  });
}

export async function readInventoryLabelTargets(
  tx: Db,
  actor: HydratedActor,
  signal: AbortSignal,
  refs?: readonly LabelTargetRef[],
): Promise<LabelTarget[]> {
  const parts = selectedTargets("part", refs);
  const stock = selectedTargets("stock_position", refs);
  const releases = selectedTargets("release", refs);
  const suppliers = selectedTargets("supplier_offer", refs);
  return [
    ...(parts?.length === 0 ? [] : await partTargets(tx, actor, parts)),
    ...(stock?.length === 0 ? [] : await stockTargets(tx, actor, signal, stock)),
    ...(releases?.length === 0 ? [] : await releaseTargets(tx, actor, releases)),
    ...(suppliers?.length === 0 ? [] : await supplierTargets(tx, actor, signal, suppliers)),
  ];
}
