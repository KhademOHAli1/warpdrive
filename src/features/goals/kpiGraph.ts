import { unavailableKpi } from "./kpiEngine";
import {
  compareGraphNumbers,
  computeGraphNumber,
  graphDecimal,
  graphNumberText,
  KpiGraphMathError,
} from "./kpiGraphMath";
import { validateKpiGraphUnits } from "./kpiGraphUnits";
import { kpiGraphNodeType, validateKpiGraph } from "./kpiGraphValidation";
import type {
  KpiDefinitionInput,
  KpiGraph,
  KpiGraphHandle,
  KpiGraphNode,
  KpiGraphNodeResult,
  KpiMeasurement,
} from "./kpiModel";

export const KPI_GRAPH_MAX_METRICS = 8;
type Metric = Omit<KpiDefinitionInput, "graph">;
type ResolveMetric = (metric: Metric) => Promise<KpiMeasurement>;
type Options = {
  period: KpiMeasurement["period"];
  unit: KpiDefinitionInput["unit"];
  currency?: string;
  customUnit?: string;
};
type NodeValue = {
  type: "number" | "boolean";
  value: bigint | boolean | null;
  state: KpiMeasurement["state"];
  issues: string[];
  metrics: Set<string>;
};
const unique = (values: string[]) => Array.from(new Set(values));
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}
function combined(
  type: NodeValue["type"],
  value: NodeValue["value"],
  parents: NodeValue[],
): NodeValue {
  const states = parents.map((p) => p.state);
  let state: NodeValue["state"] = "available";
  if (states.includes("unavailable")) state = "unavailable";
  else if (states.includes("incomplete")) state = "incomplete";
  else if (states.includes("stale")) state = "stale";
  return {
    type,
    value,
    state,
    issues: unique(parents.flatMap((p) => p.issues)),
    metrics: new Set(parents.flatMap((p) => Array.from(p.metrics))),
  };
}
function failed(type: NodeValue["type"], issue: string, parents: NodeValue[] = []): NodeValue {
  return {
    ...combined(type, null, parents),
    state: "unavailable",
    issues: unique([...parents.flatMap((p) => p.issues), issue]),
  };
}

