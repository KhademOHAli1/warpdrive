import { err, ok } from "@/types/result";
import { ifElsePorts } from "./ifElseBudget";
import {
  workflowIteratorBodyDepth,
  workflowIteratorWithinBudget,
} from "./workflowIteratorFrameContract";
import {
  workflowIteratorConfig,
  workflowIteratorSearchSources,
} from "./workflowIteratorRuntimeContract";

interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly config: unknown;
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly port: string;
}

export interface WorkflowIteratorGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface WorkflowIteratorGraphIndex {
  nodes: Map<string, GraphNode>;
  incoming: Map<string, GraphEdge>;
  outgoing: Map<string, GraphEdge[]>;
}

// Mail drafts and human forms have their own per-run/per-node identities.
// Admit only actions whose effects and receipts can share an occurrence transaction.
const bodyTypes = new Set([
  "record.read",
  "record.search",
  "record.create",
  "record.update",
  "record.delete",
  "record.upsert",
  "record.pick",
  "activity.create",
  "calendar.create",
  "condition",
  "ifElse",
  "filter",
  "delay",
]);

function graphPorts(node: GraphNode): readonly string[] {
  switch (node.type) {
    case "iterator":
      return ["loop", "done"];
    case "condition":
      return ["true", "false"];
    case "ifElse":
      return ifElsePorts(node.config);
    default:
      return ["next"];
  }
}

function descendants(
  entry: string | null,
  outgoing: WorkflowIteratorGraphIndex["outgoing"],
): Set<string> {
  const visited = new Set<string>();
  const pending = entry === null ? [] : [entry];
  for (const id of pending) {
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of outgoing.get(id) ?? []) pending.push(edge.to);
  }
  return visited;
}

function indexEdges(
  edges: readonly GraphEdge[],
  nodes: ReadonlyMap<string, GraphNode>,
  rootId: string,
) {
  const incoming = new Map<string, GraphEdge>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const source = nodes.get(edge.from);
    const siblings = outgoing.get(edge.from) ?? [];
    if (source === undefined || !nodes.has(edge.to) || edge.to === rootId || incoming.has(edge.to))
      return null;
    if (!graphPorts(source).includes(edge.port) || siblings.some((item) => item.port === edge.port))
      return null;
    incoming.set(edge.to, edge);
    outgoing.set(edge.from, [...siblings, edge]);
  }
  return { incoming, outgoing };
}

function indexGraph(definition: WorkflowIteratorGraph): WorkflowIteratorGraphIndex | null {
  if (definition.nodes.length > 100 || definition.edges.length > 200) return null;
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const root = triggers[0];
  if (nodes.size !== definition.nodes.length || triggers.length !== 1 || root === undefined)
    return null;
  const edges = indexEdges(definition.edges, nodes, root.id);
  if (edges === null || descendants(root.id, edges.outgoing).size !== nodes.size) return null;
  if (
    definition.nodes.some(
      (node) => node.type === "condition" && edges.outgoing.get(node.id)?.length !== 2,
    )
  )
    return null;
  return { nodes, ...edges };
}

function compileBody(graph: WorkflowIteratorGraphIndex, entry: string | null) {
  const body = [];
  for (const id of descendants(entry, graph.outgoing)) {
    const node = graph.nodes.get(id);
    if (node === undefined || node.version !== 1 || !bodyTypes.has(node.type)) return null;
    const nextNodeIds = (graph.outgoing.get(id) ?? []).map((edge) => edge.to);
    const mayEndItem =
      node.type === "filter" ||
      (node.type === "ifElse" && nextNodeIds.length < graphPorts(node).length);
    body.push({ id, nextNodeIds, mayEndItem });
  }
  return body;
}

export function compileWorkflowIteratorGraph(
  definition: WorkflowIteratorGraph,
  iteratorNodeId: string,
) {
  const graph = indexGraph(definition);
  const iterators = definition.nodes.filter((node) => node.type === "iterator");
  const iterator = iterators[0];
  if (
    graph === null ||
    iterators.length !== 1 ||
    iterator?.id !== iteratorNodeId ||
    iterator.version !== 1
  )
    return err("invalid_graph" as const);
  const config = workflowIteratorConfig.safeParse(iterator.config);
  if (!config.success) return err("invalid_configuration" as const);
  const edges = graph.outgoing.get(iteratorNodeId) ?? [];
  const entryNodeId = edges.find((edge) => edge.port === "loop")?.to ?? null;
  const doneNodeId = edges.find((edge) => edge.port === "done")?.to ?? null;
  const body = compileBody(graph, entryNodeId);
  if (body === null) return err("invalid_graph" as const);
  const nonBodySteps = graph.nodes.size - body.length;
  const source = config.data.items;
  if (source.kind === "reference") {
    const search = workflowIteratorSearchSources(definition, iteratorNodeId).find(
      (node) => node.id === source.nodeId,
    );
    if (search === undefined) return err("invalid_source" as const);
    return ok({ graph, config: config.data, entryNodeId, doneNodeId, body, nonBodySteps, search });
  }
  const depth = workflowIteratorBodyDepth({ iteratorNodeId, entryNodeId, doneNodeId, body });
  if (depth === null) return err("invalid_graph" as const);
  if (!workflowIteratorWithinBudget(nonBodySteps, source.items.length, depth))
    return err("budget_exceeded" as const);
  return ok({
    graph,
    config: config.data,
    entryNodeId,
    doneNodeId,
    body,
    nonBodySteps,
    search: null,
  });
}

export function workflowIteratorGraphReady(definition: WorkflowIteratorGraph): boolean {
  const iterator = definition.nodes.find((node) => node.type === "iterator");
  return iterator === undefined || compileWorkflowIteratorGraph(definition, iterator.id).ok;
}

export function workflowIteratorAllowsUnframedNode(
  definition: WorkflowIteratorGraph,
  nodeId: string,
): boolean {
  const iterator = definition.nodes.find((node) => node.type === "iterator");
  if (iterator === undefined) return true;
  const compiled = compileWorkflowIteratorGraph(definition, iterator.id);
  return compiled.ok && !compiled.value.body.some((node) => node.id === nodeId);
}
