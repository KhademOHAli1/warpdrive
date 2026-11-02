import { ancestors } from "./graph";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export const creatableNodeTypes = ["record.read", "activity.create", "condition", "delay"] as const;
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
  const config = defaultConfig(type, trigger, read, subject);
  return { id, type, version: 1, name, nameMode: "automatic", config };
}

function defaultConfig(
  type: CreatableNodeType,
  trigger: WorkflowNode | undefined,
  read: WorkflowNode | undefined,
  subject: string,
): WorkflowNode["config"] {
  const recordId = { kind: "reference", nodeId: trigger?.id ?? "start", path: ["recordId"] };
  if (type === "record.read") return { entity: "deal", recordId };
  if (type === "condition")
    return {
      left: {
        kind: "reference",
        nodeId: read?.id ?? trigger?.id ?? "start",
        path: [read === undefined ? "recordId" : "status"],
      },
      operator: read === undefined ? "exists" : "equals",
      ...(read === undefined ? {} : { right: { kind: "value", value: "open" } }),
    };
  if (type === "delay") return { minutes: { kind: "value", value: 1 } };
  return { subject: { kind: "value", value: subject }, dealId: recordId };
}