class GraphRuntime {
  private nodes: Map<string, KpiGraphNode>;
  private incoming: Map<string, string>;
  private values = new Map<string, Promise<NodeValue>>();
  private results = new Map<string, KpiGraphNodeResult>();
  private metricCache = new Map<string, Promise<KpiMeasurement>>();
  private measurements = new Map<string, { node: KpiGraphNode; measurement: KpiMeasurement }>();
  constructor(
    private graph: KpiGraph,
    private resolve: ResolveMetric,
  ) {
    this.nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    this.incoming = new Map(graph.edges.map((e) => [`${e.target}:${e.targetHandle}`, e.source]));
  }
  private input(node: KpiGraphNode, handle: KpiGraphHandle): Promise<NodeValue> {
    const source = this.incoming.get(`${node.id}:${handle}`);
    return source === undefined
      ? Promise.resolve(failed("number", "graph_missing_input"))
      : this.read(source);
  }
  private async metric(node: Extract<KpiGraphNode, { type: "metric" }>): Promise<NodeValue> {
    if (node.metric.source === "manual") return failed("number", "graph_manual_metric");
    const key = canonical({ ...node.metric, name: "", description: "" });
    let pending = this.metricCache.get(key);
    if (pending === undefined) {
      if (this.metricCache.size >= KPI_GRAPH_MAX_METRICS)
        return failed("number", "graph_metric_limit");
      pending = this.resolve(node.metric);
      this.metricCache.set(key, pending);
    }
    const measurement = await pending;
    if (!this.measurements.has(key)) this.measurements.set(key, { node, measurement });
    const parent: NodeValue = {
      type: "number",
      value: null,
      state: measurement.state,
      issues: measurement.issues,
      metrics: new Set([key]),
    };
    try {
      return {
        ...parent,
        value: measurement.value === null ? null : graphDecimal(measurement.value),
      };
    } catch (error) {
      if (error instanceof KpiGraphMathError) return failed("number", error.code, [parent]);
      throw error;
    }
  }
  private async compute(node: Extract<KpiGraphNode, { type: "compute" }>): Promise<NodeValue> {
    const a = await this.input(node, "a");
    const unary = node.operation === "abs" || node.operation === "round";
    const parents = unary ? [a] : [a, await this.input(node, "b")];
    const b = unary ? 0n : parents[1]?.value;
    if (typeof a.value !== "bigint" || typeof b !== "bigint")
      return failed("number", "graph_missing_value", parents);
    try {
      return combined("number", computeGraphNumber(node.operation, a.value, b), parents);
    } catch (error) {
      if (error instanceof KpiGraphMathError) return failed("number", error.code, parents);
      throw error;
    }
  }
  private async compare(node: Extract<KpiGraphNode, { type: "compare" }>): Promise<NodeValue> {
    const a = await this.input(node, "a");
    const b = await this.input(node, "b");
    if (typeof a.value !== "bigint" || typeof b.value !== "bigint")
      return failed("boolean", "graph_missing_value", [a, b]);
    return combined("boolean", compareGraphNumbers(node.operator, a.value, b.value), [a, b]);
  }
  private async logic(node: Extract<KpiGraphNode, { type: "logic" }>): Promise<NodeValue> {
    const a = await this.input(node, "a");
    if (node.operation === "not")
      return typeof a.value === "boolean"
        ? combined("boolean", !a.value, [a])
        : failed("boolean", "graph_missing_value", [a]);
    const b = await this.input(node, "b");
    if (typeof a.value !== "boolean" || typeof b.value !== "boolean")
      return failed("boolean", "graph_missing_value", [a, b]);
    return combined("boolean", node.operation === "and" ? a.value && b.value : a.value || b.value, [
      a,
      b,
    ]);
  }
  private async branch(node: KpiGraphNode): Promise<NodeValue> {
    const condition = await this.input(node, "condition");
    if (condition.state !== "available" || typeof condition.value !== "boolean")
      return failed(kpiGraphNodeType(this.graph, node.id) ?? "number", "graph_unknown_condition", [
        condition,
      ]);
    const chosen = await this.input(node, condition.value ? "true" : "false");
    return combined(chosen.type, chosen.value, [condition, chosen]);
  }
  private async calculate(node: KpiGraphNode): Promise<NodeValue> {
    switch (node.type) {
      case "metric":
        return this.metric(node);
      case "constant":
        return combined("number", graphDecimal(node.value), []);
      case "compute":
        return this.compute(node);
      case "compare":
        return this.compare(node);
      case "logic":
        return this.logic(node);
      case "branch":
        return this.branch(node);
      case "output":
        return this.input(node, "value");
    }
  }
  private async evaluateNode(node: KpiGraphNode): Promise<NodeValue> {
    let value: NodeValue;
    try {
      value = await this.calculate(node);
    } catch (error) {
      if (!(error instanceof KpiGraphMathError)) throw error;
      value = failed("number", error.code);
    }
    const metricKey =
      node.type === "metric" ? canonical({ ...node.metric, name: "", description: "" }) : undefined;
    const measurement =
      metricKey === undefined ? undefined : this.measurements.get(metricKey)?.measurement;
    this.results.set(node.id, {
      nodeId: node.id,
      type: value.type,
      value: typeof value.value === "bigint" ? graphNumberText(value.value) : value.value,
      state: value.state,
      issues: value.issues,
      ...(measurement === undefined ? {} : { measurement }),
    });
    return value;
  }
  private read(id: string): Promise<NodeValue> {
    const existing = this.values.get(id);
    if (existing !== undefined) return existing;
    const node = this.nodes.get(id);
    const pending =
      node === undefined
        ? Promise.resolve(failed("number", "graph_dangling_edge"))
        : this.evaluateNode(node);
    this.values.set(id, pending);
    return pending;
  }
  async run(options: Options): Promise<KpiMeasurement> {
    const output = await this.read(this.graph.outputNodeId);
    const sources = Array.from(output.metrics).flatMap((key) => {
      const source = this.measurements.get(key);
      return source === undefined ? [] : [source];
    });
    const contributors = sources.flatMap(({ node, measurement }) =>
      measurement.contributors.map((row) => ({
        ...row,
        id: `${node.id}:${row.id}`,
        recordId: row.id,
        nodeId: node.id,
        nodeLabel: node.label,
      })),
    );
    const issues = unique([
      "viewer_visible_records",
      "graph_calculation",
      ...output.issues,
      ...(sources.length > 1 ? ["graph_sources_may_overlap"] : []),
    ]);
    return {
      state: output.state,
      value: typeof output.value === "bigint" ? graphNumberText(output.value) : null,
      recordCount: sources.reduce((n, s) => n + s.measurement.recordCount, 0),
      excludedCount: sources.reduce((n, s) => n + s.measurement.excludedCount, 0),
      missingMeasurementDateCount: sources.reduce(
        (n, s) => n + (s.measurement.missingMeasurementDateCount ?? 0),
        0,
      ),
      numerator: null,
      denominator: null,
      sampleSize: null,
      contributors: contributors.slice(0, 200),
      contributorsTruncated:
        contributors.length > 200 || sources.some((s) => s.measurement.contributorsTruncated),
      issues,
      evaluatedAt: new Date().toISOString(),
      period: options.period,
      nodeResults: Array.from(this.results.values()),
    };
  }
}
export async function evaluateKpiGraph(
  graph: KpiGraph,
  resolveMetric: ResolveMetric,
  options: Options,
): Promise<KpiMeasurement> {
  const invalid = validateKpiGraph(graph);
  if (invalid.length > 0)
    return unavailableKpi(invalid[0]?.code ?? "graph_invalid", options.period);
  const units = validateKpiGraphUnits(graph, options);
  if (units.length > 0)
    return unavailableKpi(units[0]?.code ?? "graph_unit_mismatch", options.period);
  return new GraphRuntime(graph, resolveMetric).run(options);
}
