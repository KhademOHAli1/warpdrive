import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { mappingGraph } from "./mapping.test-helpers";
import type {
  DraftValueBinding,
  ReferenceBinding,
  WorkflowDefinition,
  WorkflowNode,
} from "./schemas";

type Json = WorkflowNode["config"][string];
export type PredicateFixture = {
  kind: "predicate";
  id: string;
  left?: Json;
  operator?: string;
  right?: Json;
};
export type GroupFixture = {
  kind: "group";
  id: string;
  operator: "and" | "or";
  children: (PredicateFixture | GroupFixture)[];
};
export function value(
  raw: string | number | boolean | null,
  literalType?: "number" | "date" | "instant",
): DraftValueBinding {
  return literalType === undefined
    ? { kind: "value", value: raw }
    : { kind: "value", value: raw, literalType };
}
export function source(nodeId: string, field: string): ReferenceBinding {
  return { kind: "reference", nodeId, path: [field] };
}
export function predicate(
  id: string,
  left: Json = value(true),
  operator = "exists",
  right?: Json,
): PredicateFixture {
  return { kind: "predicate", id, left, operator, ...(right === undefined ? {} : { right }) };
}
export function group(
  id: string,
  operator: "and" | "or",
  children: GroupFixture["children"],
): GroupFixture {
  return { kind: "group", id, operator, children };
}
export function grouped(expression = group("root", "and", [predicate("first")])) {
  return { expression, defaultPort: "false" as const };
}
export function conditionNode(definition: WorkflowDefinition): WorkflowNode {
  const node = definition.nodes.find((entry) => entry.id === "check");
  if (node === undefined)
    throw new AppError(ERROR_IDS.WORKFLOW_INVALID, "Condition fixture node missing");
  return node;
}
export function conditionGraph(config: unknown): WorkflowDefinition {
  const parsed = z.record(z.string(), z.json()).safeParse(config);
  if (!parsed.success)
    throw new AppError(ERROR_IDS.WORKFLOW_INVALID, "Condition fixture config is not JSON");
  const graph = mappingGraph();
  graph.nodes.push({
    id: "clock",
    type: "delay",
    version: 1,
    name: "Earlier wait",
    config: { minutes: value(1) },
  });
  graph.edges = graph.edges.filter((edge) => edge.from !== "read");
  graph.edges.push(
    { from: "read", to: "clock", port: "next" },
    { from: "clock", to: "check", port: "next" },
  );
  conditionNode(graph).config = parsed.data;
  return graph;
}
export function predicatePath(...indices: number[]): string[] {
  return ["expression", ...indices.flatMap((index) => ["children", String(index)])];
}
