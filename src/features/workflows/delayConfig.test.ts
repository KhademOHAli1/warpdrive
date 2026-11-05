import { describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { defaultConfiguration, getConfigurationSpec } from "./configurationSpec";
import { validateNodeConfiguration } from "./configurationValidation";
import { copyWorkflowDefinition } from "./copyDefinition";
import { validateDefinition } from "./definition";
import { delayResumeAt, delayScheduleAt } from "./delay";
import { boundedDelayConfig, delayUntilDate } from "./delayConfig";
import { initialDefinition } from "./editorModel";
import { isMappingInstant } from "./mappingLiteralIntent";
import { executableDefinition, executableNode } from "./readiness";
import { actionRegistry } from "./registry";
import { retryableTaskDefinition } from "./runRetryProfile";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

const instant = "2030-03-20T12:34:56.123Z";
const value = (raw: string | number | boolean | null) => ({ kind: "value" as const, value: raw });
const until = (raw: string): WorkflowNode["config"] => ({
  until: { ...value(raw), literalType: "instant" },
});
function fixture(config: WorkflowNode["config"]): {
  definition: WorkflowDefinition;
  node: WorkflowNode;
} {
  const node: WorkflowNode = { id: "wait", type: "delay", version: 1, name: "Wait", config };
  return {
    node,
    definition: {
      schemaVersion: 1,
      nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }, node],
      edges: [{ from: "start", to: "wait", port: "next" }],
    },
  };
}
function withRawConfig(config: unknown): unknown {
  const test = fixture({});
  return { ...test.definition, nodes: [test.definition.nodes[0], { ...test.node, config }] };
}

const acceptedInstants = [
  ["Z", instant, "2030-03-20T12:34:56.123Z"],
  ["positive offset", "2030-03-20T13:34:56.123+01:00", "2030-03-20T12:34:56.123Z"],
  ["negative offset", "2030-03-20T07:04:56.123-05:30", "2030-03-20T12:34:56.123Z"],
  ["whole second", "2030-03-20T12:34:56Z", "2030-03-20T12:34:56.000Z"],
  ["one fractional digit", "2030-03-20T12:34:56.1Z", "2030-03-20T12:34:56.100Z"],
  ["trailing precision zeros", "2030-03-20T12:34:56.123000000Z", "2030-03-20T12:34:56.123Z"],
  ["whole-second precision zeros", "2030-03-20T12:34:56.000000000Z", "2030-03-20T12:34:56.000Z"],
] as const;
const invalidInstantValues = [
  "",
  "tomorrow",
  "2030-03-20",
  "2030-03-20T12:34:56",
  "2030-03-20T12:34:56 Europe/Berlin",
  "2030-03-20T12:34:56Z[Europe/Berlin]",
  "2030-02-30T12:34:56Z",
  "2030-03-20T12:34:56.123000001Z",
  "2030-03-20T12:34:56.000000001Z",
  " 2030-03-20T12:34:56Z",
  "2030-03-20T12:34:56Z ",
];

