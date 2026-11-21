import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { blankCatalogProfile, catalogUnitDimension } from "../catalog/contracts";
import {
  inventoryPartFamilies,
  inventoryPartProfiles,
  inventoryPartStates,
} from "../catalog/schema";
import { InventoryDomainError } from "../errors";
import { inventoryItems } from "../schema";
import { releaseUnavailable, requireItemReleaseAccess } from "./access";
import { inspectApprovalGraph } from "./approvedBomGraph";
import { wholeBomQuantity } from "./bomUnits";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseGrants,
  type ReleaseBomEntry,
} from "./schema";

function fail(message = releaseUnavailable): never {
  throw new InventoryDomainError(message);
}

function partRows(tx: Db) {
  return tx
    .select({
      itemId: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      code: inventoryPartFamilies.code,
      revision: inventoryPartProfiles.revisionKey,
      unit: inventoryPartProfiles.unit,
      visibility: inventoryPartProfiles.visibility,
      stockMode: inventoryPartProfiles.stockMode,
      isTemplate: inventoryPartProfiles.isTemplate,
      flags: inventoryPartProfiles.flags,
      active: inventoryPartStates.active,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryItems.id, inventoryPartProfiles.itemId))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartProfiles.familyId, inventoryPartFamilies.id))
    .leftJoin(inventoryPartStates, eq(inventoryPartProfiles.stateId, inventoryPartStates.id));
}

type PartRow = Awaited<ReturnType<typeof partRows>>[number];

async function resolveParts(tx: Db, entries: ReleaseBomEntry[]) {
  const parts = [
    ...new Set(entries.flatMap(({ sku, details }) => [sku, ...(details?.alternateSkus ?? [])])),
  ];
  const sku: string[] = [];
  const revisions = [];
  for (const part of parts) {
    const [code, revision] = part.split("@");
    if (code === undefined) fail();
    if (revision === undefined) sku.push(code);
    else
      revisions.push(
        and(eq(inventoryPartFamilies.code, code), eq(inventoryPartProfiles.revisionKey, revision)),
      );
  }
  const rows = await partRows(tx).where(or(inArray(inventoryItems.sku, sku), ...revisions));
  const bySelector = new Map<string, PartRow>();
  for (const row of rows) {
    bySelector.set(row.sku, row);
    if (row.code !== null && row.revision !== null)
      bySelector.set(`${row.code}@${row.revision}`, row);
  }
  return bySelector;
}

function partIdentity({ itemId, sku, name }: PartRow, quantity: number) {
  return { itemId, sku, name, quantity };
}

function usablePart(row: PartRow | undefined, actor: HydratedActor) {
  if (row === undefined || (row.visibility === "admin" && actor.type !== "admin")) fail();
  if (row.active === false) fail("Use active catalog revisions in the manufacturing BOM.");
  return row;
}

function leaf(part: PartRow) {
  return (
    part.kind === "component" &&
    part.isTemplate !== true &&
    part.stockMode !== "virtual" &&
    (part.flags ?? blankCatalogProfile(part.kind).flags).component
  );
}

async function exactChildRelease(tx: Db, actor: HydratedActor, itemId: string, revision: string) {
  await requireItemReleaseAccess(tx, actor, itemId, "view");
  const [release] = await tx
    .select({ id: inventoryProductReleases.id })
    .from(inventoryProductReleases)
    .where(
      and(
        eq(inventoryProductReleases.itemId, itemId),
        eq(inventoryProductReleases.revision, revision),
        eq(inventoryProductReleases.status, "released"),
      ),
    );
  if (release === undefined)
    fail("Select an available approved manufacturing revision for each subassembly.");
  return release.id;
}

function approvedAlternates(
  entry: NonNullable<ReleaseBomEntry["details"]>,
  part: PartRow,
  actor: HydratedActor,
  parts: ReadonlyMap<string, PartRow>,
) {
  const enteredUnit = entry.unit ?? part.unit ?? "each";
  const seen = new Set([part.itemId]);
  return entry.alternateSkus.map((selector) => {
    const alternate = usablePart(parts.get(selector), actor);
    const stockUnit = alternate.unit ?? "each";
    const quantity = wholeBomQuantity(entry.enteredQuantity, enteredUnit, stockUnit);
    if (
      !leaf(alternate) ||
      seen.has(alternate.itemId) ||
      quantity === null ||
      (alternate.stockMode === "consumable" && !entry.consumable && part.stockMode !== "consumable")
    ) {
      fail("Alternates must be distinct stock components with compatible quantities and usage.");
    }
    seen.add(alternate.itemId);
    return { ...partIdentity(alternate, quantity), stockUnit };
  });
}

