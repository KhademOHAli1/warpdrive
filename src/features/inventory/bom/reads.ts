import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySites } from "@/features/locations/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import type { CatalogUnit } from "../catalog/contracts";
import {
  inventoryPartFamilies,
  inventoryPartProfiles,
  inventoryPartStates,
} from "../catalog/schema";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
  inventoryReleaseGrants,
} from "../releases/schema";
import { inventoryItems } from "../schema";
import { readStockPositionRows, stockPositionAvailable } from "../warehouse/balances";
import { readOrderWarehouseSites } from "../warehouse/legacyScope";
import type { BomPart, BomRelease, BomSite, BomUsage } from "./contracts";
import { failBom } from "./failure";

const release = inventoryProductReleases;
const artifact = inventoryReleaseArtifacts;
const profile = inventoryPartProfiles;
const state = inventoryPartStates;
const item = inventoryItems;
const family = inventoryPartFamilies;
const directoryLimit = 160;
const productHistoryLimit = 40;
const usageLimit = 120;

type ReleaseScope = readonly string[] | null;
export type BomNode = { release: BomRelease; bom: ApprovedBomLine[] };
export type BomPartRecord = { part: BomPart; kind: "product" | "component"; stockable: boolean };

const partColumns = {
  id: item.id,
  code: sql<string>`coalesce(${family.code}, ${item.sku})`,
  sku: item.sku,
  name: item.name,
  revision: item.revision,
  unit: sql<CatalogUnit>`coalesce(${profile.unit}, 'each')`,
};

function catalogVisibility(scope: ReleaseScope) {
  return scope === null ? undefined : sql`coalesce(${profile.visibility}, 'staff') = 'staff'`;
}

function releasedProduct(scope: ReleaseScope) {
  return and(
    eq(release.status, "released"),
    eq(item.kind, "product"),
    scope === null ? undefined : inArray(release.itemId, scope),
    catalogVisibility(scope),
  );
}

export async function lockBomReleaseGrants(tx: Db, actor: HydratedActor): Promise<ReleaseScope> {
  if (actor.type === "admin") return null;
  // Revocation updates/deletes the grant row. This reader never takes item locks after it.
  const rows = await tx
    .select({ itemId: inventoryReleaseGrants.itemId })
    .from(inventoryReleaseGrants)
    .where(eq(inventoryReleaseGrants.userId, actor.id))
    .orderBy(asc(inventoryReleaseGrants.itemId))
    .for("share");
  return rows.map(({ itemId }) => itemId);
}

export async function readBomSites(tx: Db, actor: HydratedActor): Promise<BomSite[]> {
  const allowed = await readOrderWarehouseSites(tx, actor);
  return tx
    .select({ id: directorySites.id, name: directorySites.name, code: directorySites.code })
    .from(directorySites)
    .where(
      and(
        eq(directorySites.archived, false),
        allowed === null ? undefined : inArray(directorySites.id, allowed),
      ),
    )
    .orderBy(asc(directorySites.code), asc(directorySites.id));
}

export async function readBomParts(
  tx: Db,
  scope: ReleaseScope,
  ids: readonly string[],
): Promise<Map<string, BomPartRecord>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      part: partColumns,
      kind: item.kind,
      stockable: sql<boolean>`coalesce(${state.active}, true)
        AND NOT coalesce(${profile.isTemplate}, false)
        AND coalesce(${profile.stockMode}, 'stocked') <> 'virtual'`,
    })
    .from(item)
    .leftJoin(profile, eq(profile.itemId, item.id))
    .leftJoin(family, eq(family.id, profile.familyId))
    .leftJoin(state, eq(state.id, profile.stateId))
    .where(and(inArray(item.id, ids), catalogVisibility(scope)));
  return new Map(rows.map((row) => [row.part.id, row]));
}

const releaseColumns = {
  id: release.id,
  revision: release.revision,
  checksum: artifact.sha256,
  part: partColumns,
};

function joinBomChecksum() {
  return and(
    eq(artifact.releaseId, release.id),
    eq(artifact.kind, "manufacturingBom"),
    eq(artifact.state, "ready"),
  );
}

function selectReleases(tx: Db, scope: ReleaseScope, condition?: SQL) {
  return tx
    .select(releaseColumns)
    .from(release)
    .innerJoin(item, eq(item.id, release.itemId))
    .leftJoin(profile, eq(profile.itemId, item.id))
    .leftJoin(family, eq(family.id, profile.familyId))
    .leftJoin(artifact, joinBomChecksum())
    .where(and(releasedProduct(scope), condition))
    .orderBy(desc(release.approvedAt), desc(release.id));
}

export async function readBomReleaseDirectory(
  tx: Db,
  scope: ReleaseScope,
  chosen: BomRelease | null,
): Promise<BomRelease[]> {
  const latest = await selectReleases(tx, scope).limit(directoryLimit);
  if (chosen === null) return latest;
  const versions = await selectReleases(tx, scope, eq(partColumns.code, chosen.part.code)).limit(
    productHistoryLimit,
  );
  const all = new Map(versions.map((version) => [version.id, version]));
  all.set(chosen.id, chosen);
  for (const version of latest) all.set(version.id, version);
  return [...all.values()];
}

export async function readLatestBomRelease(tx: Db, scope: ReleaseScope, partId: string) {
  const [latest] = await selectReleases(tx, scope, eq(release.itemId, partId)).limit(1);
  return latest ?? null;
}

