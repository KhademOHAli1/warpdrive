import type {
  KpiDefinition,
  KpiDefinitionInput,
  KpiGraph,
  KpiGraphHandle,
  KpiGraphNode,
  KpiPeriod,
} from "@/features/goals/kpiModel";
import {
  kpiGraphInputHandles,
  kpiGraphNodeType,
  validateKpiGraph,
} from "@/features/goals/kpiGraphValidation";
import { kpiDefinitionInput } from "@/features/goals/kpiSchemas";

export type GraphNodeKind = KpiGraphNode["type"];
export type GraphPeriodChoice = "monthly" | "quarterly" | "yearly" | "rolling30" | "rolling90";
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export function defaultGraphMetric(currency: string): Omit<KpiDefinitionInput, "graph"> {
  return {
    name: "CRM",
    description: "",
    source: "deals",
    calculation: "sum",
    unit: "money",
    currency,
    dateField: "closed",
    filters: { status: "won" },
    valueField: "value",
  };
}
export function graphFromDefinition(
  definition: KpiDefinition | undefined,
  currency: string,
  labels: Record<GraphNodeKind, string>,
): KpiGraph {
  if (definition?.graph !== undefined) return structuredClone(definition.graph);
  const metric =
    definition === undefined
      ? defaultGraphMetric(currency)
      : {
          name: definition.name,
          description: definition.description,
          source: definition.source,
          calculation: definition.calculation,
          unit: definition.unit,
          customUnit: definition.customUnit,
          currency: definition.currency,
          dateField: definition.dateField,
          filters: structuredClone(definition.filters),
          numeratorStatus: definition.numeratorStatus,
          denominatorStatus: definition.denominatorStatus,
          valueField: definition.valueField,
        };
  return {
    version: 1,
    outputNodeId: "result",
    nodes: [
      {
        id: "data",
        label: definition?.name ?? labels.metric,
        type: "metric",
        metric,
        position: { x: 0, y: 0 },
      },
      { id: "result", label: labels.output, type: "output", position: { x: 0, y: 190 } },
    ],
    edges: [{ id: "data_result", source: "data", target: "result", targetHandle: "value" }],
  };
}
export function makeGraphNode(
  type: GraphNodeKind,
  label: string,
  position: { x: number; y: number },
  currency: string,
): KpiGraphNode {
  const common = { id: newId("node"), label, position };
  switch (type) {
    case "metric":
      return { ...common, type, metric: defaultGraphMetric(currency) };
    case "constant":
      return { ...common, type, value: "1" };
    case "compute":
      return { ...common, type, operation: "add" };
    case "compare":
      return { ...common, type, operator: "gte" };
    case "logic":
      return { ...common, type, operation: "and" };
    case "branch":
      return { ...common, type };
    case "output":
      return { ...common, type };
  }
}
function circular(graph: KpiGraph, source: string, target: string): boolean {
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === source) return true;
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const edge of graph.edges) if (edge.source === current) pending.push(edge.target);
  }
  return false;
}
export function connectGraphInput(
  graph: KpiGraph,
  sourceId: string,
  targetId: string,
  handle: KpiGraphHandle,
): KpiGraph | null {
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (
    source === undefined ||
    target === undefined ||
    source.type === "output" ||
    circular(graph, sourceId, targetId)
  )
    return null;
  const port = kpiGraphInputHandles(target, graph).find((input) => input.handle === handle);
  const outputType = kpiGraphNodeType(graph, sourceId);
  if (port === undefined || outputType === null) return null;
  if (target.type === "branch" && (handle === "true" || handle === "false")) {
    const opposite = graph.edges.find(
      (edge) =>
        edge.target === targetId && edge.targetHandle === (handle === "true" ? "false" : "true"),
    );
    if (opposite !== undefined && kpiGraphNodeType(graph, opposite.source) !== outputType)
      return null;
  } else if (port.type !== outputType) return null;
  return {
    ...graph,
    edges: [
      ...graph.edges.filter((edge) => edge.target !== targetId || edge.targetHandle !== handle),
      { id: newId("edge"), source: sourceId, target: targetId, targetHandle: handle },
    ],
  };
}
export function disconnectGraphInput(
  graph: KpiGraph,
  targetId: string,
  handle: KpiGraphHandle,
): KpiGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.target !== targetId || edge.targetHandle !== handle),
  };
}
export function changeGraphNode(graph: KpiGraph, node: KpiGraphNode): KpiGraph {
  const handles = new Set(kpiGraphInputHandles(node).map((port) => port.handle));
  return {
    ...graph,
    nodes: graph.nodes.map((current) => (current.id === node.id ? node : current)),
    edges: graph.edges.filter((edge) => edge.target !== node.id || handles.has(edge.targetHandle)),
  };
}
export function removeGraphNode(graph: KpiGraph, nodeId: string): KpiGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    outputNodeId: graph.outputNodeId === nodeId ? "" : graph.outputNodeId,
  };
}
export function graphFingerprint(definition: KpiDefinitionInput): string {
  const graph = definition.graph;
  if (graph === undefined) return JSON.stringify(definition);
  return JSON.stringify({
    ...definition,
    graph: { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: undefined })) },
  });
}
export function graphIssues(graph: KpiGraph): { nodeId?: string; edgeId?: string; code: string }[] {
  const configuration = graph.nodes.flatMap((node) => {
    if (node.label.trim() === "") return [{ nodeId: node.id, code: "node_configuration" }];
    if (node.type === "constant" && !/^-?\d{1,14}(\.\d{1,4})?$/u.test(node.value))
      return [{ nodeId: node.id, code: "constant_configuration" }];
    if (node.type === "metric" && !kpiDefinitionInput.safeParse(node.metric).success)
      return [{ nodeId: node.id, code: "metric_configuration" }];
    return [];
  });
  return [...validateKpiGraph(graph), ...configuration];
}
export function arrangeKpiGraph(graph: KpiGraph): KpiGraph {
  const depths = new Map<string, number>();
  const depth = (id: string, visiting = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id) ?? 0;
    if (visiting.has(id)) return 0;
    const parents = graph.edges.filter((edge) => edge.target === id);
    const value =
      parents.length === 0
        ? 0
        : Math.max(...parents.map((edge) => depth(edge.source, new Set([...visiting, id])))) + 1;
    depths.set(id, value);
    return value;
  };
  const levels = new Map<number, KpiGraphNode[]>();
  for (const node of graph.nodes) {
    const level = depth(node.id);
    levels.set(level, [...(levels.get(level) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, nodes] of levels)
    nodes.forEach((node, index) =>
      positions.set(node.id, { x: (index - (nodes.length - 1) / 2) * 285, y: level * 185 }),
    );
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
  };
}
export function winRateGraph(
  labels: Record<GraphNodeKind, string>,
  currency: string,
  names: { won: string; closed: string },
): KpiGraph {
  const base = defaultGraphMetric(currency);
  return {
    version: 1,
    outputNodeId: "result",
    nodes: [
      {
        id: "won",
        type: "metric",
        label: names.won,
        position: { x: -145, y: 0 },
        metric: {
          ...base,
          name: names.won,
          calculation: "count",
          unit: "count",
          valueField: undefined,
          filters: { status: "won" },
        },
      },
      {
        id: "closed",
        type: "metric",
        label: names.closed,
        position: { x: 145, y: 0 },
        metric: {
          ...base,
          name: names.closed,
          calculation: "count",
          unit: "count",
          valueField: undefined,
          filters: { status: "closed" },
        },
      },
      {
        id: "percent",
        type: "compute",
        label: labels.compute,
        operation: "percent",
        position: { x: 0, y: 185 },
      },
      { id: "result", type: "output", label: labels.output, position: { x: 0, y: 370 } },
    ],
    edges: [
      { id: "won_percent", source: "won", target: "percent", targetHandle: "a" },
      { id: "closed_percent", source: "closed", target: "percent", targetHandle: "b" },
      { id: "percent_result", source: "percent", target: "result", targetHandle: "value" },
    ],
  };
}
export function previewGraphPeriod(choice: GraphPeriodChoice, today: string): KpiPeriod {
  if (choice === "rolling30" || choice === "rolling90")
    return {
      kind: "rolling",
      interval: "monthly",
      rollingDays: choice === "rolling30" ? 30 : 90,
      startsOn: new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  return { kind: "calendar", interval: choice, startsOn: `${today.slice(0, 4)}-01-01` };
}