async function approvedLine(
  tx: Db,
  actor: HydratedActor,
  entry: ReleaseBomEntry,
  parts: ReadonlyMap<string, PartRow>,
): Promise<ApprovedBomLine> {
  const part = usablePart(parts.get(entry.sku), actor);
  const details = entry.details;
  const stockUnit = part.unit ?? "each";
  if (details === undefined) {
    if (!leaf(part)) fail("Every basic BOM row must use an existing stock component SKU.");
    return {
      ...partIdentity(part, entry.quantity),
      spec: {
        enteredQuantity: String(entry.quantity),
        enteredUnit: stockUnit,
        stockUnit,
        childReleaseId: null,
        alternatives: [],
        optional: false,
        consumable: false,
        inherited: false,
        pieces: null,
      },
    };
  }

  const enteredUnit = details.unit ?? stockUnit;
  const quantity = wholeBomQuantity(details.enteredQuantity, enteredUnit, stockUnit);
  if (quantity === null)
    fail("Each BOM quantity must convert exactly to a supported number of whole stock units.");

  if (details.childRelease === null && !leaf(part))
    fail("Each product or template line needs an approved child release.");
  if (details.childRelease !== null && !canUseChild(part, details, stockUnit))
    fail("Use an active assembly with a stock unit of each for a child release.");
  if (details.pieces !== null && catalogUnitDimension(enteredUnit) !== "length")
    fail("Use a length unit for a cut piece count.");

  const childReleaseId =
    details.childRelease === null
      ? null
      : await exactChildRelease(tx, actor, part.itemId, details.childRelease);
  const alternatives = approvedAlternates(details, part, actor, parts);
  return {
    ...partIdentity(part, quantity),
    spec: {
      enteredQuantity: details.enteredQuantity,
      enteredUnit,
      stockUnit,
      childReleaseId,
      alternatives,
      optional: details.optional,
      consumable:
        childReleaseId === null && (details.consumable || part.stockMode === "consumable"),
      inherited: details.inherited,
      pieces: details.pieces,
    },
  };
}

function canUseChild(
  part: PartRow,
  details: NonNullable<ReleaseBomEntry["details"]>,
  unit: NonNullable<PartRow["unit"]>,
) {
  return (
    part.kind === "product" &&
    unit === "each" &&
    (details.inherited ||
      (part.isTemplate !== true &&
        part.stockMode !== "virtual" &&
        part.stockMode !== "consumable" &&
        (part.flags ?? blankCatalogProfile(part.kind).flags).assembly))
  );
}

export async function prepareApprovedBom(
  tx: Db,
  actor: HydratedActor,
  release: { id: string; itemId: string },
  entries: ReleaseBomEntry[],
  signal: AbortSignal,
) {
  const selected = await resolveParts(tx, entries);
  const bom: ApprovedBomLine[] = [];
  const seen = new Set([release.itemId]);
  for (const entry of entries) {
    const line = await approvedLine(tx, actor, entry, selected);
    if (seen.has(line.itemId))
      fail("Use distinct material revisions and omit the parent part from its own BOM.");
    seen.add(line.itemId);
    bom.push(line);
  }
  const graph = await inspectApprovalGraph(tx, { ...release, bom }, signal);
  return { bom, ...graph };
}

/** Use the stock lock order while serializing approvals and grant changes on the root. */
export async function lockBomApprovalParts(tx: Db, rootId: string, parts: ReadonlySet<string>) {
  const related = [...parts].filter((id) => id !== rootId);
  const lower = related.filter((id) => id < rootId);
  const upper = related.filter((id) => id > rootId);
  await shareParts(tx, lower);
  const [root] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, rootId), eq(inventoryItems.kind, "product")))
    .for("update");
  if (root === undefined) fail();
  await shareParts(tx, upper);
}

async function shareParts(tx: Db, parts: string[]) {
  if (parts.length === 0) return;
  const rows = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, parts))
    .orderBy(asc(inventoryItems.id))
    .for("share");
  if (rows.length !== parts.length) fail();
}

export async function requireApprovalGraphAccess(
  tx: Db,
  actor: HydratedActor,
  graph: { products: ReadonlySet<string>; parts: ReadonlySet<string> },
) {
  const parts = await partRows(tx).where(inArray(inventoryItems.id, [...graph.parts]));
  if (parts.length !== graph.parts.size) fail();
  for (const part of parts) usablePart(part, actor);
  if (actor.type === "admin") return;
  const grants = await tx
    .select({ itemId: inventoryReleaseGrants.itemId })
    .from(inventoryReleaseGrants)
    .where(
      and(
        eq(inventoryReleaseGrants.userId, actor.id),
        inArray(inventoryReleaseGrants.itemId, [...graph.products]),
      ),
    );
  if (grants.length !== graph.products.size) fail();
}
