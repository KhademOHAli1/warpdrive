import { ancestors } from "./graph";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export const creatableNodeTypes = ["record.read", "activity.create", "condition"] as const;
export type CreatableNodeType = (typeof creatableNodeTypes)[number];
export function makeNode(
  graph: WorkflowDefinition,
  type: CreatableNodeType,
  id: string,
  name: string,
  subject: string,
  sourceId?: string,
): WorkflowNode {
  const available =
    sourceId === undefined ? undefined : new Set([...ancestors(graph, sourceId), sourceId]);
  const trigger = graph.nodes.find((node) => node.type === "trigger.manual");
  const read = [...graph.nodes]
    .reverse()
    .find(
      (node) => node.type === "record.read" && (available === undefined || available.has(node.id)),
    );
  const recordId = { kind: "reference", nodeId: trigger?.id ?? "start", path: ["recordId"] };
  const config: WorkflowNode["config"] =
    type === "record.read"
      ? { entity: "deal", recordId }
      : type === "condition"
        ? {
            left: {
              kind: "reference",
              nodeId: read?.id ?? trigger?.id ?? "start",
              path: [read === undefined ? "recordId" : "status"],
            },
            operator: read === undefined ? "exists" : "equals",
            ...(read === undefined ? {} : { right: { kind: "value", value: "open" } }),
          }
        : { subject: { kind: "value", value: subject }, dealId: recordId };
  return { id, type, version: 1, name, nameMode: "automatic", config };
}
