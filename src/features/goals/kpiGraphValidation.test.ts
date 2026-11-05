import { describe, expect, it } from "vitest";
import { kpiGraphInputHandles, kpiGraphNodeType, validateKpiGraph } from "./kpiGraphValidation";
import type { KpiGraph, KpiGraphNode } from "./kpiModel";

const base = { label: "Node", position: { x: 0, y: 0 } };
const number = (id: string): KpiGraphNode => ({ ...base, id, type: "constant", value: "1" });
const edge = (
  source: string,
  target: string,
  targetHandle: KpiGraph["edges"][number]["targetHandle"],
): KpiGraph["edges"][number] => ({
  id: `${source}-${target}-${targetHandle}`,
  source,
  target,
  targetHandle,
});
function fixture(): KpiGraph {
  return {
    version: 1,
    nodes: [
      number("a"),
      number("b"),
      { ...base, id: "sum", type: "compute", operation: "add" },
      { ...base, id: "out", type: "output" },
    ],
    edges: [edge("a", "sum", "a"), edge("b", "sum", "b"), edge("sum", "out", "value")],
    outputNodeId: "out",
  };
}
const codes = (graph: KpiGraph) => validateKpiGraph(graph).map((issue) => issue.code);

describe("typed KPI DAG structure", () => {
  it("accepts joined numeric calculations and exposes their required typed ports", () => {
    const graph = fixture();
    expect(validateKpiGraph(graph)).toEqual([]);
    expect(kpiGraphNodeType(graph, "out")).toBe("number");
    expect(kpiGraphInputHandles({ ...base, id: "abs", type: "compute", operation: "abs" })).toEqual(
      [{ handle: "a", type: "number" }],
    );
  });
  it("accepts a Boolean condition with numeric branches", () => {
    const graph = fixture();
    graph.nodes = [
      number("a"),
      number("b"),
      { ...base, id: "check", type: "compare", operator: "gte" },
      { ...base, id: "branch", type: "branch" },
      { ...base, id: "out", type: "output" },
    ];
    graph.edges = [
      edge("a", "check", "a"),
      edge("b", "check", "b"),
      edge("check", "branch", "condition"),
      edge("a", "branch", "true"),
      edge("b", "branch", "false"),
      edge("branch", "out", "value"),
    ];
    expect(validateKpiGraph(graph)).toEqual([]);
    expect(kpiGraphNodeType(graph, "check")).toBe("boolean");
    expect(kpiGraphNodeType(graph, "branch")).toBe("number");
  });
  it("infers Boolean branch values that feed a later logic gate", () => {
    const graph = fixture();
    graph.nodes.push(
      { ...base, id: "check", type: "compare", operator: "eq" },
      { ...base, id: "choice", type: "branch" },
      { ...base, id: "not", type: "logic", operation: "not" },
      { ...base, id: "final", type: "branch" },
    );
    graph.edges = [
      edge("a", "sum", "a"),
      edge("b", "sum", "b"),
      edge("a", "check", "a"),
      edge("b", "check", "b"),
      edge("check", "choice", "condition"),
      edge("check", "choice", "true"),
      edge("check", "choice", "false"),
      edge("choice", "not", "a"),
      edge("not", "final", "condition"),
      edge("sum", "final", "true"),
      edge("a", "final", "false"),
      edge("final", "out", "value"),
    ];
    expect(validateKpiGraph(graph)).toEqual([]);
    expect(kpiGraphNodeType(graph, "choice")).toBe("boolean");
    const choice = graph.nodes.find((node) => node.id === "choice");
    expect(choice).toBeDefined();
    if (choice === undefined) throw new Error("missing fixture");
    expect(kpiGraphInputHandles(choice, graph).find((port) => port.handle === "true")?.type).toBe(
      "boolean",
    );
  });
  it("rejects Boolean output and numeric input into logic", () => {
    const graph = fixture();
    graph.nodes[2] = { ...base, id: "sum", type: "logic", operation: "and" };
    expect(codes(graph)).toContain("graph_type_mismatch");
  });
  it("rejects mismatched branch values", () => {
    const graph = fixture();
    graph.nodes.push(
      { ...base, id: "check", type: "compare", operator: "eq" },
      { ...base, id: "choice", type: "branch" },
    );
    graph.edges = [
      edge("a", "sum", "a"),
      edge("b", "sum", "b"),
      edge("a", "check", "a"),
      edge("b", "check", "b"),
      edge("check", "choice", "condition"),
      edge("sum", "choice", "true"),
      edge("check", "choice", "false"),
      edge("choice", "out", "value"),
    ];
    expect(codes(graph)).toContain("graph_branch_type");
    expect(kpiGraphNodeType(graph, "choice")).toBeNull();
  });
  it("rejects missing operands, unexpected ports and duplicate input handles", () => {
    const graph = fixture();
    graph.edges = [
      edge("a", "sum", "a"),
      { ...edge("b", "sum", "a"), id: "second-a" },
      edge("sum", "out", "value"),
      edge("a", "b", "value"),
    ];
    expect(codes(graph)).toEqual(
      expect.arrayContaining([
        "graph_missing_input",
        "graph_duplicate_input",
        "graph_unexpected_input",
      ]),
    );
  });
  it("rejects dangling edges, duplicate identities and an invalid designated output", () => {
    const graph = fixture();
    graph.nodes.push(number("a"));
    const firstEdge = graph.edges[0];
    if (firstEdge === undefined) throw new Error("missing fixture edge");
    graph.edges.push(edge("missing", "out", "value"), { ...firstEdge, source: "b" });
    graph.outputNodeId = "a";
    expect(codes(graph)).toEqual(
      expect.arrayContaining([
        "graph_dangling_edge",
        "graph_duplicate_node",
        "graph_duplicate_edge",
        "graph_invalid_output",
      ]),
    );
  });
  it("rejects cycles including disconnected fragments, and rejects unreachable nodes", () => {
    const graph = fixture();
    graph.nodes.push({ ...base, id: "cycle", type: "compute", operation: "abs" });
    graph.edges.push(edge("cycle", "cycle", "a"));
    expect(codes(graph)).toEqual(expect.arrayContaining(["graph_cycle", "graph_unreachable"]));
    expect(kpiGraphNodeType(graph, "cycle")).toBe("number");
  });
  it("requires exactly one numeric result and enforces bounded graph sizes", () => {
    const graph = fixture();
    graph.nodes.push({ ...base, id: "other-output", type: "output" });
    expect(codes(graph)).toContain("graph_output_count");
    graph.nodes = Array.from({ length: 41 }, (_, index) => number(String(index)));
    expect(codes(graph)).toContain("graph_node_limit");
    graph.nodes = fixture().nodes;
    graph.edges = Array.from({ length: 81 }, (_, index) => ({
      ...edge("a", "sum", "a"),
      id: String(index),
    }));
    expect(codes(graph)).toContain("graph_edge_limit");
  });
});
