import { describe, expect, it } from "vitest";
import { validateKpiGraphUnits } from "./kpiGraphUnits";
import type { KpiDefinitionInput, KpiGraph, KpiGraphNode, KpiUnit } from "./kpiModel";

const base = { label: "Node", position: { x: 0, y: 0 } };
function metric(id: string, unit: KpiUnit, currency?: string): KpiGraphNode {
  const definition: Omit<KpiDefinitionInput, "graph"> = {
    name: id,
    description: "",
    source: "deals",
    calculation: "sum",
    unit,
    currency,
    dateField: "closed",
    filters: { status: "won" },
    valueField: "value",
  };
  return { ...base, id, type: "metric", metric: definition };
}
function edge(
  source: string,
  target: string,
  targetHandle: KpiGraph["edges"][number]["targetHandle"],
): KpiGraph["edges"][number] {
  return { id: `${source}-${target}-${targetHandle}`, source, target, targetHandle };
}
function binary(
  left: KpiGraphNode,
  right: KpiGraphNode,
  operation: Extract<KpiGraphNode, { type: "compute" }>["operation"],
): KpiGraph {
  return {
    version: 1,
    nodes: [
      left,
      right,
      { ...base, id: "compute", type: "compute", operation },
      { ...base, id: "out", type: "output" },
    ],
    edges: [
      edge(left.id, "compute", "a"),
      edge(right.id, "compute", "b"),
      edge("compute", "out", "value"),
    ],
    outputNodeId: "out",
  };
}
const codes = (graph: KpiGraph, unit: KpiUnit, currency?: string) =>
  validateKpiGraphUnits(graph, { unit, currency }).map((issue) => issue.code);

describe("KPI graph static units", () => {
  it("rejects adding money to counts and never silently converts currencies", () => {
    expect(
      codes(
        binary(metric("money", "money", "EUR"), metric("count", "count"), "add"),
        "money",
        "EUR",
      ),
    ).toContain("graph_unit_mismatch");
    expect(
      codes(
        binary(metric("eur", "money", "EUR"), metric("usd", "money", "USD"), "add"),
        "money",
        "EUR",
      ),
    ).toEqual(expect.arrayContaining(["graph_mixed_currencies", "graph_unit_mismatch"]));
  });
  it("accepts margin arithmetic through compatible money operands and an explicit percent", () => {
    const graph = binary(
      metric("revenue", "money", "EUR"),
      metric("cost", "money", "EUR"),
      "subtract",
    );
    graph.nodes.push(
      { ...base, id: "margin", type: "compute", operation: "divide" },
      { ...base, id: "one", type: "constant", value: "1" },
      { ...base, id: "percentage", type: "compute", operation: "percent" },
    );
    graph.edges = [
      edge("revenue", "compute", "a"),
      edge("cost", "compute", "b"),
      edge("compute", "margin", "a"),
      edge("revenue", "margin", "b"),
      edge("margin", "percentage", "a"),
      edge("one", "percentage", "b"),
      edge("percentage", "out", "value"),
    ];
    expect(validateKpiGraphUnits(graph, { unit: "percent" })).toEqual([]);
  });
  it("rejects relabelling a measured dimensionless count ratio as money", () => {
    const graph = binary(metric("won", "count"), metric("closed", "count"), "divide");
    expect(codes(graph, "money", "EUR")).toContain("graph_output_unit");
    expect(codes(graph, "custom")).toEqual([]);
  });
  it("lets constants inherit threshold units while retaining a numeric result", () => {
    const graph = binary(
      metric("revenue", "money", "EUR"),
      { ...base, id: "threshold", type: "constant", value: "100" },
      "max",
    );
    expect(validateKpiGraphUnits(graph, { unit: "money", currency: "EUR" })).toEqual([]);
    graph.nodes = [
      { ...base, id: "out", type: "output" },
      { ...base, id: "value", type: "constant", value: "20" },
    ];
    graph.edges = [edge("value", "out", "value")];
    expect(validateKpiGraphUnits(graph, { unit: "days" })).toEqual([]);
  });
  it("rejects incompatible branches and currencies even when a branch would not be chosen", () => {
    const graph: KpiGraph = {
      version: 1,
      outputNodeId: "out",
      nodes: [
        metric("money", "money", "EUR"),
        metric("hours", "hours"),
        { ...base, id: "zero", type: "constant", value: "0" },
        { ...base, id: "check", type: "compare", operator: "gt" },
        { ...base, id: "branch", type: "branch" },
        { ...base, id: "out", type: "output" },
      ],
      edges: [
        edge("money", "check", "a"),
        edge("zero", "check", "b"),
        edge("check", "branch", "condition"),
        edge("money", "branch", "true"),
        edge("hours", "branch", "false"),
        edge("branch", "out", "value"),
      ],
    };
    expect(codes(graph, "custom")).toContain("graph_unit_mismatch");
    graph.nodes = graph.nodes.map((node) =>
      node.id === "hours" ? metric("hours", "money", "USD") : node,
    );
    expect(codes(graph, "custom")).toContain("graph_mixed_currencies");
  });
  it("retains compound multiplication/division powers and distinguishes hours from days", () => {
    const graph = binary(metric("a", "hours"), metric("b", "count"), "multiply");
    expect(codes(graph, "hours")).toContain("graph_output_unit");
    expect(codes(graph, "custom")).toEqual([]);
    expect(
      codes(binary(metric("hours", "hours"), metric("days", "days"), "min"), "hours"),
    ).toContain("graph_unit_mismatch");
    expect(
      codes(
        binary(
          metric("eur", "money", "EUR"),
          { ...base, id: "factor", type: "constant", value: "2" },
          "divide",
        ),
        "money",
        "USD",
      ),
    ).toContain("graph_output_unit");
  });
});
