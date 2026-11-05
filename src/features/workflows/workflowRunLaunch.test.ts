import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { WorkflowDefinition } from "./schemas";
import { verifyWorkflowRunLaunch } from "./workflowRunLaunch";
import { workflowScheduleRequestKey } from "./workflowScheduleAdmission";

const workflowId = "ba16acb7-ae4f-4e12-a3b3-08b7f6ff8a36";
const ownerId = "34354034-f846-49c3-95d0-4b4c2d8dcd27";
const recordId = "153e3f31-0c67-4e94-8dd0-c426449a0d53";
const scheduledAt = "2026-11-02T09:05:00.000Z";
const publishedAt = new Date("2026-11-02T08:00:00.000Z");

function definition(
  type: "trigger.manual" | "trigger.schedule",
  config: WorkflowDefinition["nodes"][number]["config"],
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [{ id: "start", name: "Start", type, version: 1, config }],
    edges: [],
  };
}

const schedule = definition("trigger.schedule", { interval: "minutes", minutes: 5 });
const launch = { scope: "schedule", scheduledAt };
const run = {
  workflowId,
  actorId: ownerId,
  mode: "live" as const,
  trigger: launch,
  requestKey: workflowScheduleRequestKey({ workflowId, scheduledAt }),
};

it("permits a still-authorized scheduled occurrence on its pinned publication", () => {
  expect(verifyWorkflowRunLaunch(schedule, run, ownerId, publishedAt)).toEqual({
    ok: true,
    value: launch,
  });
});

it("denies a scheduled continuation after owner transfer", () => {
  expect(verifyWorkflowRunLaunch(schedule, run, recordId, publishedAt)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_DENIED,
  });
});

it.each([
  { ...run, mode: "simulation" as const },
  { ...run, requestKey: recordId },
  { ...run, trigger: { ...launch, scheduledAt: "2026-11-02T09:06:00.000Z" } },
  { ...run, trigger: { ...launch, recordId } },
  { ...run, trigger: { scope: "global" } },
])("rejects forged or non-live scheduled context %#", (candidate) => {
  expect(verifyWorkflowRunLaunch(schedule, candidate, ownerId, publishedAt)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});

it("rejects a scheduled payload from before its pinned publication", () => {
  expect(
    verifyWorkflowRunLaunch(schedule, run, ownerId, new Date("2026-11-02T09:05:00.001Z")),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("keeps the existing Deal and Global manual payload boundaries", () => {
  const deal = definition("trigger.manual", {});
  const global = definition("trigger.manual", { scope: "global" });
  expect(
    verifyWorkflowRunLaunch(deal, { ...run, trigger: { recordId } }, recordId, publishedAt),
  ).toEqual({ ok: true, value: { recordId } });
  expect(
    verifyWorkflowRunLaunch(
      global,
      { ...run, trigger: { scope: "global" } },
      recordId,
      publishedAt,
    ),
  ).toEqual({ ok: true, value: { scope: "global" } });
  expect(verifyWorkflowRunLaunch(global, run, ownerId, publishedAt)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});
