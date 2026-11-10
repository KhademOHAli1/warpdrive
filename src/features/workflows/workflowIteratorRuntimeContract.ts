import { z } from "zod";
import { workflowIteratorItems, workflowIteratorMaxItems } from "./workflowIteratorFrameContract";

export { workflowIteratorMaxItems } from "./workflowIteratorFrameContract";
export const workflowIteratorMaxTextLength = 255;

const nodeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
const scalar = z.union([
  z.string().max(workflowIteratorMaxTextLength * 2),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const workflowIteratorLiteralItems = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object" || !Object.hasOwn(raw, "items")) return null;
    const items: unknown = Reflect.get(raw, "items");
    return Array.isArray(items) && items.length <= workflowIteratorMaxItems ? raw : null;
  },
  z
    .strictObject({
      kind: z.literal("literal"),
      itemKind: z.enum(["text", "number", "boolean"]),
      items: z.array(scalar),
    })
    .refine((source) => workflowIteratorItems(source) !== null),
);

const workflowIteratorReferenceItems = z.strictObject({
  kind: z.literal("reference"),
  nodeId,
  path: z.tuple([z.literal("all")]),
});

export const workflowIteratorConfig = z.strictObject({
  items: z.union([workflowIteratorLiteralItems, workflowIteratorReferenceItems]),
  shouldContinueOnIterationFailure: z.boolean().default(false),
});

export const workflowIteratorCursor = z
  .strictObject({
    version: z.literal(1),
    iteratorNodeId: nodeId,
    itemIndex: z
      .number()
      .int()
      .min(0)
      .max(workflowIteratorMaxItems - 1),
    itemCount: z.number().int().min(1).max(workflowIteratorMaxItems),
    failedCount: z
      .number()
      .int()
      .min(0)
      .max(workflowIteratorMaxItems - 1),
  })
  .refine(
    ({ itemIndex, itemCount, failedCount }) => itemIndex < itemCount && failedCount <= itemIndex,
  );

export type WorkflowIteratorCursor = z.infer<typeof workflowIteratorCursor>;

export const workflowIteratorSummary = z
  .strictObject({
    hasProcessedAllItems: z.literal(true),
    processedCount: z.number().int().min(0).max(workflowIteratorMaxItems),
    failedCount: z.number().int().min(0).max(workflowIteratorMaxItems),
  })
  .refine(({ processedCount, failedCount }) => failedCount <= processedCount);

interface SearchSourceNode {
  id: string;
  type: string;
  version: number;
}

// Follow the same single-parent path that guarantees mapping availability. A
// disjoint branch, missing parent, duplicate node, or cycle offers no source.
export function workflowIteratorSearchSources<Node extends SearchSourceNode>(
  definition: {
    nodes: readonly Node[];
    edges: readonly { from: string; to: string }[];
  },
  iteratorNodeId: string,
): Node[] {
  const sources: Node[] = [];
  const visited = new Set([iteratorNodeId]);
  let cursor = iteratorNodeId;
  for (let step = 0; step < definition.nodes.length; step++) {
    const incoming = definition.edges.filter((edge) => edge.to === cursor);
    const parent = incoming[0];
    if (incoming.length !== 1 || parent === undefined || visited.has(parent.from)) return [];
    const matches = definition.nodes.filter((node) => node.id === parent.from);
    const node = matches[0];
    if (matches.length !== 1 || node === undefined) return [];
    if (node.type.startsWith("trigger.")) return sources.reverse();
    if (node.type === "record.search" && node.version === 1) sources.push(node);
    visited.add(node.id);
    cursor = node.id;
  }
  return [];
}
