import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { copyWorkflowDefinition } from "./copyDefinition";
import { validateDefinition } from "./definition";
import { executableDefinition } from "./readiness";
import { nodeTypes, type WorkflowDefinition, type WorkflowNode } from "./schemas";

const unavailable = {
  ok: false,
  error: ERROR_IDS.WORKFLOW_NOT_READY,
  reason: "copy-unavailable",
};
const recordId = "ca3f2b20-96a7-43b4-9c9e-d0c8c0db59fd";
const assigneeId = "eb5a7081-b7a9-4363-9ba1-34c9e178df20";
const activityTypeId = "efc1a22c-1dc1-48d9-88f9-c6bb9695ff86";

function draft(
  type: WorkflowNode["type"] = "trigger.manual",
  config: WorkflowNode["config"] = {},
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [{ id: "step", type, version: 1, name: "پیگیری – Rückruf", config }],
    edges: [],
  };
}

function copied(input: unknown): WorkflowDefinition {
  const result = copyWorkflowDefinition(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a copyable definition");
  return result.value;
}

function expectUnavailable(input: unknown) {
  expect(copyWorkflowDefinition(input)).toStrictEqual(unavailable);
}

function freezeDeep(value: unknown) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

describe("credential-free workflow draft copy", () => {
  it("copies every reviewed v1 action, including declarative CRM references", () => {
    const definitions: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        {
          id: "manual",
          type: "trigger.manual",
          version: 1,
          name: "Start",
          nameMode: "automatic",
          config: {},
        },
        {
          id: "event",
          type: "trigger.record",
          version: 1,
          name: "Datensatz geändert",
          nameMode: "custom",
          config: { entity: "deal", event: "stageChanged" },
        },
        {
          id: "read",
          type: "record.read",
          version: 1,
          name: "خواندن",
          config: { entity: "organization", recordId: { kind: "value", value: recordId } },
        },
        {
          id: "task",
          type: "activity.create",
          version: 1,
          name: "Kunden anrufen",
          config: {
            subject: { kind: "value", value: "پیگیری – Rückruf" },
            dealId: { kind: "reference", nodeId: "read", path: ["id"] },
            assigneeId: { kind: "value", value: assigneeId },
            dueAt: { kind: "value", value: "2026-12-01T10:00:00Z" },
            typeId: activityTypeId,
          },
        },
        {
          id: "condition",
          type: "condition",
          version: 1,
          name: "Compare",
          config: {
            left: { kind: "reference", nodeId: "read", path: ["ownerId"] },
            operator: "notEquals",
            right: { kind: "value", value: assigneeId },
          },
        },
        {
          id: "wait",
          type: "delay",
          version: 1,
          name: "Warten",
          config: { minutes: { kind: "value", value: 15 } },
        },
        {
          id: "notice",
          type: "notification",
          version: 1,
          name: "اعلان",
          config: { title: { kind: "reference", nodeId: "task", path: ["id"] } },
        },
      ],
      edges: [
        { from: "manual", to: "read", port: "next" },
        { from: "read", to: "task", port: "next" },
        { from: "task", to: "condition", port: "next" },
        { from: "condition", to: "wait", port: "true" },
        { from: "condition", to: "notice", port: "false" },
      ],
      layout: { manual: { x: -120.5, y: 100 }, task: { x: 200, y: 300.25 } },
    };

    expect(copied(definitions)).toStrictEqual(definitions);
    expect(executableDefinition(definitions)).toBe(false);
  });

  it.each(nodeTypes)("retains an empty incomplete %s config without inserting defaults", (type) => {
    const source = draft(type);
    expect(copied(source)).toStrictEqual(source);
  });

  it.each([
    ["trigger.record", { entity: "person" }],
    ["trigger.record", { event: "updated" }],
    ["record.read", { entity: "lead" }],
    ["activity.create", { subject: { kind: "value", value: "   " } }],
    ["activity.create", { subject: { kind: "value", value: "x".repeat(256) } }],
    ["condition", { operator: "equals" }],
    ["condition", { left: { kind: "value", value: false }, operator: "greaterThan" }],
    ["delay", { minutes: { kind: "value", value: "۱x" } }],
    ["delay", { minutes: { kind: "value", value: 0 } }],
    ["delay", { minutes: { kind: "value", value: 1.5 } }],
    ["notification", { title: { kind: "value", value: "" } }],
  ] satisfies [WorkflowNode["type"], WorkflowNode["config"]][])(
    "retains known incomplete %s configuration independently of publication validation",
    (type, config) => {
      const source = draft(type, config);
      expect(validateDefinition(source).ok).toBe(false);
      expect(copied(source)).toStrictEqual(source);
    },
  );

  const partialBindings: WorkflowNode["config"][string][] = [
    {},
    { kind: "value" },
    { value: "" },
    { kind: "reference" },
    { nodeId: "read" },
    { path: [] },
    { nodeId: "read", path: ["id"] },
    { kind: "reference", nodeId: "read" },
    { kind: "reference", path: [] },
  ];
  it.each(partialBindings)(
    "preserves a strict partial binding %j without completing it",
    (binding) => {
      const source = draft("record.read", { recordId: binding });
      expect(copied(source)).toStrictEqual(source);
    },
  );

  it.each(["", "literal text", 0, -1.5, true, false, null])(
    "preserves the bounded scalar literal %j",
    (value) => {
      const source = draft("condition", { left: { kind: "value", value } });
      expect(copied(source)).toStrictEqual(source);
    },
  );

  it("retains graph errors and unavailable mappings for later authoring review", () => {
    const source = draft("record.read", {
      entity: "deal",
      recordId: { kind: "reference", nodeId: "missing", path: ["missingOutput"] },
    });
    source.edges = [{ from: "step", to: "step", port: "next" }];
    source.layout = { step: { x: -100000, y: 100000 } };
    expect(validateDefinition(source).ok).toBe(false);
    expect(copied(source)).toStrictEqual(source);
  });

  it("preserves free text without pretending to detect secrets typed into known text values", () => {
    const source = draft("activity.create", {
      subject: { kind: "value", value: "Review token=example and actorId=documentation" },
    });
    source.nodes[0]!.nameMode = "custom";
    source.nodes[0]!.name = "Connection token review – بازبینی";
    expect(copied(source)).toStrictEqual(source);
  });

  it("returns a detached definition and neither mutates nor aliases the saved source", () => {
    const source = draft("activity.create", {
      subject: { kind: "value", value: "Call" },
      dealId: { kind: "reference", nodeId: "read", path: ["id"] },
    });
    source.layout = { step: { x: 1, y: 2 } };
    source.edges = [{ from: "step", to: "step", port: "next" }];
    const before = structuredClone(source);
    freezeDeep(source);
    const result = copied(source);
    expect(result).not.toBe(source);
    expect(result.nodes).not.toBe(source.nodes);
    expect(result.nodes[0]).not.toBe(source.nodes[0]);
    expect(result.nodes[0]!.config).not.toBe(source.nodes[0]!.config);
    expect(result.nodes[0]!.config.subject).not.toBe(source.nodes[0]!.config.subject);
    expect(result.nodes[0]!.config.dealId).not.toBe(source.nodes[0]!.config.dealId);
    expect(result.edges[0]).not.toBe(source.edges[0]);
    expect(result.layout!.step).not.toBe(source.layout!.step);
    result.nodes[0]!.config.subject = { kind: "value", value: "Changed copy" };
    result.layout!.step!.x = 900;
    result.edges[0]!.to = "another";
    expect(source).toStrictEqual(before);
  });
});

