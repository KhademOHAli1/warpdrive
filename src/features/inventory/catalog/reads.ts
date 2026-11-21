import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryBomLines, inventoryItems } from "../schema";
import { summarizeStockAvailability } from "../warehouse/balances";
import { readStockSnapshot } from "../warehouse/snapshot";
import {
  blankCatalogProfile,
  type CatalogPart,
  type CatalogProfile,
  type CatalogQuery,
  type CatalogWorkspace,
} from "./contracts";
import {
  catalogCategoryPath,
  effectiveCatalogParameters,
  normalizeCatalogParameters,
} from "./parameters";
import {
  inventoryPartCategories,
  inventoryPartFamilies,
  inventoryPartProfiles,
  inventoryPartStates,
} from "./schema";

function readProfiles(tx: Db) {
  return tx
    .select({
      item: inventoryItems,
      profile: inventoryPartProfiles,
      code: inventoryPartFamilies.code,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, inventoryItems.id))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartFamilies.id, inventoryPartProfiles.familyId))
    .orderBy(asc(inventoryPartFamilies.code), asc(inventoryItems.sku), asc(inventoryItems.id));
}

type ProfileRow = Awaited<ReturnType<typeof readProfiles>>[number];

function projection({ item, profile, code }: ProfileRow): CatalogPart {
  const { id, sku, name, revision, kind, onHand, reserved } = item;
  const base = {
    id,
    familyId: profile?.familyId ?? id,
    code: code ?? sku,
    sku,
    name,
    revision,
    kind,
    onHand,
    reserved,
  };
  if (profile === null) {
    return { ...base, profile: blankCatalogProfile(kind), parameters: [], whereUsedByIds: [] };
  }
  const editable: CatalogProfile = {
    version: profile.version,
    categoryId: profile.categoryId,
    stateId: profile.stateId,
    templateItemId: profile.templateItemId,
    supersedesItemId: profile.supersedesItemId,
    relatedItemIds: profile.relatedItemIds,
    description: profile.description,
    notes: profile.notes,
    tags: profile.tags,
    unit: profile.unit,
    stockMode: profile.stockMode,
    visibility: profile.visibility,
    isTemplate: profile.isTemplate,
    flags: profile.flags,
    values: profile.values,
  };
  return { ...base, profile: editable, parameters: [], whereUsedByIds: [] };
}

export async function readCatalogRecords(tx: Db) {
  const categories = await tx
    .select()
    .from(inventoryPartCategories)
    .orderBy(asc(inventoryPartCategories.code));
  const states = await tx.select().from(inventoryPartStates).orderBy(asc(inventoryPartStates.code));
  const rows = await readProfiles(tx);
  return {
    categories,
    states,
    parts: rows.map(projection),
    storedItemIds: new Set(rows.filter((row) => row.profile !== null).map(({ item }) => item.id)),
  };
}

function ownVisibleReferences(part: CatalogPart, visibleIds: ReadonlySet<string>): CatalogProfile {
  const { templateItemId, supersedesItemId, relatedItemIds } = part.profile;
  return {
    ...part.profile,
    templateItemId:
      templateItemId !== null && visibleIds.has(templateItemId) ? templateItemId : null,
    supersedesItemId:
      supersedesItemId !== null && visibleIds.has(supersedesItemId) ? supersedesItemId : null,
    relatedItemIds: relatedItemIds.filter((id) => visibleIds.has(id)),
  };
}

function matchesQuery(part: CatalogPart, query: string) {
  const { name, code, sku, revision, profile } = part;
  const terms = [name, code, sku, revision, profile.description, profile.notes, ...profile.tags]
    .join("\n")
    .toLowerCase();
  return terms.includes(query);
}

export async function projectCatalogWorkspace(
  tx: Db,
  query: CatalogQuery,
  canManage: boolean,
  siteIds: string[] | null = null,
): Promise<CatalogWorkspace> {
  const records = await readCatalogRecords(tx);
  const categories = new Map(records.categories.map((entry) => [entry.id, entry]));
  const visibleParts = records.parts.filter(
    ({ profile }) => canManage || profile.visibility === "staff",
  );
  const visibleIds = new Set(visibleParts.map(({ id }) => id));
  const stock = siteIds === null ? null : await readStockSnapshot(tx, [...visibleIds]);
  const uses = new Map<string, string[]>();
  for (const line of await tx
    .select()
    .from(inventoryBomLines)
    .orderBy(asc(inventoryBomLines.itemId))) {
    if (!visibleIds.has(line.itemId) || !visibleIds.has(line.componentId)) continue;
    const parents = uses.get(line.componentId) ?? [];
    parents.push(line.itemId);
    uses.set(line.componentId, parents);
  }
  const search = query.search?.trim().toLowerCase() ?? "";
  const parts: CatalogPart[] = [];
  for (const part of visibleParts) {
    const profile = ownVisibleReferences(part, visibleIds);
    const path = catalogCategoryPath(categories, profile.categoryId) ?? [];
    if (query.categoryId !== undefined && !path.some(({ id }) => id === query.categoryId)) continue;
    if (query.stateId !== undefined && profile.stateId !== query.stateId) continue;
    if (!matchesQuery(part, search)) continue;
    const parameters = effectiveCatalogParameters(path);
    const values = normalizeCatalogParameters(profile.values, parameters) ?? profile.values;
    const balance =
      stock === null
        ? part
        : summarizeStockAvailability(
            stock.balances.get(part.id) ?? part,
            stock.positions.get(part.id) ?? [],
            siteIds,
          );
    parts.push({
      ...part,
      onHand: balance.onHand,
      reserved: balance.reserved,
      profile: { ...profile, values },
      parameters,
      whereUsedByIds: uses.get(part.id) ?? [],
    });
  }
  parts.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      a.revision.localeCompare(b.revision) ||
      a.id.localeCompare(b.id),
  );
  return { canManage, parts, categories: records.categories, states: records.states };
}
