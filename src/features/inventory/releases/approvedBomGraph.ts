import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { maxBomDepth, maxBomEdges, maxBomReleases } from "../bom/limits";
import { InventoryDomainError } from "../errors";
import { releaseUnavailable } from "./access";
import { type ApprovedBomLine, inventoryProductReleases } from "./schema";

type BomRelease = { id: string; itemId: string; bom: ApprovedBomLine[] };

function childIds(release: BomRelease): string[] {
  return release.bom.flatMap(({ spec }) =>
    spec?.childReleaseId == null ? [] : [spec.childReleaseId],
  );
}

const graphTooLarge = "The manufacturing BOM exceeds the supported number of parts or levels.";

function requireChild(
  releases: ReadonlyMap<string, BomRelease>,
  line: ApprovedBomLine,
  releaseId: string,
) {
  const child = releases.get(releaseId);
  if (child?.itemId !== line.itemId) throw new InventoryDomainError(releaseUnavailable);
  return child;
}

function collectReleaseItems(root: BomRelease, releases: ReadonlyMap<string, BomRelease>) {
  const stack = new Set<string>();
  const completed = new Map<string, { depth: number; itemIds: Set<string> }>();

  function inspect(node: BomRelease) {
    if (stack.has(node.id))
      throw new InventoryDomainError("A manufacturing BOM cannot include a circular release path.");
    const prior = completed.get(node.id);
    if (prior !== undefined) return prior;
    stack.add(node.id);
    if (stack.size > maxBomDepth) throw new InventoryDomainError(graphTooLarge);

    const itemIds = new Set([node.itemId]);
    let depth = 1;
    for (const line of node.bom) {
      const releaseId = line.spec?.childReleaseId;
      if (releaseId == null) continue;
      const child = inspect(requireChild(releases, line, releaseId));
      if (child.itemIds.has(node.itemId))
        throw new InventoryDomainError("A manufacturing BOM cannot contain its own part revision.");
      for (const id of child.itemIds) itemIds.add(id);
      depth = Math.max(depth, child.depth + 1);
    }
    if (depth > maxBomDepth) throw new InventoryDomainError(graphTooLarge);
    stack.delete(node.id);
    const result = { depth, itemIds };
    completed.set(node.id, result);
    return result;
  }

  return inspect(root).itemIds;
}

function edgeCount(releases: readonly BomRelease[]) {
  return releases.reduce(
    (total, { bom }) =>
      total + bom.reduce((count, line) => count + 1 + (line.spec?.alternatives.length ?? 0), 0),
    0,
  );
}

/** Follow immutable approved IDs only. The candidate root is the sole draft in the graph. */
export async function inspectApprovalGraph(tx: Db, root: BomRelease, signal: AbortSignal) {
  const releases = new Map([[root.id, root]]);
  let ids = new Set(childIds(root));
  let edges = edgeCount([root]);
  while (ids.size > 0) {
    if (ids.size + releases.size > maxBomReleases || edges > maxBomEdges)
      throw new InventoryDomainError(graphTooLarge);
    signal.throwIfAborted();
    const rows = await tx
      .select({
        id: inventoryProductReleases.id,
        itemId: inventoryProductReleases.itemId,
        bom: inventoryProductReleases.bom,
      })
      .from(inventoryProductReleases)
      .where(
        and(
          eq(inventoryProductReleases.status, "released"),
          inArray(inventoryProductReleases.id, [...ids]),
        ),
      );
    if (rows.length !== ids.size) throw new InventoryDomainError(releaseUnavailable);
    for (const row of rows) releases.set(row.id, row);
    edges += edgeCount(rows);
    ids = new Set(rows.flatMap(childIds).filter((id) => !releases.has(id)));
  }
  if (edges > maxBomEdges) throw new InventoryDomainError(graphTooLarge);

  const products = collectReleaseItems(root, releases);
  const parts = new Set(products);
  for (const { bom } of releases.values()) {
    for (const line of bom) {
      parts.add(line.itemId);
      for (const alternate of line.spec?.alternatives ?? []) parts.add(alternate.itemId);
    }
  }
  return { products, parts };
}
