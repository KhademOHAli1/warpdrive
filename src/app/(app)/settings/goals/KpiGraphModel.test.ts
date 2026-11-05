import { describe, expect, it } from "vitest";
import { validateKpiGraphUnits } from "@/features/goals/kpiGraphUnits";
import type { KpiDefinition, KpiGraph, KpiGraphNode } from "@/features/goals/kpiModel";
import {
  changeGraphNode,
  connectGraphInput,
  graphFingerprint,
  graphFromDefinition,
  graphIssues,
  removeGraphNode,
  winRateGraph,
} from "./KpiGraphModel";

const labels = {
  metric: "Data",
  constant: "Number",
  compute: "Compute",
  compare: "Compare",
  logic: "Logic",
  branch: "If / Else",
  output: "Result",
};
const initial: KpiDefinition = {
  id: "definition",
  familyId: "family",
  revision: 3,
  createdAt: "2026-11-05T12:00:00Z",
  name: "Won value",
  description: "CRM won value.",
  source: "deals",
  calculation: "sum",
  valueField: "value",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  filters: { status: "won" },
};

describe("KPI graph authoring model", () => {
  it("adapts an existing metric without nesting its revision identity in a data node", () => {
    const graph = graphFromDefinition(initial, "EUR", labels);
    expect(graphIssues(graph)).toEqual([]);
    const node = graph.nodes[0];
    expect(node?.type).toBe("metric");
    if (node?.type !== "metric") throw new Error("Expected data node");
    expect(node.metric).toMatchObject({
      name: initial.name,
      calculation: "sum",
      filters: { status: "won" },
    });
    expect(node.metric).not.toHaveProperty("id");
    expect(node.metric).not.toHaveProperty("familyId");
    expect(node.metric).not.toHaveProperty("graph");
  });
  it("builds a real two-input percentage calculation with a closed-deal denominator", () => {
    const graph = winRateGraph(labels, "EUR", { won: "Won", closed: "Closed" });
    expect(graphIssues(graph)).toEqual([]);
    expect(validateKpiGraphUnits(graph, { unit: "percent" })).toEqual([]);
    expect(
      graph.edges
        .filter((edge) => edge.target === "percent")
        .map((edge) => edge.targetHandle)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(graph.nodes.find((node) => node.id === "closed")).toMatchObject({
      type: "metric",
      metric: { calculation: "count", dateField: "closed", filters: { status: "closed" } },
    });
  });
  it("replaces exactly one input when a variable is selected", () => {
    const graph = winRateGraph(labels, "EUR", { won: "Won", closed: "Closed" });
    const next = connectGraphInput(graph, "won", "percent", "b");
    expect(
      next?.edges.filter((edge) => edge.target === "percent" && edge.targetHandle === "b"),
    ).toEqual([expect.objectContaining({ source: "won" })]);
    expect(
      next?.edges.filter((edge) => edge.target === "percent" && edge.targetHandle === "a"),
    ).toEqual(graph.edges.filter((edge) => edge.target === "percent" && edge.targetHandle === "a"));
    expect(graph.edges.find((edge) => edge.targetHandle === "b")?.source).toBe("closed");
  });
  it("rejects circular and number-to-boolean connections without mutating the graph", () => {
    const graph: KpiGraph = {
      version: 1,
      outputNodeId: "out",
      nodes: [
        { id: "one", label: "One", type: "constant", value: "1", position: { x: 0, y: 0 } },
        {
          id: "abs",
          label: "Absolute",
          type: "compute",
          operation: "abs",
          position: { x: 0, y: 100 },
        },
        {
          id: "next",
          label: "Next",
          type: "compute",
          operation: "abs",
          position: { x: 0, y: 200 },
        },
        { id: "and", label: "And", type: "logic", operation: "and", position: { x: 200, y: 200 } },
        { id: "out", label: "Result", type: "output", position: { x: 0, y: 300 } },
      ],
      edges: [
        { id: "1", source: "one", target: "abs", targetHandle: "a" },
        { id: "2", source: "abs", target: "next", targetHandle: "a" },
        { id: "3", source: "next", target: "out", targetHandle: "value" },
      ],
    };
    const before = structuredClone(graph);
    expect(connectGraphInput(graph, "next", "abs", "a")).toBeNull();
    expect(connectGraphInput(graph, "one", "and", "a")).toBeNull();
    expect(graph).toEqual(before);
  });
  it("drops a removed operand and identifies a missing result after deletion", () => {
    const graph = winRateGraph(labels, "EUR", { won: "Won", closed: "Closed" });
    const compute: KpiGraphNode = {
      id: "percent",
      label: "Absolute",
      type: "compute",
      operation: "abs",
      position: { x: 0, y: 100 },
    };
    expect(
      changeGraphNode(graph, compute).edges.some(
        (edge) => edge.target === "percent" && edge.targetHandle === "b",
      ),
    ).toBe(false);
    const removed = removeGraphNode(graph, "result");
    expect(graphIssues(removed).some((issue) => issue.code === "graph_output_count")).toBe(true);
  });
  it("keeps layout changes out of the preview fingerprint but invalidates a changed calculation", () => {
    const graph = graphFromDefinition(initial, "EUR", labels);
    const definition = { ...initial, graph };
    const moved = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        position: { x: node.position.x + 50, y: node.position.y },
      })),
    };
    expect(graphFingerprint({ ...definition, graph: moved })).toBe(graphFingerprint(definition));
    const changed = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "metric"
          ? { ...node, metric: { ...node.metric, filters: { status: "lost" as const } } }
          : node,
      ),
    };
    expect(graphFingerprint({ ...definition, graph: changed })).not.toBe(
      graphFingerprint(definition),
    );
  });
});