describe("copy policy fails closed without silently stripping material", () => {
  it.each(nodeTypes)(
    "rejects unknown, credential and runtime identity config fields on %s",
    (type) => {
      for (const field of ["unexpected", "connectionId", "actorId"]) {
        expectUnavailable(draft(type, { [field]: "private-value" }));
      }
    },
  );

  it.each([
    "token",
    "accessToken",
    "refreshToken",
    "apiKey",
    "secret",
    "credentials",
    "connectionGrantId",
    "grants",
    "ownerId",
    "publishedBy",
    "sessionId",
    "requestKey",
    "runId",
    "effectId",
  ])("rejects undeclared sensitive field %s instead of copying or removing it", (field) => {
    expectUnavailable(draft("activity.create", { [field]: "private-value" }));
  });

  it("rejects a mixed safe/unsafe multi-node source rather than returning a partial copy", () => {
    const source = draft("trigger.manual");
    source.nodes.push({
      id: "unsafe",
      type: "activity.create",
      version: 1,
      name: "Task",
      config: { subject: { kind: "value", value: "Call" }, connectionId: "private-value" },
    });
    const before = structuredClone(source);
    expectUnavailable(source);
    expect(source).toStrictEqual(before);
  });

  it.each([
    ["literal extra field", { kind: "value", value: "Call", token: "private-value" }],
    [
      "reference extra field",
      { kind: "reference", nodeId: "step", path: ["id"], actorId: "private-value" },
    ],
    ["partial extra field", { path: [], credentials: "private-value" }],
    ["nested object literal", { kind: "value", value: { token: "private-value" } }],
    ["nested array literal", { kind: "value", value: ["private-value"] }],
    ["mixed value and reference", { kind: "value", value: "Call", nodeId: "step" }],
    ["mixed incomplete branches", { value: "Call", path: ["id"] }],
    ["unknown binding kind", { kind: "connection", value: "private-value" }],
    ["arbitrary nested JSON", { metadata: { sessionId: "private-value" } }],
    ["bare scalar", "private-value"],
    ["bare array", []],
    ["bare null", null],
  ])("rejects %s recursively with the same safe unavailable result", (_label, binding) => {
    expectUnavailable({
      ...draft("record.read"),
      nodes: [{ ...draft("record.read").nodes[0], config: { recordId: binding } }],
    });
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects dangerous reference path %s even in an incomplete binding",
    (property) => {
      expectUnavailable(draft("record.read", { recordId: { path: [property] } }));
    },
  );

  it.each([
    { nodeId: "not a node identifier" },
    { nodeId: 5 },
    { path: ["id", 1] },
    { path: Array.from({ length: 9 }, () => "id") },
    { kind: "value", value: "x".repeat(50001) },
    { kind: "value", value: Number.POSITIVE_INFINITY },
    { kind: "value", value: Number.NaN },
    { kind: "value", value: 1n },
    { kind: "value", value: undefined },
  ])("rejects a nonrepresentable known binding shape without exposing its data", (binding) => {
    expectUnavailable({
      ...draft("record.read"),
      nodes: [{ ...draft("record.read").nodes[0], config: { recordId: binding } }],
    });
  });

  it.each([
    ["trigger.record", { entity: "unknown-provider" }],
    ["trigger.record", { event: "execute" }],
    ["record.read", { entity: "" }],
    ["condition", { operator: "arbitrary-code" }],
    ["activity.create", { typeId: "not-a-uuid" }],
  ] satisfies [WorkflowNode["type"], WorkflowNode["config"]][])(
    "rejects an undeclared %s enum or identifier without coercing it",
    (type, config) => expectUnavailable(draft(type, config)),
  );

  it.each([
    ["unknown schema version", (source: WorkflowDefinition) => ({ ...source, schemaVersion: 2 })],
    [
      "unknown action",
      (source: WorkflowDefinition) => ({
        ...source,
        nodes: [{ ...source.nodes[0], type: "provider.send" }],
      }),
    ],
    [
      "unknown action version",
      (source: WorkflowDefinition) => ({ ...source, nodes: [{ ...source.nodes[0], version: 2 }] }),
    ],
    [
      "unknown root identity",
      (source: WorkflowDefinition) => ({ ...source, ownerId: "private-value" }),
    ],
    [
      "copied run history",
      (source: WorkflowDefinition) => ({ ...source, runs: [{ actorId: "private-value" }] }),
    ],
    [
      "unknown node identity",
      (source: WorkflowDefinition) => ({
        ...source,
        nodes: [{ ...source.nodes[0], publishedBy: "private-value" }],
      }),
    ],
    [
      "unknown edge field",
      (source: WorkflowDefinition) => ({
        ...source,
        edges: [{ from: "step", to: "step", port: "next", token: "private-value" }],
      }),
    ],
    [
      "unknown layout field",
      (source: WorkflowDefinition) => ({
        ...source,
        layout: { step: { x: 0, y: 0, actorId: "private-value" } },
      }),
    ],
    [
      "non-object config",
      (source: WorkflowDefinition) => ({ ...source, nodes: [{ ...source.nodes[0], config: [] }] }),
    ],
  ] as const)("rejects %s through the structural boundary", (_label, mutate) => {
    expectUnavailable(mutate(draft()));
  });

  it.each([
    null,
    undefined,
    "not a definition",
    [],
    {},
    { schemaVersion: 1, nodes: [], edges: [] },
  ])("returns a stable, payload-free failure for malformed input %j", (input) =>
    expectUnavailable(input),
  );

  it("does not echo sensitive field names, values or the rejected definition in failures", () => {
    const privateName = "private-owner-key";
    const privateValue = "private-credential-value";
    const source = draft("notification", { title: { kind: "value", value: "Safe" } });
    source.nodes[0]!.config[privateName] = { accessToken: privateValue };
    const result = copyWorkflowDefinition(source);
    expect(result).toStrictEqual(unavailable);
    expect(JSON.stringify(result)).not.toContain(privateName);
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(JSON.stringify(result)).not.toContain("notification");
  });
});
