import { describe, expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { executableDefinition, executableNode } from "./readiness";
import { actionRegistry } from "./registry";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

describe("workflow delay duration contract", () => {
  it.each([1, 60, 525600])("accepts %i whole minutes without coercion", (value) => {
    const input = { minutes: { kind: "value", value } };
    const result = actionRegistry.delay.config.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(input);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["over the 365-day ceiling", 525601],
    ["an oversized integer", Number.MAX_SAFE_INTEGER],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a numeric string", "1"],
    ["a ceiling numeric string", "525600"],
    ["true", true],
    ["false", false],
    ["null", null],
  ] as const)("rejects %s literal minutes", (_label, value) => {
    expect(
      actionRegistry.delay.config.safeParse({ minutes: { kind: "value", value } }).success,
    ).toBe(false);
  });

  it("preserves reference bindings for definition-level type validation", () => {
    const input = {
      minutes: { kind: "reference", nodeId: "read", path: ["value"] },
    };
    expect(actionRegistry.delay.config.safeParse(input).success).toBe(true);

    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
        {
          id: "read",
          type: "record.read",
          version: 1,
          name: "Read deal",
          config: {
            entity: "deal",
            recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
          },
        },
        { id: "wait", type: "delay", version: 1, name: "Wait", config: input },
      ],
      edges: [
        { from: "start", to: "read", port: "next" },
        { from: "read", to: "wait", port: "next" },
      ],
    };
    const result = validateDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContainEqual(
        expect.objectContaining({ code: "type_mismatch", nodeId: "wait" }),
      );
  });

  it("allows valid literal delay nodes and definitions after durable qualification", () => {
    const node: WorkflowNode = {
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait",
      config: { minutes: { kind: "value", value: 1 } },
    };
    expect(actionRegistry.delay.config.safeParse(node.config).success).toBe(true);
    expect(executableNode(node)).toBe(true);
    expect(
      executableDefinition({
        schemaVersion: 1,
        nodes: [
          { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
          node,
        ],
        edges: [{ from: "start", to: "wait", port: "next" }],
      }),
    ).toBe(true);
  });
});
