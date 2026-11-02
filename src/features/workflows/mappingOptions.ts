import { ancestors } from "./graph";
import { actionRegistry } from "./registry";
import type { WorkflowDefinition } from "./schemas";

export type MappingKind = "text" | "deal" | "scalar";
export function mappingOptions(graph: WorkflowDefinition, nodeId: string, kind: MappingKind) {
  const available = ancestors(graph, nodeId);
  return graph.nodes
    .filter((node) => available.has(node.id))
    .flatMap((node) =>
      Object.entries(actionRegistry[node.type].outputs)
        .filter(([field, type]) =>
          kind === "deal"
            ? (node.type === "trigger.manual" && field === "recordId") ||
              (node.type === "record.read" && node.config.entity === "deal" && field === "id")
            : kind === "text"
              ? type === "string"
              : type === "string" || type === "boolean",
        )
        .map(([field, type]) => ({
          key: node.id + "." + field,
          node,
          field,
          type,
          binding: { kind: "reference" as const, nodeId: node.id, path: field.split(".") },
        })),
    );
}
