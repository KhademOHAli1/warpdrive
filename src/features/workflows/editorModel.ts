import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export interface FlowLabels {
  start: string;
  read: string;
  task: string;
  subject: string;
}

export function initialDefinition(labels: FlowLabels): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: labels.start, config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: labels.read,
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      task("task", labels.task, labels.subject),
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}

function task(id: string, name: string, subject: string): WorkflowNode {
  return {
    id,
    type: "activity.create",
    version: 1,
    name,
    config: {
      subject: { kind: "value", value: subject },
      dealId: { kind: "reference", nodeId: "read", path: ["id"] },
    },
  };
}

function linearDefinition(nodes: WorkflowNode[]): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes,
    edges: nodes.slice(1).flatMap((node, index) => {
      const previous = nodes[index];
      return previous === undefined
        ? []
        : [{ from: previous.id, to: node.id, port: "next" as const }];
    }),
  };
}

export function appendTask(
  definition: WorkflowDefinition,
  id: string,
  name: string,
  subject: string,
) {
  return linearDefinition([...definition.nodes, task(id, name, subject)]);
}

export function removeTask(definition: WorkflowDefinition, id: string) {
  if (!definition.nodes.some((node) => node.id === id && node.type === "activity.create"))
    return definition;
  return linearDefinition(definition.nodes.filter((node) => node.id !== id));
}
