import { err, ok, type Result } from "@/types/result";
import { configurationLimits } from "./configurationLimits";
import { positionFor } from "./nodeLayout";
import { nodeSchema, type WorkflowDefinition } from "./schemas";

export type DuplicateNodeProblem =
  | "missingNode"
  | "triggerNode"
  | "nodeLimit"
  | "duplicateId"
  | "invalidId";

const DUPLICATE_SUFFIX = " (Duplicate)";
const DUPLICATE_OFFSET = 50;

// Twenty v2.55.0 cloneStep/markStepAsDuplicate: copy one action and offset by 50. External edges stay unchanged.
export function duplicateNode(
  graph: WorkflowDefinition,
  nodeId: string,
  newId: string,
): Result<WorkflowDefinition, DuplicateNodeProblem> {
  const source = graph.nodes.find((node) => node.id === nodeId);
  if (source === undefined) return err("missingNode");
  if (source.type.startsWith("trigger.")) return err("triggerNode");
  if (graph.nodes.length >= 100) return err("nodeLimit");
  if (!nodeSchema.shape.id.safeParse(newId).success) return err("invalidId");
  if (graph.nodes.some((node) => node.id === newId)) return err("duplicateId");
  const position = positionFor(graph, nodeId);
  const copy = {
    ...structuredClone(source),
    id: newId,
    name:
      source.name.slice(0, configurationLimits.nameMax - DUPLICATE_SUFFIX.length).trimEnd() +
      DUPLICATE_SUFFIX,
    nameMode: "custom" as const,
  };
  return ok({
    ...graph,
    nodes: [...graph.nodes, copy],
    layout: {
      ...graph.layout,
      [newId]: {
        ...position,
        x: Math.max(-100000, Math.min(100000, position.x + DUPLICATE_OFFSET)),
        y: Math.max(-100000, Math.min(100000, position.y + DUPLICATE_OFFSET)),
      },
    },
  });
}
