import { expect, it } from "vitest";
import type { workflowRuns, workflowSteps } from "@/db/schema";
import { initialDefinition } from "./editorModel";
import { coherentFailedTask, retryableTaskDefinition } from "./runRetryProfile";
import type { WorkflowNode } from "./schemas";

function fixture() {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  const runId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const outputs = { start: { recordId }, read: { id: recordId } };
  const now = new Date("2026-01-01T12:00:00Z");
  const run: typeof workflowRuns.$inferSelect = {
    id: runId,
    workflowId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    actorId: crypto.randomUUID(),
    requestKey: crypto.randomUUID(),
    mode: "live",
    status: "failed",
    trigger: { recordId },
    nextNodeId: "task",
    iteratorFrame: null,
    resumeAt: null,
    outputs,
    errorId: "E_PERM_001",
    cancelledBy: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const steps: (typeof workflowSteps.$inferSelect)[] = Object.entries(outputs).map(
    ([nodeId, output]) => ({
      id: crypto.randomUUID(),
      runId,
      nodeId,
      iterationIndex: -1,
      outcome: "succeeded",
      errorId: null,
      output,
      simulated: false,
      completedAt: now,
    }),
  );
  return { definition, run, steps };
}

it("accepts only the pinned local-task profile and its exact completed prefix", () => {
  const f = fixture();
  expect(retryableTaskDefinition(f.definition)).toEqual(f.definition);
  expect(coherentFailedTask(f.definition, f.run, f.steps)?.id).toBe("task");
});

it.each(["unlinked", "cachedSubject", "foreignRead", "unsupportedVersion", "malformed"] as const)(
  "rejects the %s graph",
  (cause) => {
    const f = fixture();
    const task = f.definition.nodes.find((node) => node.id === "task");
    const read = f.definition.nodes.find((node) => node.id === "read");
    if (task === undefined || read === undefined) throw new Error("Missing fixture nodes");
    if (cause === "unlinked") task.config.dealId = { kind: "value", value: crypto.randomUUID() };
    if (cause === "cachedSubject")
      task.config.subject = { kind: "reference", nodeId: "read", path: ["title"] };
    if (cause === "foreignRead")
      read.config.recordId = { kind: "value", value: crypto.randomUUID() };
    const raw: unknown =
      cause === "malformed"
        ? { nodes: [] }
        : cause === "unsupportedVersion"
          ? { ...f.definition, schemaVersion: 2 }
          : f.definition;
    expect(retryableTaskDefinition(raw)).toBeNull();
  },
);

it.each([
  "missing",
  "changedOutput",
  "duplicate",
  "extraOutput",
  "simulated",
  "scopedReceipt",
  "failedReceipt",
  "completedCursor",
  "foreignRun",
  "invalidTime",
] as const)("rejects %s completed progress without repairing it", (cause) => {
  const f = fixture();
  const step = f.steps[0];
  if (step === undefined) throw new Error("Missing fixture step");
  if (cause === "missing") f.steps.pop();
  if (cause === "changedOutput") step.output = { recordId: crypto.randomUUID() };
  if (cause === "duplicate") f.steps.push({ ...step, id: crypto.randomUUID() });
  if (cause === "extraOutput") f.run.outputs.unrecorded = { id: crypto.randomUUID() };
  if (cause === "simulated") step.simulated = true;
  if (cause === "scopedReceipt") step.iterationIndex = 0;
  if (cause === "failedReceipt") {
    step.outcome = "failed";
    step.errorId = "E_PERM_001";
  }
  if (cause === "completedCursor")
    f.steps.push({ ...step, id: crypto.randomUUID(), nodeId: "task" });
  if (cause === "foreignRun") step.runId = crypto.randomUUID();
  if (cause === "invalidTime") step.completedAt = new Date(Number.NaN);
  expect(coherentFailedTask(f.definition, f.run, f.steps)).toBeNull();
});

const customRetrySettings: WorkflowNode["config"][] = [
  {},
  { "848408c6-faf7-4234-8de1-c63f1c9107dc": { kind: "value", value: 0 } },
];
it.each(customRetrySettings)(
  "keeps custom-bearing task graphs outside the existing retry profile",
  (customFields) => {
    const f = fixture();
    const task = f.definition.nodes.find((node) => node.type === "activity.create");
    if (task === undefined) throw new Error("Missing task fixture");
    task.config.customFields = customFields;
    const before = structuredClone(f.definition);
    expect(retryableTaskDefinition(f.definition)).toBeNull();
    expect(f.definition).toEqual(before);
  },
);

it("keeps fixed-instant waits out of the legacy failed-task retry profile", () => {
  const f = fixture();
  f.definition.nodes.push({
    id: "fixed_wait",
    type: "delay",
    version: 1,
    name: "Fixed wait",
    nameMode: "automatic",
    config: {
      until: {
        kind: "value",
        literalType: "instant",
        value: "2030-03-20T12:00:00.000Z",
      },
    },
  });
  f.definition.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "fixed_wait", port: "next" },
    { from: "fixed_wait", to: "task", port: "next" },
  ];

  // Published execution supports this validated node, but retry has no qualified
  // path for its fixed deadline and must not reinterpret it as minutes.
  expect(retryableTaskDefinition(f.definition)).toBeNull();
});
