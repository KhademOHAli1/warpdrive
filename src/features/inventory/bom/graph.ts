import type { Db } from "@/db/client";
import { failBom } from "./failure";
import { maxBomDepth, maxBomEdges, maxBomReleases } from "./limits";
import { type BomNode, type BomPartRecord, readBomNodes, readBomParts } from "./reads";

export type BomGraph = {
  root: BomNode;
  ordered: BomNode[];
  parts: ReadonlyMap<string, BomPartRecord>;
};

function childOf(nodes: ReadonlyMap<string, BomNode>, childId: string, itemId: string): BomNode {
  const node = nodes.get(childId);
  if (node?.release.part.id !== itemId) failBom("invalid");
  return node;
}

type Descendants = { itemIds: Set<string>; depth: number };

function orderBom(nodes: ReadonlyMap<string, BomNode>, root: BomNode): BomNode[] {
  const visited = new Map<string, Descendants>();
  const active = new Set<string>();
  const postorder: BomNode[] = [];

  function visit(node: BomNode): Descendants {
    const id = node.release.id;
    const existing = visited.get(id);
    if (existing !== undefined) return existing;
    if (active.has(id)) failBom("invalid");
    active.add(id);

    const itemIds = new Set([node.release.part.id]);
    let depth = 1;
    for (const { itemId, spec } of node.bom) {
      if (spec?.childReleaseId == null) continue;
      const child = visit(childOf(nodes, spec.childReleaseId, itemId));
      if (child.itemIds.has(node.release.part.id)) failBom("invalid");
      depth = Math.max(depth, child.depth + 1);
      if (depth > maxBomDepth) failBom("limit");
      for (const descendant of child.itemIds) itemIds.add(descendant);
    }

    const descendants = { itemIds, depth };
    active.delete(id);
    visited.set(id, descendants);
    postorder.push(node);
    return descendants;
  }

  visit(root);
  return postorder.reverse();
}

type GraphFrontier = {
  pending: Set<string>;
  known: Map<string, BomNode>;
  partIds: Set<string>;
  edgeCount: number;
};

function addNodes(frontier: GraphFrontier, rows: BomNode[]) {
  for (const node of rows) frontier.known.set(node.release.id, node);
  for (const { release, bom } of rows) {
    frontier.partIds.add(release.part.id);
    for (const { itemId, spec } of bom) {
      frontier.partIds.add(itemId);
      frontier.edgeCount += 1 + (spec?.alternatives.length ?? 0);
      if (frontier.edgeCount > maxBomEdges) failBom("limit");
      for (const candidate of spec?.alternatives ?? []) frontier.partIds.add(candidate.itemId);
      if (spec?.childReleaseId != null && !frontier.known.has(spec.childReleaseId)) {
        frontier.pending.add(spec.childReleaseId);
      }
    }
  }
}

export async function readBomGraph(
  tx: Db,
  scope: readonly string[] | null,
  rootId: string,
  signal: AbortSignal,
): Promise<BomGraph> {
  const frontier: GraphFrontier = {
    pending: new Set([rootId]),
    known: new Map(),
    partIds: new Set(),
    edgeCount: 0,
  };
  while (frontier.pending.size > 0) {
    if (frontier.pending.size + frontier.known.size > maxBomReleases) failBom("limit");
    const rows = await readBomNodes(tx, scope, [...frontier.pending]);
    signal.throwIfAborted();
    frontier.pending.clear();
    addNodes(frontier, rows);
  }
  const root = frontier.known.get(rootId);
  if (root === undefined) failBom("unavailable");
  const parts = await readBomParts(tx, scope, [...frontier.partIds]);
  if (parts.size !== frontier.partIds.size) failBom("unavailable");
  return { root, ordered: orderBom(frontier.known, root), parts };
}
