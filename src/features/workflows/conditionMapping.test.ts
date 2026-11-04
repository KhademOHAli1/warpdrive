import { describe, expect, it } from "vitest";
import {
  conditionGraph,
  conditionNode,
  group,
  grouped,
  predicate,
  predicatePath,
  source,
  value,
} from "./conditionGroups.test-helpers";
import {
  applyConditionMappingSelection,
  describeConditionPredicate,
  prepareConditionConfig,
  resolveConditionOperand,
} from "./conditionMapping";
import { noMappingFields } from "./mapping.test-helpers";
import { applyMappingSelection, describeMappingTarget } from "./mappingCatalog";
import type { WorkflowDefinition } from "./schemas";

function context(definition: WorkflowDefinition) {
  return { definition, nodeId: "check", metadata: noMappingFields };
}
function prepare(raw: unknown) {
  const definition = conditionGraph(raw);
  return prepareConditionConfig(raw, context(definition));
}
function row(definition: WorkflowDefinition, id: string) {
  const result = describeConditionPredicate(definition, "check", id, noMappingFields);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected current condition fixture row");
  return result.value;
}
function binary(
  left = source("read", "value"),
  right: Parameters<typeof predicate>[3] = value("0012.3400"),
  operator = "equals",
) {
  return grouped(group("root", "and", [predicate("p", left, operator, right)]));
}

