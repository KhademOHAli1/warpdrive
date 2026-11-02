import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export interface FlowLabels {
  start: string;
  read: string;
  task: string;
  subject: string;
}
export function initialBlankDefinition(name: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name, nameMode: "automatic", config: {} },
    ],
    edges: [],
  };
}

export function initialDefinition(labels: FlowLabels): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: labels.start,
        nameMode: "automatic",
        config: {},
      },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: labels.read,
        nameMode: "automatic",
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
    nameMode: "automatic",
    config: {
      subject: { kind: "value", value: subject },
      dealId: { kind: "reference", nodeId: "read", path: ["id"] },
    },
  };
}
