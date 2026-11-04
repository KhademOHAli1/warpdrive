import { describe, expect, it } from "vitest";
import {
  conditionPredicates,
  findConditionPredicate,
  parseConditionConfig,
} from "./conditionExpression";
import {
  conditionGraph,
  conditionNode,
  group,
  grouped,
  predicate,
  predicatePath,
  value,
} from "./conditionGroups.test-helpers";
import { validateDefinition } from "./definition";
import type { WorkflowNode } from "./schemas";
import { definitionSchema } from "./schemas";

function boundaryTree() {
  let id = 0;
  const leaves = Array.from({ length: 8 }, (_, index) =>
    group(
      "leaf" + index,
      "and",
      Array.from({ length: 4 }, () => predicate("p" + id++)),
    ),
  );
  const branches = [
    group("branch0", "or", leaves.slice(0, 2)),
    ...leaves.slice(2).map((leaf, index) => group("branch" + (index + 1), "and", [leaf])),
  ];
  return group("root", "and", branches);
}

function parsed(raw: unknown, mode: "draft" | "execute" | "copy" = "execute") {
  const result = parseConditionConfig(raw, mode);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a reviewed condition fixture");
  return result.value;
}

describe("bounded condition wire, identities and current paths", () => {
  it("preserves legacy flat bytes and derives a row without persisting a new ID", () => {
    const raw = { right: value(0), operator: "equals", left: value(0) };
    const before = JSON.stringify(raw);
    for (const mode of ["draft", "execute", "copy"] as const) {
      const result = parsed(raw, mode);
      expect(result.kind).toBe("legacy");
      expect(JSON.stringify(result.config)).toBe(before);
      expect(conditionPredicates(result)).toMatchObject([{ id: "legacy", path: [] }]);
    }
    expect(JSON.stringify(raw)).toBe(before);
    expect(raw).not.toHaveProperty("expression");
  });

  it("visits nested predicates in stored order with real full paths", () => {
    const raw = grouped(
      group("root", "or", [
        predicate("first"),
        group("nested", "and", [predicate("second"), predicate("third")]),
      ]),
    );
    const result = parsed(raw);
    expect(result.kind).toBe("grouped");
    expect(conditionPredicates(result).map(({ id, path }) => ({ id, path }))).toEqual([
      { id: "first", path: predicatePath(0) },
      { id: "second", path: predicatePath(1, 0) },
      { id: "third", path: predicatePath(1, 1) },
    ]);
    expect(findConditionPredicate(result, "second")?.path).toEqual(predicatePath(1, 0));
    expect(findConditionPredicate(result, "missing")).toBeUndefined();
  });

  it("retains known incomplete rows, empty groups and omitted default in draft and copy modes", () => {
    const raw = {
      expression: {
        kind: "group",
        id: "root",
        operator: "and",
        children: [
          { kind: "predicate", id: "empty" },
          { kind: "group", id: "nested", operator: "or", children: [] },
        ],
      },
    };
    const before = structuredClone(raw);
    for (const mode of ["draft", "copy"] as const) expect(parsed(raw, mode).config).toEqual(before);
    expect(raw).toEqual(before);
    expect(parseConditionConfig(raw, "execute").ok).toBe(false);
  });

  it("retains a known empty row without inventing an identifier or operand", () => {
    const raw = {
      expression: { kind: "group", id: "root", operator: "and", children: [{}] },
      defaultPort: "false",
    };
    for (const mode of ["draft", "copy"] as const) {
      const result = parsed(raw, mode);
      expect(result.config).toEqual(raw);
      expect(conditionPredicates(result)).toMatchObject([
        { id: undefined, path: predicatePath(0), predicate: {} },
      ]);
    }
  });

  it("rejects empty executable groups and absent explicit default", () => {
    expect(parseConditionConfig(grouped(group("root", "and", [])), "execute").ok).toBe(false);
    expect(
      parseConditionConfig({ expression: group("root", "and", [predicate("p")]) }, "execute").ok,
    ).toBe(false);
  });

  it("requires executable operands while retaining their reviewed partial bindings for copy", () => {
    const raw = grouped(
      group("root", "and", [
        {
          kind: "predicate",
          id: "p",
          operator: "equals",
          left: {},
          right: { kind: "value", literalType: "date" },
        },
      ]),
    );
    expect(parsed(raw, "copy").config).toEqual(raw);
    expect(parsed(raw, "draft").config).toEqual(raw);
    expect(parseConditionConfig(raw, "execute").ok).toBe(false);
  });

  it("rejects mixed root members and unknown default values in every mode", () => {
    for (const raw of [
      { ...grouped(), left: value(true) },
      { ...grouped(), right: value(false) },
      { ...grouped(), defaultPort: "true" },
      { ...grouped(), credential: "private" },
    ]) {
      for (const mode of ["draft", "execute", "copy"] as const)
        expect(parseConditionConfig(raw, mode).ok).toBe(false);
    }
  });

  it("rejects duplicate IDs across groups and predicates rather than selecting a row", () => {
    for (const expression of [
      group("root", "and", [predicate("same"), predicate("same")]),
      group("same", "and", [predicate("same")]),
      group("root", "and", [group("nested", "or", [predicate("p")]), predicate("nested")]),
    ]) {
      for (const mode of ["draft", "execute", "copy"] as const)
        expect(parseConditionConfig(grouped(expression), mode).ok).toBe(false);
    }
  });

  it("reuses the safe identifier grammar without exposing prototype or path IDs", () => {
    for (const id of ["__proto__", "1first", "a.b", "a".repeat(65)])
      expect(parseConditionConfig(grouped(group("root", "and", [predicate(id)])), "copy").ok).toBe(
        false,
      );
  });

  it("rejects unknown keys and mixed group/predicate branches", () => {
    const values = [
      {
        expression: { ...group("root", "and", [predicate("p")]), left: value(true) },
        defaultPort: "false",
      },
      {
        expression: group("root", "and", [Object.assign(predicate("p"), { children: [] })]),
        defaultPort: "false",
      },
      {
        expression: group("root", "and", [
          Object.assign(predicate("p"), { credentials: "private" }),
        ]),
        defaultPort: "false",
      },
    ];
    for (const raw of values)
      for (const mode of ["draft", "execute", "copy"] as const)
        expect(parseConditionConfig(raw, mode).ok).toBe(false);
  });

  it("allows exactly three group levels and rejects a fourth", () => {
    const third = group("g3", "and", [predicate("p")]);
    const expression = group("root", "and", [group("g2", "or", [third])]);
    expect(parsed(grouped(expression)).kind).toBe("grouped");
    third.children = [group("g4", "or", [predicate("p")])];
    for (const mode of ["draft", "execute", "copy"] as const)
      expect(parseConditionConfig(grouped(expression), mode).ok).toBe(false);
  });

  it("accepts eight children and rejects nine without truncating the source", () => {
    const expression = group(
      "root",
      "and",
      Array.from({ length: 8 }, (_, i) => predicate("p" + i)),
    );
    expect(parsed(grouped(expression)).kind).toBe("grouped");
    expression.children.push(predicate("ninth"));
    expect(parseConditionConfig(grouped(expression), "draft").ok).toBe(false);
    expect(expression.children).toHaveLength(9);
  });

  it("accepts32predicates and rejects33within the other budgets", () => {
    const expression = group(
      "root",
      "and",
      Array.from({ length: 4 }, (_, g) =>
        group(
          "g" + g,
          "or",
          Array.from({ length: 8 }, (_, p) => predicate("p" + g + "_" + p)),
        ),
      ),
    );
    expect(conditionPredicates(parsed(grouped(expression)))).toHaveLength(32);
    expression.children.push(group("extra", "or", [predicate("p33")]));
    expect(parseConditionConfig(grouped(expression), "copy").ok).toBe(false);
  });

  it("accepts48totalnodes and rejects49without relying on the predicate or depth limit", () => {
    const expression = boundaryTree();
    expect(conditionPredicates(parsed(grouped(expression)))).toHaveLength(32);
    const firstBranch = expression.children[0];
    const firstLeaf = firstBranch?.kind === "group" ? firstBranch.children[0] : undefined;
    if (firstLeaf?.kind !== "group") throw new Error("Expected bounded fixture leaf");
    const moved = firstLeaf.children.pop();
    if (moved === undefined) throw new Error("Expected bounded fixture predicate");
    expression.children.push(group("extra", "and", [moved]));
    expect(parseConditionConfig(grouped(expression), "execute").ok).toBe(false);
  });

  it("prechecks hostile raw depth iteratively before recursive schema traversal", () => {
    let expression = group("leaf", "and", [predicate("p")]);
    for (let index = 0; index < 10000; index++)
      expression = group("g" + index, "and", [expression]);
    for (const mode of ["draft", "execute", "copy"] as const) {
      let result: ReturnType<typeof parseConditionConfig> | undefined;
      expect(() => {
        result = parseConditionConfig(grouped(expression), mode);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it("prechecks grouped config before the structural definition JSON schema can recurse", () => {
    let expression = group("leaf", "and", [predicate("p")]);
    for (let index = 0; index < 10000; index++)
      expression = group("g" + index, "and", [expression]);
    const graph = conditionGraph(grouped());
    conditionNode(graph).config = { expression, defaultPort: "false" };
    let result: ReturnType<typeof definitionSchema.safeParse> | undefined;
    expect(() => {
      result = definitionSchema.safeParse(graph);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("rejects overdeep grouped publication through the existing definition API without recursion failure", () => {
    let expression = group("leaf", "and", [predicate("p")]);
    for (let index = 0; index < 10000; index++)
      expression = group("g" + index, "and", [expression]);
    const graph = conditionGraph(grouped());
    conditionNode(graph).config = { expression, defaultPort: "false" };
    let result: ReturnType<typeof validateDefinition> | undefined;
    expect(() => {
      result = validateDefinition(graph);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  it("rejects a deep non-scalar operand before the definition JSON parser traverses it", () => {
    let nested: WorkflowNode["config"][string] = { leaf: true };
    for (let index = 0; index < 10000; index++) nested = { nested };
    const graph = conditionGraph(grouped());
    conditionNode(graph).config = grouped(
      group("root", "and", [
        predicate("p", { kind: "value", value: nested }, "equals", value(true)),
      ]),
    );
    let result: ReturnType<typeof definitionSchema.safeParse> | undefined;
    expect(() => {
      result = definitionSchema.safeParse(graph);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("rejects a deep unknown grouped-root member before the definition JSON parser traverses it", () => {
    let nested: WorkflowNode["config"][string] = { leaf: true };
    for (let index = 0; index < 10000; index++) nested = { nested };
    const graph = conditionGraph(grouped());
    conditionNode(graph).config = { ...grouped(), unreviewed: nested };
    let result: ReturnType<typeof definitionSchema.safeParse> | undefined;
    expect(() => {
      result = definitionSchema.safeParse(graph);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("bounds cyclic non-JSON input without throwing or walking forever", () => {
    const expression = group("root", "and", []);
    expression.children.push(expression);
    for (const mode of ["draft", "execute", "copy"] as const)
      expect(parseConditionConfig(grouped(expression), mode).ok).toBe(false);
  });

  it("rejects explicit undefined and unreviewed scalar tags at the copy boundary", () => {
    for (const left of [
      { kind: "value", value: "x", literalType: undefined },
      { kind: "value", value: "x", literalType: "decimal" },
      { kind: "reference", nodeId: "read", path: ["value"], literalType: "number" },
    ]) {
      expect(
        parseConditionConfig(
          {
            expression: {
              kind: "group",
              id: "root",
              operator: "and",
              children: [{ kind: "predicate", id: "p", operator: "exists", left }],
            },
            defaultPort: "false",
          },
          "copy",
        ).ok,
      ).toBe(false);
    }
  });

  it("retains invalid typed raw drafts but rejects executable intent without repair", () => {
    for (const left of [
      value("-", "number"),
      value("2030-02-30", "date"),
      value("2030-03-20T12:00", "instant"),
    ]) {
      const raw = grouped(group("root", "and", [predicate("p", left)]));
      expect(parsed(raw, "copy").config).toEqual(raw);
      expect(parsed(raw, "draft").config).toEqual(raw);
      expect(parseConditionConfig(raw, "execute").ok).toBe(false);
    }
  });

  it("keeps declared legacy greaterThan wire and restricts isEmpty to grouped predicates", () => {
    const raw = { left: value(2), operator: "greaterThan", right: value(1) };
    expect(parsed(raw).config).toEqual(raw);
    expect(parseConditionConfig({ left: value(""), operator: "isEmpty" }, "execute").ok).toBe(
      false,
    );
    expect(parsed(grouped(group("root", "and", [predicate("p", value(""), "isEmpty")]))).kind).toBe(
      "grouped",
    );
    expect(
      parseConditionConfig(
        grouped(group("root", "and", [predicate("p", value(2), "greaterThan", value(1))])),
        "execute",
      ).ok,
    ).toBe(false);
  });

  it("rejects nonobject roots and unsafe path-like node members without echoing raw literals", () => {
    for (const raw of [
      null,
      [],
      "private raw condition",
      {
        expression: { kind: "group", id: "root", operator: "xor", children: [] },
        defaultPort: "false",
      },
    ]) {
      const result = parseConditionConfig(raw, "copy");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(JSON.stringify(result.error)).not.toContain("private raw condition");
    }
  });
});
