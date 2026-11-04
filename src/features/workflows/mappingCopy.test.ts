import { describe, expect, it } from "vitest";
import { copyWorkflowDefinition } from "./copyDefinition";

function draft(binding: unknown) {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "manual", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "compare",
        type: "condition",
        version: 1,
        name: "Compare",
        config: { left: binding, operator: "equals", right: { kind: "value", value: null } },
      },
    ],
    edges: [{ from: "manual", to: "compare", port: "next" }],
  };
}

describe("typed mapping drafts survive reviewed duplication", () => {
  it.each([
    { kind: "value", value: 0 },
    { kind: "value", value: -12.5 },
    { kind: "value", value: "", literalType: "number" },
    { kind: "value", value: "-", literalType: "number" },
    { kind: "value", value: "12.", literalType: "number" },
    { kind: "value", value: "2030-03-20", literalType: "date" },
    { kind: "value", value: "2030-02-30", literalType: "date" },
    { kind: "value", value: "", literalType: "date" },
    { kind: "value", value: "2030-03-20T12:00:00+03:30", literalType: "instant" },
    { kind: "value", value: "2030-03-20T12:00", literalType: "instant" },
    { kind: "value", value: "", literalType: "instant" },
    { literalType: "number" },
    { kind: "value", literalType: "date" },
    { value: "-", literalType: "number" },
    { kind: "reference", nodeId: "removed", path: ["expectedCloseDate"] },
  ])("retains authored intent and raw input %j without completing it", (binding) => {
    const source = draft(binding);
    const before = structuredClone(source);
    const result = copyWorkflowDefinition(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a reviewed inert draft copy");
    expect(result.value).toStrictEqual(before);
    expect(source).toStrictEqual(before);
    expect(result.value).not.toBe(source);
    expect(result.value.nodes[1]?.config.left).not.toBe(binding);
  });

  it.each([
    { kind: "value", value: "x", literalType: "time" },
    { kind: "value", value: "x", literalType: "DATE" },
    { kind: "value", value: "x", literalType: { type: "date" } },
    { kind: "reference", nodeId: "manual", path: ["recordId"], literalType: "date" },
    { kind: "value", value: "x", literalType: "date", nodeId: "manual" },
    { kind: "value", value: "x", literalType: "date", credentials: "unreviewed" },
    { kind: "value", value: ["2030-03-20"], literalType: "date" },
    { kind: "value", value: "x", literalType: undefined },
  ])("rejects unreviewed or non-JSON typed shapes %j", (binding) => {
    const source = draft(binding);
    expect(copyWorkflowDefinition(source)).toMatchObject({
      ok: false,
      reason: "copy-unavailable",
    });
    expect(source.nodes[1]?.config.left).toBe(binding);
  });
});
