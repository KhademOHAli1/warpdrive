import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { workflowRuns } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { validateNodeConfiguration } from "./configurationValidation";
import { copyWorkflowDefinition } from "./copyDefinition";
import { validateDefinition } from "./definition";
import { delayScheduleAt } from "./delay";
import { maxDelayMilliseconds } from "./delayConfig";
import { applyMappingSelection, describeMappingTarget } from "./mappingCatalog";
import { draftExecutableNode } from "./readiness";
import { retryableTaskDefinition } from "./runRetryProfile";
import { advanceRunStep } from "./runStep";
import type { RunOutputs } from "./runTypes";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

vi.mock("./runActions", () => ({ executeRunNode: vi.fn() }));

const now = new Date("2030-03-20T10:00:00.000Z");
const value = (value: string | number | boolean | null) => ({ kind: "value" as const, value });
const reference = (path: string) => ({ kind: "reference" as const, nodeId: "read", path: [path] });
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID } as const;
const missing = { ok: false, error: ERROR_IDS.WORKFLOW_BINDING_MISSING } as const;

function graph(config: WorkflowNode["config"]) {
  const node: WorkflowNode = { id: "wait", type: "delay", version: 1, name: "Wait", config };
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
      node,
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "wait", port: "next" },
    ],
  };
  return { definition, node, nodeId: node.id };
}

it("combines elapsed day, hour, minute and fractional second settings on the supplied clock", () => {
  const config = {
    delayType: "DURATION",
    duration: { days: value(1), hours: value("2"), minutes: value(3), seconds: value(4.125) },
  };
  expect(delayScheduleAt(config, now)).toEqual({
    ok: true,
    value: new Date("2030-03-21T12:03:04.125Z"),
  });
  expect(delayScheduleAt({ delayType: "DURATION", duration: { seconds: value("") } }, now)).toEqual(
    { ok: true, value: now },
  );
  expect(delayScheduleAt({ delayType: "DURATION" }, now)).toEqual(invalid);
});

it("enforces the aggregate horizon and rejects malformed duration amounts", () => {
  const limit = { delayType: "DURATION", duration: { days: value(365) } };
  expect(delayScheduleAt(limit, now)).toEqual({
    ok: true,
    value: new Date(now.getTime() + maxDelayMilliseconds),
  });
  expect(
    delayScheduleAt({ ...limit, duration: { ...limit.duration, seconds: value(0.001) } }, now),
  ).toEqual(invalid);
  for (const raw of [-1, Number.POSITIVE_INFINITY, "0x2", "  ", "wait", null, false]) {
    expect(
      delayScheduleAt({ delayType: "DURATION", duration: { seconds: value(raw) } }, now),
    ).toEqual(invalid);
  }
});

it("resolves a compatible upstream decimal but refuses missing, invalid or incompatible outputs", () => {
  const config = {
    delayType: "DURATION",
    duration: { minutes: value(1), seconds: reference("value") },
  };
  const context = graph(config);
  expect(validateDefinition(context.definition).ok).toBe(true);
  expect(validateNodeConfiguration(context.node, context)).toMatchObject({
    status: "valid",
    runtimeChecks: [["duration", "seconds"]],
  });
  expect(draftExecutableNode(context.node)).toBe(true);
  expect(
    delayScheduleAt(config, now, { ...context, outputs: { read: { value: "2.25" } } }),
  ).toEqual({
    ok: true,
    value: new Date("2030-03-20T10:01:02.250Z"),
  });
  const missingOutputs: RunOutputs[] = [{ read: {} }, { read: { value: null } }];
  for (const outputs of missingOutputs)
    expect(delayScheduleAt(config, now, { ...context, outputs })).toEqual(missing);
  expect(delayScheduleAt(config, now, { ...context, outputs: { read: { value: 2.25 } } })).toEqual(
    invalid,
  );
  const bad = graph({ ...config, duration: { seconds: reference("status") } });
  expect(validateDefinition(bad.definition)).toMatchObject({
    ok: false,
    error: [{ code: "type_mismatch", nodeId: "wait", path: ["duration", "seconds"] }],
  });
});

it("changes only the selected duration unit when applying a variable", () => {
  const original = { delayType: "DURATION", duration: { minutes: value(1) } };
  const { definition } = graph(original);
  const target = describeMappingTarget(definition, "wait", ["duration", "seconds"]);
  if (target.state !== "ready") throw new Error("Duration unit target is unavailable");
  const selected = applyMappingSelection(
    definition,
    "wait",
    target.target,
    reference("value"),
    undefined,
    true,
  );
  if (!selected.ok) throw new Error("Compatible duration source was rejected");
  expect(selected.changed).toBe(true);
  expect(selected.definition.nodes[2]?.config).toEqual({
    ...original,
    duration: { ...original.duration, seconds: reference("value") },
  });
  expect(definition.nodes[2]?.config).toBe(original);
  expect(
    applyMappingSelection(
      selected.definition,
      "wait",
      target.target,
      reference("value"),
      undefined,
      true,
    ),
  ).toEqual({ ok: true, definition: selected.definition, changed: false });
  expect(
    applyMappingSelection(definition, "wait", target.target, reference("status"), undefined, true)
      .ok,
  ).toBe(false);
  expect(
    applyMappingSelection(definition, "wait", target.target, reference("value"), undefined, false)
      .ok,
  ).toBe(false);
});

