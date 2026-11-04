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
  const config = defaultConfiguration(type, { trigger, read, subject });
  return { id, type, version: 1, name, nameMode: "automatic", config };
}

import { defaultConfiguration } from "./configurationSpec";