describe("per-predicate source roles and guarded current selection", () => {
  it("derives decimal, date and boolean RHS roles from each row's own LHS", () => {
    const raw = grouped(
      group("root", "and", [
        predicate("money", source("read", "value"), "equals", value("1.00")),
        predicate(
          "date",
          source("read", "expectedCloseDate"),
          "equals",
          value("2030-03-20", "date"),
        ),
        predicate("flag", value(false), "equals", value(true)),
      ]),
    );
    const graph = conditionGraph(raw);
    expect(row(graph, "money").right?.target.contract.kind).toBe("decimal");
    expect(row(graph, "money").right?.target.literalContext).toBe("decimal");
    expect(row(graph, "date").right?.target.contract.kind).toBe("date");
    expect(row(graph, "flag").right?.target.contract.kind).toBe("boolean");
    expect(prepareConditionConfig(raw, context(graph)).ok).toBe(true);
  });

  it("uses actual node IDs and complete nested operand paths for plans and issues", () => {
    const raw = grouped(
      group("root", "and", [
        predicate("first"),
        group("nested", "or", [
          predicate(
            "date",
            source("read", "expectedCloseDate"),
            "equals",
            value("not a date", "date"),
          ),
        ]),
      ]),
    );
    const graph = conditionGraph(raw);
    const plan = row(graph, "date");
    expect(plan.path).toEqual(predicatePath(1, 0));
    expect(plan.right?.target).toMatchObject({
      nodeId: "check",
      path: [...predicatePath(1, 0), "right"],
    });
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ nodeId: "check", path: [...predicatePath(1, 0), "right"] }),
    );
    expect(graph.nodes).toHaveLength(7);
  });

  it("validates a later unavailable static reference even behind a first true OR predicate", () => {
    const raw = grouped(
      group("root", "or", [predicate("yes", value(true)), predicate("bad", source("other", "id"))]),
    );
    const result = prepare(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContainEqual(
        expect.objectContaining({ path: [...predicatePath(1), "left"] }),
      );
  });

  it("prepares literal-only groups without manufacturing a workflow context", () => {
    const raw = grouped(
      group("root", "and", [
        predicate("zero", value(0), "equals", value(0)),
        group("nested", "or", [predicate("null", value(null)), predicate("yes", value(true))]),
      ]),
    );
    const result = prepareConditionConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("grouped");
      expect(result.value.config).toEqual(raw);
      expect(result.value.predicates.map((entry) => entry.id)).toEqual(["zero", "null", "yes"]);
    }
  });

  it("requires the real graph for every grouped reference even when runtime would skip it", () => {
    const raw = grouped(
      group("root", "or", [
        predicate("yes", value(true)),
        predicate("later", source("read", "title")),
      ]),
    );
    expect(prepareConditionConfig(raw).ok).toBe(false);
    expect(prepare(raw).ok).toBe(true);
  });

  it("preserves decimal spelling and derives only a local resolution contract", () => {
    const raw = binary();
    const before = structuredClone(raw);
    const graph = conditionGraph(raw);
    const plan = row(graph, "p");
    expect(plan.issues).toEqual([]);
    expect(plan.right?.literalContract?.kind).toBe("decimal");
    if (plan.right === undefined) throw new Error("Expected decimal RHS");
    expect(resolveConditionOperand(plan.right, {})).toMatchObject({
      state: "value",
      value: "0012.3400",
      contract: { kind: "decimal" },
    });
    expect(raw).toEqual(before);
    expect(JSON.stringify(raw)).not.toContain("literalType");
  });

  it("rejects native and number-tagged alternatives to exact decimal strings", () => {
    for (const right of [value(12.34), value("12.34", "number"), value(true)])
      expect(prepare(binary(source("read", "value"), right)).ok).toBe(false);
  });

  it("requires full decimal grammar for equality without trimming, exponent or locale parsing", () => {
    for (const raw of ["", "-", "1.", " 1.0", "1.0 ", "1e2", "1,00", "۱۲٫۳"])
      expect(prepare(binary(source("read", "value"), value(raw))).ok).toBe(false);
    for (const raw of ["00012.3400", "+0.00", "-12.34000"])
      expect(prepare(binary(source("read", "value"), value(raw))).ok).toBe(true);
  });

  it("rejects a trailing line terminator in decimal equality instead of promoting it to exact decimal", () => {
    for (const raw of ["12.34\n", "12.34\r", "12.34\r\n"])
      expect(prepare(binary(source("read", "value"), value(raw))).ok).toBe(false);
  });

  it("allows exact decimal contains fragments including empty text without full-number validation", () => {
    for (const fragment of [".340", "", "+", "12."]) {
      const raw = binary(source("read", "value"), value(fragment), "contains");
      const graph = conditionGraph(raw);
      const plan = row(graph, "p");
      expect(plan.right?.target.literalContext).toBe("decimal-fragment");
      expect(plan.issues).toEqual([]);
      expect(prepareConditionConfig(raw, context(graph)).ok).toBe(true);
      if (plan.right === undefined) throw new Error("Expected exact fragment");
      expect(resolveConditionOperand(plan.right, {})).toMatchObject({
        state: "value",
        value: fragment,
      });
    }
  });

  it("does not promote a generic text reference to decimal from its apparent value", () => {
    expect(prepare(binary(source("read", "value"), source("read", "title"))).ok).toBe(false);
    const graph = conditionGraph(binary(source("read", "value"), source("read", "title")));
    expect(row(graph, "p").right?.inspection.compatibility).toBe("incompatible");
  });

  it("permits a qualified decimal reference and retains its actual nullable contract", () => {
    const raw = binary(source("read", "value"), source("read", "value"));
    const graph = conditionGraph(raw);
    const plan = row(graph, "p");
    expect(prepareConditionConfig(raw, context(graph)).ok).toBe(true);
    expect(plan.right?.inspection.source?.contract).toEqual({ kind: "decimal", nullable: true });
  });

  it("keeps grouped native numeric intent strict without casting an invalid raw draft", () => {
    expect(
      prepare(grouped(group("root", "and", [predicate("p", value(0), "equals", value(0))]))).ok,
    ).toBe(true);
    const raw = grouped(
      group("root", "and", [predicate("p", value(0), "equals", value("-", "number"))]),
    );
    const before = structuredClone(raw);
    expect(prepare(raw).ok).toBe(false);
    expect(raw).toEqual(before);
  });

  it("requires explicit civil date intent while retaining invalid or generic text for repair", () => {
    const date = source("read", "expectedCloseDate");
    expect(prepare(binary(date, value("2028-02-29", "date"))).ok).toBe(true);
    for (const right of [value("2028-02-29"), value("2026-02-29", "date"), value("", "date")]) {
      const raw = binary(date, right);
      const before = structuredClone(raw);
      expect(prepare(raw).ok).toBe(false);
      expect(raw).toEqual(before);
    }
  });

  it("uses completed instant descriptors and explicit offset intent without losing precision", () => {
    const raw = binary(
      source("clock", "resumeAt"),
      value("2030-03-20T13:00:00.000000001+01:00", "instant"),
    );
    expect(prepare(raw).ok).toBe(true);
    expect(prepare(binary(source("clock", "resumeAt"), value("2030-03-20T13:00:00"))).ok).toBe(
      false,
    );
    expect(prepare(binary(source("clock", "resumeAt"), value("2030-03-20", "date"))).ok).toBe(
      false,
    );
  });

  it("preserves entity domains without inferring identity from a UUID-looking title", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(prepare(binary(source("read", "ownerId"), value(uuid))).ok).toBe(true);
    expect(prepare(binary(source("read", "ownerId"), source("read", "id"))).ok).toBe(false);
    const graph = conditionGraph(binary(source("read", "title"), value(uuid)));
    expect(row(graph, "p").left.inspection.source?.contract.kind).toBe("text");
    expect(row(graph, "p").right?.literalContract?.kind).not.toBe("entity");
  });

  it("retains explicit null as a valid counterpart to a nullable temporal source", () => {
    const raw = binary(source("read", "expectedCloseDate"), value(null));
    const graph = conditionGraph(raw);
    const plan = row(graph, "p");
    expect(plan.right?.raw).toEqual(value(null));
    expect(prepareConditionConfig(raw, context(graph)).ok).toBe(true);
    if (plan.right === undefined) throw new Error("Expected explicit null");
    expect(resolveConditionOperand(plan.right, {})).toMatchObject({ state: "null" });
  });

  it("limits isEmpty to text or explicit null and keeps exists false/zero/empty present", () => {
    for (const literal of [value(""), value(" "), value(null)])
      expect(
        prepareConditionConfig(grouped(group("root", "and", [predicate("p", literal, "isEmpty")])))
          .ok,
      ).toBe(true);
    for (const literal of [value(false), value(0)])
      expect(
        prepareConditionConfig(grouped(group("root", "and", [predicate("p", literal, "isEmpty")])))
          .ok,
      ).toBe(false);
    for (const literal of [value(false), value(0), value("")])
      expect(
        prepareConditionConfig(grouped(group("root", "and", [predicate("p", literal, "exists")])))
          .ok,
      ).toBe(true);
  });

  it("invalidates an edited unsupported predecessor without repairing retained bindings", () => {
    const raw = binary(source("read", "value"), value("1.00"));
    const graph = conditionGraph(raw);
    const read = graph.nodes.find((node) => node.id === "read");
    if (read === undefined) throw new Error("Expected actual source");
    read.config.entity = "lead";
    const before = structuredClone(conditionNode(graph).config);
    expect(prepareConditionConfig(conditionNode(graph).config, context(graph)).ok).toBe(false);
    expect(conditionNode(graph).config).toEqual(before);
  });

  it("rejects a pending mapping selection after reorder would put a different ID at its old index", () => {
    const raw = grouped(
      group("root", "and", [
        predicate("first", source("read", "title"), "equals", value("old")),
        predicate("second", source("read", "status"), "equals", value("open")),
      ]),
    );
    raw.expression.children.reverse();
    const graph = conditionGraph(raw);
    const before = structuredClone(graph);
    const result = applyConditionMappingSelection(
      graph,
      "check",
      {
        path: [...predicatePath(0), "right"],
        expectedPredicateId: "first",
        binding: source("read", "currency"),
      },
      noMappingFields,
      true,
    );
    expect(result.ok).toBe(false);
    expect(graph).toEqual(before);
  });

  it("applies a current reordered row's selection as one immutable edit to that row only", () => {
    const raw = grouped(
      group("root", "and", [
        predicate("second", source("read", "status"), "equals", value("open")),
        predicate("first", source("read", "title"), "equals", value("old")),
      ]),
    );
    const graph = conditionGraph(raw);
    const before = structuredClone(graph);
    const result = applyConditionMappingSelection(
      graph,
      "check",
      {
        path: [...predicatePath(1), "right"],
        expectedPredicateId: "first",
        binding: source("read", "currency"),
      },
      noMappingFields,
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.definition).not.toBe(graph);
      expect(row(result.definition, "first").right?.raw).toEqual(source("read", "currency"));
      expect(row(result.definition, "second").right?.raw).toEqual(value("open"));
      expect(result.definition.nodes.find((node) => node.id === "read")).toEqual(
        before.nodes.find((node) => node.id === "read"),
      );
    }
    expect(graph).toEqual(before);
  });

  it("keeps original graph identity for a logically identical reference with reordered object keys", () => {
    const existing = { kind: "reference", path: ["currency"], nodeId: "read" };
    const graph = conditionGraph(binary(source("read", "title"), existing));
    const result = applyConditionMappingSelection(
      graph,
      "check",
      {
        path: [...predicatePath(0), "right"],
        expectedPredicateId: "p",
        binding: source("read", "currency"),
      },
      noMappingFields,
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.definition).toBe(graph);
    }
  });

  it("rejects prototype, noncanonical, negative, out-of-range and wrong-operand path segments", () => {
    const graph = conditionGraph(binary(source("read", "title"), value("old")));
    const before = structuredClone(graph);
    const paths = [
      ["__proto__", "right"],
      ["expression", "children", "01", "right"],
      ["expression", "children", "-1", "right"],
      ["expression", "children", "999999999999999999", "right"],
      [...predicatePath(0), "constructor"],
      [...predicatePath(0), "right", "value"],
    ];
    for (const path of paths)
      expect(
        applyConditionMappingSelection(
          graph,
          "check",
          { path, expectedPredicateId: "p", binding: source("read", "currency") },
          noMappingFields,
          true,
        ).ok,
      ).toBe(false);
    expect(graph).toEqual(before);
    expect(Object.prototype).not.toHaveProperty("right");
  });

  it("rejects readonly, confirmed-denied and forged-row selections without changing the graph", () => {
    const graph = conditionGraph(binary(source("read", "title"), value("old")));
    const before = structuredClone(graph);
    const selection = {
      path: [...predicatePath(0), "right"],
      expectedPredicateId: "p",
      binding: source("read", "currency"),
    };
    expect(
      applyConditionMappingSelection(graph, "check", selection, noMappingFields, false).ok,
    ).toBe(false);
    expect(
      applyConditionMappingSelection(
        graph,
        "check",
        selection,
        { status: "denied", defs: [] },
        true,
      ).ok,
    ).toBe(false);
    expect(
      applyConditionMappingSelection(
        graph,
        "check",
        { ...selection, expectedPredicateId: "forged" },
        noMappingFields,
        true,
      ).ok,
    ).toBe(false);
    const unguarded = describeMappingTarget(graph, "check", selection.path, noMappingFields);
    expect(unguarded.state).toBe("ready");
    if (unguarded.state === "ready")
      expect(
        applyMappingSelection(
          graph,
          "check",
          unguarded.target,
          selection.binding,
          noMappingFields,
          true,
        ).ok,
      ).toBe(false);
    expect(graph).toEqual(before);
  });

  it("preserves legacy cross-primitive wire while grouped equality requires compatible semantic kinds", () => {
    const legacy = { right: value(1), operator: "equals", left: value("1") };
    const before = JSON.stringify(legacy);
    const result = prepareConditionConfig(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("legacy");
      expect(JSON.stringify(result.value.config)).toBe(before);
    }
    expect(
      prepareConditionConfig(
        grouped(group("root", "and", [predicate("p", value("1"), "equals", value(1))])),
      ).ok,
    ).toBe(false);
  });

  it("keeps legacy context-free reference and declared operator wire available to its unchanged evaluator", () => {
    for (const raw of [
      { left: source("old", "value"), operator: "exists", right: source("unused", "value") },
      { left: value(2), operator: "greaterThan", right: value(1) },
    ]) {
      const result = prepareConditionConfig(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe("legacy");
        expect(result.value.config).toEqual(raw);
        expect(result.value.predicates).toEqual([]);
      }
    }
  });
});