export async function readBomNodes(
  tx: Db,
  scope: ReleaseScope,
  ids: readonly string[],
): Promise<BomNode[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ ...releaseColumns, bom: release.bom })
    .from(release)
    .innerJoin(item, eq(item.id, release.itemId))
    .leftJoin(profile, eq(profile.itemId, item.id))
    .leftJoin(family, eq(family.id, profile.familyId))
    .leftJoin(artifact, joinBomChecksum())
    .where(and(releasedProduct(scope), inArray(release.id, ids)));
  if (rows.length !== ids.length) failBom("unavailable");
  return rows.map(({ bom, ...version }) => ({ release: version, bom }));
}

export async function readBomWhereUsed(
  tx: Db,
  scope: ReleaseScope,
  itemId: string,
): Promise<BomUsage[]> {
  const primary = JSON.stringify([{ itemId }]);
  const substitute = JSON.stringify([{ spec: { alternatives: [{ itemId }] } }]);
  // The reverse walk follows exact approved release IDs. UNION deduplicates a diamond's
  // paths (including the direct/substitute flags) instead of returning duplicate ancestry.
  const matches = await tx.execute<{ id: string; direct: boolean; substitute: boolean }>(sql`
    WITH RECURSIVE candidates AS MATERIALIZED (
      SELECT ${release.id}, ${release.itemId}, ${release.bom}, ${release.approvedAt}
      FROM ${release}
      JOIN ${item} ON ${item.id} = ${release.itemId}
      LEFT JOIN ${profile} ON ${profile.itemId} = ${item.id}
      WHERE ${releasedProduct(scope)}
    ), usages(id, item_id, direct, substitute) AS (
      SELECT candidate.id, candidate.item_id, true, candidate.bom @> ${substitute}::jsonb
      FROM candidates AS candidate
      WHERE candidate.bom @> ${primary}::jsonb OR candidate.bom @> ${substitute}::jsonb
      UNION
      SELECT parent.id, parent.item_id, false, child.substitute
      FROM usages AS child
      JOIN candidates AS parent ON parent.bom @> jsonb_build_array(jsonb_build_object(
        'itemId', child.item_id::text,
        'spec', jsonb_build_object('childReleaseId', child.id::text)
      ))
    ), inspected(id) AS (
      SELECT usages.id FROM usages
      UNION
      SELECT child.id
      FROM inspected
      JOIN candidates AS parent ON parent.id = inspected.id
      CROSS JOIN LATERAL jsonb_array_elements(parent.bom) AS line(value)
      JOIN candidates AS child ON child.id = (line.value #>> '{spec,childReleaseId}')::uuid
        AND child.item_id = (line.value ->> 'itemId')::uuid
    ), visible_parts AS NOT MATERIALIZED (
      SELECT ${item.id}
      FROM ${item}
      LEFT JOIN ${profile} ON ${profile.itemId} = ${item.id}
      WHERE ${catalogVisibility(scope) ?? sql`true`}
    ), blocked(id, item_id) AS (
      SELECT candidate.id, candidate.item_id
      FROM inspected
      JOIN candidates AS candidate ON candidate.id = inspected.id
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(candidate.bom) AS line(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM visible_parts WHERE id = (line.value ->> 'itemId')::uuid
        ) OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(line.value #> '{spec,alternatives}', '[]'::jsonb))
            AS alternative(value)
          WHERE NOT EXISTS (
            SELECT 1 FROM visible_parts WHERE id = (alternative.value ->> 'itemId')::uuid
          )
        ) OR (
          line.value #>> '{spec,childReleaseId}' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM candidates AS child
            WHERE child.id = (line.value #>> '{spec,childReleaseId}')::uuid
              AND child.item_id = (line.value ->> 'itemId')::uuid
          )
        )
      )
      UNION
      SELECT parent.id, parent.item_id
      FROM blocked AS child
      JOIN candidates AS parent ON parent.bom @> jsonb_build_array(jsonb_build_object(
        'itemId', child.item_id::text,
        'spec', jsonb_build_object('childReleaseId', child.id::text)
      ))
      JOIN inspected ON inspected.id = parent.id
    )
    SELECT usages.id, bool_or(usages.direct) AS direct, bool_or(usages.substitute) AS substitute
    FROM usages
    JOIN candidates ON candidates.id = usages.id
    WHERE NOT EXISTS (SELECT 1 FROM blocked WHERE blocked.id = usages.id)
    GROUP BY usages.id, candidates.approved_at
    ORDER BY candidates.approved_at DESC, usages.id DESC
    LIMIT ${usageLimit}
  `);
  if (matches.rows.length === 0) return [];
  const metadata = await selectReleases(
    tx,
    scope,
    inArray(
      release.id,
      matches.rows.map(({ id }) => id),
    ),
  );
  const byId = new Map(matches.rows.map(({ id, ...usage }) => [id, usage]));
  return metadata.flatMap((version) => {
    const usage = byId.get(version.id);
    return usage === undefined ? [] : [{ ...usage, release: version }];
  });
}

export async function readBomAvailability(
  tx: Db,
  siteId: string | null,
  parts: ReadonlyMap<string, BomPartRecord>,
) {
  const availability = new Map<string, number>();
  if (siteId === null) return availability;
  const items = [...parts.entries()].flatMap(([id, { stockable }]) => (stockable ? [id] : []));
  const today = new Date().toISOString().slice(0, 10);
  for (const row of await readStockPositionRows(tx, items, [siteId])) {
    const previous = availability.get(row.itemId) ?? 0;
    availability.set(row.itemId, previous + stockPositionAvailable(row, today));
  }
  return availability;
}
