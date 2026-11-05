import { describe, expect, it, vi } from "vitest";
import { evaluateKpiGraph } from "./kpiGraph";
import type { KpiDefinitionInput, KpiGraph, KpiGraphNode, KpiMeasurement } from "./kpiModel";
import { kpiDefinitionInput } from "./kpiSchemas";

const options = {
  period: { start: "2026-11-01", end: "2026-11-30" },
  unit: "custom" as const,
  customUnit: "calculated units",
};
const metric: Omit<KpiDefinitionInput, "graph"> = {
  name: "Won deals",
  description: "",
  source: "deals",
  calculation: "count",
  unit: "count",
  dateField: "closed",
  filters: { status: "won" },
};
const base = (id: string) => ({ id, label: id, position: { x: 0, y: 0 } });
const constant = (id: string, value: string): KpiGraphNode => ({
  ...base(id),
  type: "constant",
  value,
});
const output: KpiGraphNode = { ...base("out"), type: "output" };
function edge(
  source: string,
  target: string,
  targetHandle: KpiGraph["edges"][number]["targetHandle"],
): KpiGraph["edges"][number] {
  return { id: `${source}-${target}-${targetHandle}`, source, target, targetHandle };
}
function graph(nodes: KpiGraphNode[], edges: KpiGraph["edges"]): KpiGraph {
  return { version: 1, nodes: [...nodes, output], edges, outputNodeId: "out" };
}
function measured(
  value: string | null,
  state: KpiMeasurement["state"] = "available",
): KpiMeasurement {
  return {
    state,
    value,
    recordCount: 1,
    excludedCount: 0,
    numerator: null,
    denominator: null,
    sampleSize: 1,
    contributors: [
      {
        id: "record1",
        label: "Permitted source",
        href: "/deals/record1",
        value,
        included: true,
        reason: null,
      },
    ],
    contributorsTruncated: false,
    issues: ["viewer_visible_records"],
    period: options.period,
    evaluatedAt: "2026-11-05T00:00:00Z",
  };
}
function binary(
  operation: Extract<KpiGraphNode, { type: "compute" }>["operation"],
  a: string,
  b: string,
): KpiGraph {
  return graph(
    [constant("a", a), constant("b", b), { ...base("calc"), type: "compute", operation }],
    [edge("a", "calc", "a"), edge("b", "calc", "b"), edge("calc", "out", "value")],
  );
}
function conditional(): KpiGraph {
  return graph(
    [
      { ...base("metric"), type: "metric", metric },
      constant("threshold", "0"),
      { ...base("compare"), type: "compare", operator: "gte" },
      constant("yes", "5"),
      constant("one", "1"),
      constant("zero", "0"),
      { ...base("bad"), type: "compute", operation: "divide" },
      { ...base("branch"), type: "branch" },
    ],
    [
      edge("metric", "compare", "a"),
      edge("threshold", "compare", "b"),
      edge("compare", "branch", "condition"),
      edge("yes", "branch", "true"),
      edge("one", "bad", "a"),
      edge("zero", "bad", "b"),
      edge("bad", "branch", "false"),
      edge("branch", "out", "value"),
    ],
  );
}
describe("typed KPI graph execution", () => {
  it("uses exact scaled decimal arithmetic with explicit overflow and division errors", async () => {
    const resolve = vi.fn(() => Promise.resolve(measured("99")));
    expect(
      (await evaluateKpiGraph(binary("add", "0.1001", "0.2002"), resolve, options)).value,
    ).toBe("0.3003");
    expect(
      (await evaluateKpiGraph(binary("multiply", "1.2345", "2"), resolve, options)).value,
    ).toBe("2.469");
    expect((await evaluateKpiGraph(binary("divide", "1", "3"), resolve, options)).value).toBe(
      "0.3333",
    );
    expect(await evaluateKpiGraph(binary("divide", "1", "0"), resolve, options)).toMatchObject({
      state: "unavailable",
      value: null,
      issues: expect.arrayContaining(["graph_divide_by_zero"]),
    });
    expect(
      await evaluateKpiGraph(binary("add", "99999999999999.9999", "0.0001"), resolve, options),
    ).toMatchObject({
      state: "unavailable",
      value: null,
      issues: expect.arrayContaining(["graph_overflow"]),
    });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("supports unary rounding, absolute values and explicit percentages", async () => {
    const unary = (operation: "round" | "abs") =>
      graph(
        [constant("a", "-1.5"), { ...base("calc"), type: "compute", operation }],
        [edge("a", "calc", "a"), edge("calc", "out", "value")],
      );
    expect(
      (await evaluateKpiGraph(unary("round"), () => Promise.resolve(measured("0")), options)).value,
    ).toBe("-2");
    expect(
      (await evaluateKpiGraph(unary("abs"), () => Promise.resolve(measured("0")), options)).value,
    ).toBe("1.5");
    expect(
      (
        await evaluateKpiGraph(binary("percent", "1", "2"), () => Promise.resolve(measured("0")), {
          ...options,
          unit: "percent",
        })
      ).value,
    ).toBe("50");
  });
  it("evaluates only the chosen branch and retains condition evidence", async () => {
    const result = await evaluateKpiGraph(
      conditional(),
      () => Promise.resolve(measured("2")),
      options,
    );
    expect(result).toMatchObject({ state: "available", value: "5", recordCount: 1 });
    expect(result.nodeResults?.some((n) => n.nodeId === "bad")).toBe(false);
    expect(result.nodeResults?.find((n) => n.nodeId === "compare")?.value).toBe(true);
    expect(result.contributors[0]).toMatchObject({
      recordId: "record1",
      nodeId: "metric",
      label: "Permitted source",
    });
  });
  it("applies logical gates to branch selection", async () => {
    const draft = conditional();
    draft.nodes.push({ ...base("not"), type: "logic", operation: "not" });
    draft.edges = draft.edges.filter((e) => e.targetHandle !== "condition");
    draft.edges.push(edge("compare", "not", "a"), edge("not", "branch", "condition"));
    const result = await evaluateKpiGraph(draft, () => Promise.resolve(measured("2")), options);
    expect(result.nodeResults?.find((n) => n.nodeId === "not")?.value).toBe(false);
    expect(result.issues).toContain("graph_divide_by_zero");
  });
  it("keeps an unknown or incomplete condition unavailable rather than picking a branch", async () => {
    for (const measurement of [
      measured(null, "unavailable"),
      measured("2", "incomplete"),
      measured("2", "stale"),
    ]) {
      const result = await evaluateKpiGraph(
        conditional(),
        () => Promise.resolve(measurement),
        options,
      );
      expect(result.state).toBe("unavailable");
      expect(result.value).toBeNull();
      expect(result.issues).toContain("graph_unknown_condition");
      expect(result.nodeResults?.some((n) => n.nodeId === "yes" || n.nodeId === "bad")).toBe(false);
    }
  });
  it("caches identical metric calculations and conservatively propagates incomplete operands", async () => {
    const draft = graph(
      [
        { ...base("m1"), type: "metric", metric },
        { ...base("m2"), type: "metric", metric: { ...metric, name: "Renamed decoration" } },
        { ...base("sum"), type: "compute", operation: "add" },
      ],
      [edge("m1", "sum", "a"), edge("m2", "sum", "b"), edge("sum", "out", "value")],
    );
    const resolve = vi.fn(() => Promise.resolve(measured("3", "incomplete")));
    const result = await evaluateKpiGraph(draft, resolve, { ...options, unit: "count" });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ state: "incomplete", value: "6", recordCount: 1 });
  });
  it("rejects invalid topology and incompatible units before reading any source", async () => {
    const resolve = vi.fn(() => Promise.resolve(measured("1")));
    expect((await evaluateKpiGraph({ ...conditional(), edges: [] }, resolve, options)).state).toBe(
      "unavailable",
    );
    const wrong = graph(
      [
        { ...base("count"), type: "metric", metric },
        {
          ...base("money"),
          type: "metric",
          metric: {
            ...metric,
            unit: "money",
            currency: "EUR",
            calculation: "sum",
            valueField: "value",
          },
        },
        { ...base("sum"), type: "compute", operation: "add" },
      ],
      [edge("count", "sum", "a"), edge("money", "sum", "b"), edge("sum", "out", "value")],
    );
    expect((await evaluateKpiGraph(wrong, resolve, options)).issues).toContain(
      "graph_unit_mismatch",
    );
    expect(resolve).not.toHaveBeenCalled();
  });
  it("bounds distinct metric fanout at eight evaluations", async () => {
    const nodes: KpiGraphNode[] = Array.from({ length: 9 }, (_, i) => ({
      ...base(`m${i}`),
      type: "metric",
      metric: {
        ...metric,
        filters: { pipelineId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` },
      },
    }));
    const edges: KpiGraph["edges"] = [];
    for (let i = 1; i < 9; i++) {
      nodes.push({ ...base(`sum${i}`), type: "compute", operation: "add" });
      edges.push(
        edge(i === 1 ? "m0" : `sum${i - 1}`, `sum${i}`, "a"),
        edge(`m${i}`, `sum${i}`, "b"),
      );
    }
    edges.push(edge("sum8", "out", "value"));
    const resolve = vi.fn(() => Promise.resolve(measured("1")));
    const result = await evaluateKpiGraph(graph(nodes, edges), resolve, {
      ...options,
      unit: "count",
    });
    expect(resolve).toHaveBeenCalledTimes(8);
    expect(result.state).toBe("unavailable");
    expect(result.issues).toContain("graph_metric_limit");
  });
  it("accepts graph output metadata while rejecting manual metrics and invalid graph payloads", () => {
    const definition = {
      ...metric,
      unit: "custom",
      customUnit: "score",
      graph: binary("add", "1", "2"),
    };
    expect(kpiDefinitionInput.safeParse(definition).success).toBe(true);
    const manual = conditional();
    const node = manual.nodes.find((n) => n.type === "metric");
    if (node?.type === "metric")
      node.metric = {
        ...node.metric,
        source: "manual",
        calculation: "sum",
        dateField: "measured",
        filters: {},
      };
    expect(kpiDefinitionInput.safeParse({ ...definition, graph: manual }).success).toBe(false);
    expect(kpiDefinitionInput.safeParse({ ...definition, source: "manual" }).success).toBe(false);
    expect(
      kpiDefinitionInput.safeParse({ ...definition, graph: { ...definition.graph, version: 2 } })
        .success,
    ).toBe(false);
  });
});
