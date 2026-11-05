import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { workflowRuns, workflowSteps } from "@/db/schema";
import { initialDefinition } from "./editorModel";
import { coherentFailedTask, retryableTaskDefinition } from "./runRetryProfile";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type Run = typeof workflowRuns.$inferSelect;
type Step = typeof workflowSteps.$inferSelect;

function requiredNode(definition: WorkflowDefinition, id: string): WorkflowNode {
  const node = definition.nodes.find((item) => item.id === id);
  if (node === undefined) throw new Error("Missing retry-profile fixture node");
  return node;
}

function fixture(priorTask = false, cursor: "read" | "task" = "read") {
  const definition = initialDefinition({
    start: "Start",
    read: "Read the trigger deal",
    task: "Literal follow-up",
    subject: "Follow up after the recovered read",
  });
  if (priorTask) {
    const earlier = structuredClone(requiredNode(definition, "task"));
    earlier.id = "earlier_task";
    earlier.name = "Already completed task";
    earlier.config = {
      subject: { kind: "value", value: "Keep this completed task" },
      dealId: { kind: "reference", nodeId: "start", path: ["recordId"] },
    };
    definition.nodes.push(earlier);
    definition.edges = [
      { from: "start", to: "earlier_task", port: "next" },
      { from: "earlier_task", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ];
  }
  const recordId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const now = new Date("2026-11-05T08:00:00.000Z");
  const outputs: RunOutputs = { start: { recordId } };
  if (priorTask) outputs.earlier_task = { id: crypto.randomUUID() };
  if (cursor === "task") outputs.read = { id: recordId };
  const run: Run & { trigger: { recordId: string } } = {
    id: runId,
    workflowId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    actorId: crypto.randomUUID(),
    requestKey: crypto.randomUUID(),
    mode: "live",
    status: "failed",
    trigger: { recordId },
    nextNodeId: cursor,
    iteratorFrame: null,
    resumeAt: null,
    outputs,
    errorId: ERROR_IDS.DEAL_NOT_FOUND,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const steps: Step[] = Object.entries(outputs).map(([nodeId, output]) => ({
    id: crypto.randomUUID(),
    runId,
    nodeId,
    iterationIndex: -1,
    outcome: "succeeded",
    errorId: null,
    output: structuredClone(output),
    simulated: false,
    completedAt: now,
  }));
  return { definition, run, steps };
}

function qualifiedCursor(f: ReturnType<typeof fixture>) {
  // Positive cursor regressions must reach the real task-only gate on main,
  // rather than fail because their graph was never in the qualified profile.
  expect(retryableTaskDefinition(f.definition)).toEqual(f.definition);
  const before = JSON.stringify(f);
  const completedInstants = f.steps.map((step) => step.completedAt.getTime());
  const cursor = coherentFailedTask(f.definition, f.run, f.steps);
  expect(JSON.stringify(f)).toBe(before);
  expect(f.steps.map((step) => step.completedAt.getTime())).toEqual(completedInstants);
  return cursor;
}

it.each([false, true])(
  "admits the failed trigger-deal read before a literal task with priorTask=%s",
  (priorTask) => {
    const f = fixture(priorTask);
    expect(qualifiedCursor(f)).toEqual(requiredNode(f.definition, "read"));
  },
);

it.each([false, true])(
  "retains the qualified failed-task control with priorTask=%s",
  (priorTask) => {
    const f = fixture(priorTask, "task");
    expect(qualifiedCursor(f)).toEqual(requiredNode(f.definition, "task"));
  },
);

it.each([
  "missingStart",
  "changedOutput",
  "duplicate",
  "extraOutput",
  "simulated",
  "foreignRun",
  "invalidTime",
  "wrongTrigger",
  "missingEarlierTask",
  "invalidEarlierTaskId",
] as const)("refuses %s in the completed prefix of a failed read", (cause) => {
  const f = fixture(true);
  const start = f.steps.find((step) => step.nodeId === "start");
  const earlier = f.steps.find((step) => step.nodeId === "earlier_task");
  if (start === undefined || earlier === undefined) throw new Error("Missing completed fixture");
  if (cause === "missingStart") f.steps = f.steps.filter((step) => step.nodeId !== "start");
  if (cause === "changedOutput") start.output = { recordId: crypto.randomUUID() };
  if (cause === "duplicate") f.steps.push({ ...start, id: crypto.randomUUID() });
  if (cause === "extraOutput") f.run.outputs.unrecorded = { id: crypto.randomUUID() };
  if (cause === "simulated") start.simulated = true;
  if (cause === "foreignRun") start.runId = crypto.randomUUID();
  if (cause === "invalidTime") start.completedAt = new Date(Number.NaN);
  if (cause === "wrongTrigger") f.run.trigger.recordId = crypto.randomUUID();
  if (cause === "missingEarlierTask")
    f.steps = f.steps.filter((step) => step.nodeId !== "earlier_task");
  if (cause === "invalidEarlierTaskId") {
    earlier.output = { id: "not-a-completed-activity-uuid" };
    f.run.outputs.earlier_task = structuredClone(earlier.output);
  }
  expect(qualifiedCursor(f)).toBeNull();
});

it("refuses a cursor outside the pinned graph", () => {
  const f = fixture();
  f.run.nextNodeId = "not_in_the_published_graph";
  expect(qualifiedCursor(f)).toBeNull();
});

it.each([false, true])("refuses an already completed read with priorTask=%s", (priorTask) => {
  const f = fixture(priorTask);
  const output = { id: f.run.trigger.recordId };
  f.run.outputs.read = output;
  f.steps.push({
    id: crypto.randomUUID(),
    runId: f.run.id,
    nodeId: "read",
    iterationIndex: -1,
    outcome: "succeeded",
    errorId: null,
    simulated: false,
    output: structuredClone(output),
    completedAt: f.run.updatedAt,
  });
  expect(qualifiedCursor(f)).toBeNull();
});

it.each(["record.read", "delay"] as const)(
  "refuses a failed read whose immediate successor is %s",
  (type) => {
    const f = fixture();
    f.definition.nodes.push({
      id: "between_read_and_task",
      type,
      version: 1,
      name: "Unsupported read continuation",
      config:
        type === "record.read"
          ? {
              entity: "deal",
              recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
            }
          : { minutes: { kind: "value", value: 1 } },
    });
    f.definition.edges = [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "between_read_and_task", port: "next" },
      { from: "between_read_and_task", to: "task", port: "next" },
    ];
    expect(qualifiedCursor(f)).toBeNull();
  },
);

it("keeps a terminal pure-read graph outside failed-read recovery", () => {
  const f = fixture();
  f.definition.nodes = f.definition.nodes.filter((node) => node.id !== "task");
  f.definition.edges = [{ from: "start", to: "read", port: "next" }];
  expect(qualifiedCursor(f)).toBeNull();
});

it.each(["literalRecord", "mappedSubject", "unlinkedTask", "customTask"] as const)(
  "keeps the %s graph outside the qualified retry profile",
  (cause) => {
    const f = fixture();
    const read = requiredNode(f.definition, "read");
    const task = requiredNode(f.definition, "task");
    if (cause === "literalRecord")
      read.config.recordId = { kind: "value", value: f.run.trigger.recordId };
    if (cause === "mappedSubject")
      task.config.subject = { kind: "reference", nodeId: "read", path: ["title"] };
    if (cause === "unlinkedTask")
      task.config.dealId = { kind: "value", value: crypto.randomUUID() };
    if (cause === "customTask") task.config.customFields = {};
    const before = structuredClone(f);
    expect(retryableTaskDefinition(f.definition)).toBeNull();
    expect(f).toEqual(before);
  },
);
