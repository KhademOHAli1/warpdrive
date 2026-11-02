import { describe, expect, it } from "vitest";
import { validateDefinition } from "./definition";
import type { WorkflowDefinition } from "./schemas";

function sample(): WorkflowDefinition {
  return {
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
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Follow up",
        config: {
          subject: { kind: "value", value: "Call the customer" },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}

describe("workflow definition boundary", () => {
  it("rejects a blank literal task title before publication", () => {
    const definition = sample();
    definition.nodes[2]!.config.subject = { kind: "value", value: "   " };
    expect(validateDefinition(definition).ok).toBe(false);
  });
  it("accepts a reachable, typed manual CRM workflow", () => {
    const result = validateDefinition(sample());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nodes).toHaveLength(3);
  });

  it.each([
    ["duplicate_node", (d: ReturnType<typeof sample>) => d.nodes.push(d.nodes[0]!)],
    [
      "missing_node",
      (d: ReturnType<typeof sample>) => d.edges.push({ from: "task", to: "absent", port: "next" }),
    ],
    [
      "cycle",
      (d: ReturnType<typeof sample>) => d.edges.push({ from: "task", to: "start", port: "next" }),
    ],
    [
      "unreachable",
      (d: ReturnType<typeof sample>) => {
        d.edges.pop();
      },
    ],
    [
      "invalid_port",
      (d: ReturnType<typeof sample>) => {
        d.edges[0]!.port = "false";
      },
    ],
    [
      "invalid_definition",
      (d: ReturnType<typeof sample>) => {
        Object.assign(d.nodes[1]!, { type: "arbitrary.code" });
      },
    ],
    [
      "invalid_definition",
      (d: ReturnType<typeof sample>) => {
        Object.assign(d.nodes[1]!, { version: 999 });
      },
    ],
  ] as const)("rejects %s", (code, mutate) => {
    const input = sample();
    mutate(input);
    const result = validateDefinition(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((issue) => issue.code === code)).toBe(true);
  });

  it("rejects references to a node that has not executed", () => {
    const input = sample();
    input.nodes[1]!.config.recordId = { kind: "reference", nodeId: "task", path: ["id"] };
    const result = validateDefinition(input);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContainEqual(
        expect.objectContaining({ code: "unavailable_reference", nodeId: "read" }),
      );
  });

  it("rejects unknown output fields and dangerous property traversal", () => {
    for (const path of [["missing"], ["__proto__", "polluted"], ["constructor"]]) {
      const input = sample();
      input.nodes[1]!.config.recordId = { kind: "reference", nodeId: "start", path };
      expect(validateDefinition(input).ok).toBe(false);
    }
  });

  it("rejects incompatible output types", () => {
    const input = sample();
    input.nodes[2]!.config.dealId = { kind: "reference", nodeId: "read", path: ["value"] };
    const result = validateDefinition(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((issue) => issue.code === "type_mismatch")).toBe(true);
  });

  it("requires one entry trigger and rejects undeclared branches", () => {
    const input = sample();
    input.nodes.push({ ...input.nodes[0]!, id: "other" });
    expect(validateDefinition(input).ok).toBe(false);
  });

  it("rejects arbitrary extra configuration and structural fields", () => {
    expect(validateDefinition({ ...sample(), execute: "dangerous" }).ok).toBe(false);
    const input = sample();
    Object.assign(input.nodes[1]!.config, { sql: "select * from users" });
    expect(validateDefinition(input).ok).toBe(false);
  });

  it("bounds graph size and accepts human-authored Persian names", () => {
    const input = sample();
    input.nodes[2]!.name = "پیگیری مشتری";
    expect(validateDefinition(input).ok).toBe(true);
    input.nodes = Array.from({ length: 101 }, (_, i) => ({ ...input.nodes[0]!, id: `n${i}` }));
    expect(validateDefinition(input).ok).toBe(false);
  });

  it("does not treat an exact monetary amount as a numeric duration", () => {
    const input = sample();
    input.nodes.push({
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait",
      config: {
        minutes: { kind: "reference", nodeId: "read", path: ["value"] },
      },
    });
    input.edges.push({ from: "task", to: "wait", port: "next" });
    const result = validateDefinition(input);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContainEqual(
        expect.objectContaining({ code: "type_mismatch", nodeId: "wait" }),
      );
  });
});
