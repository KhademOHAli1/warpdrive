import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { savedFilters } from "@/db/schema/savedFilters";
import { directoryLocations } from "@/features/locations/schema";
import type { AssetSite, AssetsWorkspace } from "../contracts";
import { assetCategories } from "../schema";
import { type AssetRegisterSettings, maxAssetRegisterViews } from "./contracts";
import { type AssetRegisterDiscoveryReceipt, assetRegisterDiscoveryReceipts } from "./schema";

const assetRegisterViewTarget = "asset-register-view";

export type AssetRegisterViewDefinition = {
  schemaVersion: 1;
  version: number;
  settings: AssetRegisterSettings;
};

export function assetDiscoveryFingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function readAssetDiscoveryReceipt(tx: Db, actorId: string, requestId: string) {
  const [receipt] = await tx
    .select()
    .from(assetRegisterDiscoveryReceipts)
    .where(
      and(
        eq(assetRegisterDiscoveryReceipts.actorId, actorId),
        eq(assetRegisterDiscoveryReceipts.requestId, requestId),
      ),
    );
  return receipt;
}

export async function persistAssetDiscoveryReceipt(
  tx: Db,
  receipt: Omit<AssetRegisterDiscoveryReceipt, "createdAt">,
): Promise<void> {
  await tx.insert(assetRegisterDiscoveryReceipts).values(receipt);
}

function privateView(ownerId: string) {
  return and(
    eq(savedFilters.targetEntity, assetRegisterViewTarget),
    eq(savedFilters.ownerId, ownerId),
    eq(savedFilters.isShared, false),
  );
}

export async function readOwnedAssetRegisterViews(tx: Db, ownerId: string) {
  return tx
    .select({
      id: savedFilters.id,
      name: savedFilters.name,
      definition: sql<unknown>`CASE
      WHEN pg_catalog.octet_length(${savedFilters.definition}::text) <= 4096
      THEN ${savedFilters.definition}
    END`,
    })
    .from(savedFilters)
    .where(privateView(ownerId))
    .orderBy(asc(savedFilters.createdAt), asc(savedFilters.id))
    .limit(maxAssetRegisterViews + 1);
}

export async function readAssetRegisterViewScope(
  tx: Db,
  sites: AssetSite[],
  settings: readonly AssetRegisterSettings[],
): Promise<Pick<AssetsWorkspace, "sites" | "categories" | "locations">> {
  const siteIds = sites.map(({ id }) => id);
  const scopedFilters = settings
    .map(({ filters }) => filters)
    .filter(({ site }) => siteIds.includes(site));
  const categoryIds = [
    ...new Set(scopedFilters.map(({ category }) => category).filter((category) => category !== "")),
  ];
  const locationIds = [
    ...new Set(
      scopedFilters
        .map(({ location }) => location)
        .filter((location) => location !== "" && location !== "unassigned"),
    ),
  ];
  const categories =
    categoryIds.length === 0
      ? []
      : await tx
          .select()
          .from(assetCategories)
          .where(
            and(inArray(assetCategories.siteId, siteIds), inArray(assetCategories.id, categoryIds)),
          );
  const locations =
    locationIds.length === 0
      ? []
      : await tx
          .select()
          .from(directoryLocations)
          .where(
            and(
              inArray(directoryLocations.siteId, siteIds),
              inArray(directoryLocations.id, locationIds),
            ),
          );
  return { sites, categories, locations };
}

export async function insertAssetRegisterView(
  tx: Db,
  ownerId: string,
  name: string,
  definition: AssetRegisterViewDefinition,
) {
  await tx.insert(savedFilters).values({
    name,
    definition,
    ownerId,
    targetEntity: assetRegisterViewTarget,
    isShared: false,
  });
}

function exactView(ownerId: string, id: string, version: number) {
  return and(
    privateView(ownerId),
    eq(savedFilters.id, id),
    sql`${savedFilters.definition}->'version' = ${String(version)}::jsonb`,
  );
}

export async function updateAssetRegisterView(
  tx: Db,
  ownerId: string,
  id: string,
  version: number,
  name: string,
  definition: AssetRegisterViewDefinition,
) {
  const [updated] = await tx
    .update(savedFilters)
    .set({ name, definition })
    .where(exactView(ownerId, id, version))
    .returning({ id: savedFilters.id });
  return updated !== undefined;
}

export async function deleteAssetRegisterView(
  tx: Db,
  ownerId: string,
  id: string,
  version: number,
) {
  const [removed] = await tx
    .delete(savedFilters)
    .where(exactView(ownerId, id, version))
    .returning({ id: savedFilters.id });
  return removed !== undefined;
}
