import { expect, it } from "vitest";
import type { workflowRuns, workflowSteps } from "@/db/schema";
import { initialDefinition } from "./editorModel";
import { coherentFailedTask, retryableTaskDefinition } from "./runRetryProfile";

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
  if (cause === "completedCursor")
    f.steps.push({ ...step, id: crypto.randomUUID(), nodeId: "task" });
  if (cause === "foreignRun") step.runId = crypto.randomUUID();
  if (cause === "invalidTime") step.completedAt = new Date(Number.NaN);
  expect(coherentFailedTask(f.definition, f.run, f.steps)).toBeNull();
});