describe("fixed instant wait static contract", () => {
  it.each(acceptedInstants)(
    "retains the authored %s wire and its exact instant",
    (_label, raw, iso) => {
      const test = fixture(until(raw));
      const before = structuredClone(test.definition);
      const parsed = actionRegistry.delay.config.safeParse(test.node.config);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(test.node.config);
      expect(delayUntilDate(raw)?.toISOString()).toBe(iso);
      expect(validateDefinition(test.definition).ok).toBe(true);
      expect(executableNode(test.node)).toBe(true);
      expect(executableDefinition(test.definition)).toBe(true);
      expect(validateNodeConfiguration(test.node, { definition: test.definition })).toEqual({
        status: "valid",
        issues: [],
        runtimeChecks: [],
      });
      const copy = copyWorkflowDefinition(test.definition);
      expect(copy).toEqual({ ok: true, value: before });
      if (copy.ok) expect(copy.value.nodes[1]?.config).not.toBe(test.node.config);
      expect(test.definition).toEqual(before);
    },
  );

  it.each(invalidInstantValues)(
    "keeps invalid instant %j inert with until field feedback",
    (raw) => {
      const test = fixture(until(raw));
      expect(definitionSchema.safeParse(test.definition).success).toBe(true);
      expect(actionRegistry.delay.config.safeParse(test.node.config).success).toBe(false);
      expect(executableNode(test.node)).toBe(false);
      expect(delayUntilDate(raw)).toBeNull();
      expect(
        validateNodeConfiguration(test.node, { definition: test.definition }).issues,
      ).toContainEqual({ nodeId: "wait", path: ["until"], code: "literal_instant_invalid" });
    },
  );

  it.each([null, true, false, 0, 1, [], {}, new Date(instant), undefined])(
    "does not coerce %j into a fixed instant",
    (raw) => expect(delayUntilDate(raw)).toBeNull(),
  );

  it("keeps wait millisecond restrictions separate from WF020 instant comparisons", () => {
    const raw = "2030-03-20T12:34:56.123456789Z";
    expect(isMappingInstant(raw)).toBe(true);
    expect(delayUntilDate(raw)).toBeNull();
  });

  it.each(["1900-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z"])(
    "does not read a clock or apply a future horizon during publication of %s",
    (raw) => {
      const test = fixture(until(raw));
      const clock = vi.spyOn(Date, "now").mockImplementation(() => {
        throw new Error("Static clock read");
      });
      try {
        expect(validateDefinition(test.definition).ok).toBe(true);
        expect(executableNode(test.node)).toBe(true);
        expect(validateNodeConfiguration(test.node, { definition: test.definition }).status).toBe(
          "valid",
        );
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("retains the legacy fixed instant field alongside the new duration default", () => {
    expect(getConfigurationSpec("delay", 1)?.fields).toContainEqual(
      expect.objectContaining({
        path: ["until"],
        modes: ["literal"],
        required: false,
      }),
    );
    expect(defaultConfiguration("delay", {})).toEqual({
      delayType: "DURATION",
      duration: { minutes: value(1) },
    });
  });
});

const inertDrafts: WorkflowNode["config"][] = [
  { until: {} },
  { until: { kind: "value" } },
  { until: { literalType: "instant" } },
  until(""),
  until("2030-03-20T12:"),
  { until: { kind: "value", literalType: "number", value: "-" } },
  { until: { kind: "value", literalType: "date", value: "2030-03-20" } },
  { until: value(instant) },
  { until: { kind: "reference", nodeId: "start", path: ["recordId"] } },
  { until: { kind: "reference", path: [] } },
];
const unsafeConfigs: [string, unknown][] = [
  ["mixed modes", { ...until(instant), minutes: value(1) }],
  ["mixed undefined minutes", { ...until(instant), minutes: undefined }],
  ["unknown config member", { ...until(instant), timeZone: "Europe/Berlin" }],
  ["undefined until", { until: undefined }],
  ["undefined kind", { until: { kind: undefined } }],
  ["undefined value", { until: { kind: "value", literalType: "instant", value: undefined } }],
  ["undefined intent", { until: { kind: "value", value: instant, literalType: undefined } }],
  ["unknown intent", { until: { kind: "value", value: instant, literalType: "civil" } }],
  ["unknown binding kind", { until: { kind: "calendar", value: instant } }],
  [
    "unknown binding member",
    { until: { kind: "value", literalType: "instant", value: instant, token: "private" } },
  ],
  [
    "mixed binding branches",
    { until: { kind: "value", literalType: "instant", value: instant, path: [] } },
  ],
  ["object scalar", { until: { kind: "value", literalType: "instant", value: { instant } } }],
  ["array scalar", { until: { kind: "value", literalType: "instant", value: [instant] } }],
  [
    "oversized scalar",
    { until: { kind: "value", literalType: "instant", value: "x".repeat(50001) } },
  ],
  ["nonfinite scalar", { until: { kind: "value", literalType: "instant", value: Infinity } }],
  [
    "dangerous reference path",
    { until: { kind: "reference", nodeId: "start", path: ["__proto__"] } },
  ],
  [
    "oversized reference path",
    { until: { kind: "reference", nodeId: "start", path: Array(9).fill("id") } },
  ],
];

describe("fixed instant reviewed draft boundary", () => {
  it.each(inertDrafts)("copies the inert known draft %j without completing it", (config) => {
    const test = fixture(config);
    const before = structuredClone(test.definition);
    expect(boundedDelayConfig(config)).toBe(true);
    expect(definitionSchema.safeParse(test.definition).success).toBe(true);
    expect(copyWorkflowDefinition(test.definition)).toEqual({ ok: true, value: before });
    expect(actionRegistry.delay.config.safeParse(config).success).toBe(false);
    expect(executableNode(test.node)).toBe(false);
    expect(test.definition).toEqual(before);
  });

  it.each(unsafeConfigs)(
    "rejects %s before JSON recursion and without stripping",
    (_label, config) => {
      expect(boundedDelayConfig(config)).toBe(false);
      expect(definitionSchema.safeParse(withRawConfig(config)).success).toBe(false);
      expect(actionRegistry.delay.config.safeParse(config).success).toBe(false);
      expect(copyWorkflowDefinition(withRawConfig(config))).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_NOT_READY,
        reason: "copy-unavailable",
      });
    },
  );

  it.each(["deep", "cyclic"] as const)(
    "rejects a %s rich until scalar before recursive JSON parsing",
    (shape) => {
      const rich: Record<string, unknown> = {};
      if (shape === "cyclic") rich.self = rich;
      else {
        let current = rich;
        for (let depth = 0; depth < 20000; depth++) {
          const next: Record<string, unknown> = {};
          current.child = next;
          current = next;
        }
      }
      const config = { until: { kind: "value", literalType: "instant", value: rich } };
      expect(() => definitionSchema.safeParse(withRawConfig(config))).not.toThrow();
      expect(definitionSchema.safeParse(withRawConfig(config)).success).toBe(false);
      expect(copyWorkflowDefinition(withRawConfig(config)).ok).toBe(false);
    },
  );
});

describe("first-arm fixed instant scheduling", () => {
  const now = new Date("2030-03-20T12:00:00.000Z");
  it.each([
    ["past", "1900-01-01T00:00:00Z"],
    ["already due", "2030-03-20T12:00:00.000Z"],
    ["one millisecond future", "2030-03-20T12:00:00.001Z"],
    ["future cap", "2031-03-20T12:00:00.000Z"],
  ])("returns the requested %s deadline without clamping to now", (_label, raw) => {
    expect(delayScheduleAt(until(raw), now)).toEqual({ ok: true, value: new Date(raw) });
    expect(now.toISOString()).toBe("2030-03-20T12:00:00.000Z");
  });

  it("applies the elapsed future horizon only when called to arm under the supplied clock", () => {
    const config = until("2031-03-20T12:00:00.001Z");
    expect(delayScheduleAt(config, now)).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(delayScheduleAt(config, new Date("2031-03-20T12:00:00.001Z"))).toEqual({
      ok: true,
      value: new Date("2031-03-20T12:00:00.001Z"),
    });
  });

  it("uses the same deadline for equivalent offset wires and retains raw authored text", () => {
    const config = until("2030-03-20T13:34:56.123000000+01:00");
    const before = structuredClone(config);
    expect(delayScheduleAt(config, now)).toEqual({ ok: true, value: new Date(instant) });
    expect(config).toEqual(before);
  });

  it.each([new Date(NaN), new Date(Infinity)])("rejects invalid supplied clocks", (clock) => {
    expect(delayScheduleAt(until(instant), clock)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });

  it.each([1, 60, 525600])("preserves legacy duration scheduling for %i minutes", (minutes) => {
    expect(delayScheduleAt({ minutes: value(minutes) }, now)).toEqual(
      delayResumeAt(value(minutes), now),
    );
  });

  it("preserves legacy mapped-duration not-ready behavior while rejecting mapped-until execution", () => {
    const reference = { kind: "reference", nodeId: "start", path: ["recordId"] };
    expect(delayScheduleAt({ minutes: reference }, now)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_NOT_READY,
    });
    expect(delayScheduleAt({ until: reference }, now)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });

  it.each(unsafeConfigs)("never schedules %s", (_label, config) => {
    expect(delayScheduleAt(config, now)).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
  });
});

it("fences any own until member out of the older failed-task retry profile", () => {
  for (const raw of [
    instant,
    "",
    undefined,
    { kind: "value", literalType: "instant", value: instant },
  ]) {
    const definition = initialDefinition({
      start: "Start",
      read: "Read",
      task: "Task",
      subject: "Follow up",
    });
    const task = definition.nodes.find((node) => node.type === "activity.create");
    if (task === undefined) throw new Error("Missing task fixture");
    const wait: WorkflowNode = {
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait",
      config: until(instant),
    };
    definition.nodes.push(wait);
    definition.edges = definition.edges.map((edge) =>
      edge.to === task.id ? { ...edge, to: wait.id } : edge,
    );
    definition.edges.push({ from: wait.id, to: task.id, port: "next" });
    const unsafe = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === wait.id ? { ...node, config: { until: raw } } : node,
      ),
    };
    expect(retryableTaskDefinition(unsafe)).toBeNull();
  }
  const legacy = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  expect(retryableTaskDefinition(legacy)).toEqual(legacy);
});