it("resolves mapped calendar dates at midnight UTC and validates the deadline at execution", () => {
  const config = { delayType: "SCHEDULED_DATE", scheduledDateTime: reference("expectedCloseDate") };
  const context = graph(config);
  expect(validateDefinition(context.definition).ok).toBe(true);
  expect(draftExecutableNode(context.node)).toBe(true);
  expect(
    delayScheduleAt(config, now, {
      ...context,
      outputs: { read: { expectedCloseDate: "2030-03-21" } },
    }),
  ).toEqual({
    ok: true,
    value: new Date("2030-03-21T00:00:00.000Z"),
  });
  expect(
    delayScheduleAt(config, now, {
      ...context,
      outputs: { read: { expectedCloseDate: "2030-03-20" } },
    }),
  ).toEqual(invalid);
  expect(
    delayScheduleAt(config, now, { ...context, outputs: { read: { expectedCloseDate: null } } }),
  ).toEqual(missing);
});

it("preserves the literal offset, rejects past new dates, and retains the legacy already-due rule", () => {
  const scheduledDateTime = {
    kind: "value",
    literalType: "instant",
    value: "2030-03-20T11:30:00.123+01:00",
  };
  const config = { delayType: "SCHEDULED_DATE", scheduledDateTime };
  const deadline = new Date("2030-03-20T10:30:00.123Z");
  expect(delayScheduleAt(config, now)).toEqual({ ok: true, value: deadline });
  expect(delayScheduleAt(config, new Date(deadline.getTime() + 1))).toEqual(invalid);
  expect(delayScheduleAt({ until: scheduledDateTime }, new Date(deadline.getTime() + 1))).toEqual({
    ok: true,
    value: deadline,
  });
  expect(
    delayScheduleAt(
      { ...config, scheduledDateTime: { ...scheduledDateTime, value: "2030-03-20T11:30:00" } },
      now,
    ),
  ).toEqual(invalid);
  expect(
    delayScheduleAt(
      { ...config, scheduledDateTime: { ...scheduledDateTime, value: "2031-03-21T10:00:00.000Z" } },
      now,
    ),
  ).toEqual(invalid);
});

it("copies incomplete canonical drafts and bounds nested values before JSON parsing", () => {
  const draft = graph({
    delayType: "DURATION",
    duration: { seconds: { kind: "value", literalType: "number", value: "-" } },
  });
  expect(validateDefinition(draft.definition).ok).toBe(false);
  const copied = copyWorkflowDefinition(draft.definition);
  expect(copied).toEqual({ ok: true, value: draft.definition });
  if (copied.ok) expect(copied.value.nodes[2]?.config).not.toBe(draft.node.config);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const corrupt = structuredClone(draft.definition);
  Object.assign(corrupt.nodes[2]!.config, {
    duration: { seconds: { kind: "value", value: cyclic } },
  });
  expect(definitionSchema.safeParse(corrupt).success).toBe(false);
  expect(copyWorkflowDefinition(corrupt).ok).toBe(false);
});

it("leaves the previously qualified retry profile limited to existing wait wires", () => {
  expect(retryableTaskDefinition(graph({ minutes: value(1) }).definition)).not.toBeNull();
  expect(
    retryableTaskDefinition(
      graph({ delayType: "DURATION", duration: { minutes: value(1) } }).definition,
    ),
  ).toBeNull();
});

it("arms once from upstream output and retains the exact deadline across early and due wakes", async () => {
  const config = { delayType: "DURATION", duration: { seconds: reference("value") } };
  const { definition, node } = graph(config);
  const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const db = { update: () => ({ set }) } as unknown as Db;
  const run = {
    id: "e69cb862-813b-49c1-ac1e-289b2aa0b1fa",
    mode: "live",
    status: "running",
    outputs: { read: { value: "5" } },
    resumeAt: null,
  } as typeof workflowRuns.$inferSelect;
  const actor = {} as PermSetUser;
  const signal = new AbortController().signal;
  const deadline = new Date(now.getTime() + 5000);
  expect(await advanceRunStep(db, actor, node, run, now, definition, signal)).toEqual({
    ok: true,
    value: { status: "waiting", armedDeadline: deadline },
  });
  expect(set).toHaveBeenCalledExactlyOnceWith({
    status: "waiting",
    resumeAt: deadline,
    updatedAt: now,
  });

  const waiting = { ...run, status: "waiting" as const, resumeAt: deadline, outputs: {} };
  expect(
    await advanceRunStep(
      db,
      actor,
      node,
      waiting,
      new Date(deadline.getTime() - 1),
      definition,
      signal,
    ),
  ).toEqual({ ok: true, value: { status: "waiting" } });
  expect(await advanceRunStep(db, actor, node, waiting, deadline, definition, signal)).toEqual({
    ok: true,
    value: { status: "completed", output: { resumeAt: deadline.toISOString() } },
  });
  expect(set).toHaveBeenCalledTimes(1);

  const simulation = { ...run, mode: "simulation" as const };
  expect(await advanceRunStep(db, actor, node, simulation, now, definition, signal)).toEqual({
    ok: true,
    value: { status: "completed", output: { resumeAt: deadline.toISOString() } },
  });
  expect(set).toHaveBeenCalledTimes(1);
});
