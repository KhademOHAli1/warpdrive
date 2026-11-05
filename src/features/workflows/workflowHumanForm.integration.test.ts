import { eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, workflowRunFailures, workflowRuns, workflowSteps } from "@/db/schema";
import { err, ok } from "@/types/result";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow } from "./persistence";
import { readRunDetail } from "./runDetail";
import { type RetryFixture, setupRetryActor, storedRetryRun } from "./runRetry.test-helpers";
import type { WorkflowDefinition } from "./schemas";
import { submitWorkflowHumanForm } from "./workflowHumanFormSubmit";

const signal = new AbortController().signal;
const fieldId = "a7dd6e4e-9071-4974-ab42-c00dd8d7db50";
const response = "Synthetic response used as a task subject";
const fields = [{ id: fieldId, label: "Task subject", type: "text", required: true }];
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
    {
      id: "form",
      type: "human.form",
      version: 1,
      name: "Collect task subject",
      config: { fields },
    },
    {
      id: "task",
      type: "activity.create",
      version: 1,
      name: "Create follow-up task",
      config: {
        subject: { kind: "reference", nodeId: "form", path: ["answers", fieldId] },
        dealId: { kind: "reference", nodeId: "start", path: ["recordId"] },
      },
    },
  ],
  edges: [
    { from: "start", to: "form", port: "next" },
    { from: "form", to: "task", port: "next" },
  ],
};

async function armPublishedForm(test: RetryFixture) {
  const workflow = await createWorkflow(
    test.db,
    test.actor,
    { name: "Task request form", definition },
    signal,
  );
  assert(workflow.ok, JSON.stringify(workflow));
  const version = await publishWorkflow(
    test.db,
    test.actor,
    workflow.value.id,
    workflow.value.revision,
    signal,
  );
  assert(version.ok, JSON.stringify(version));
  const admission = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: workflow.value.id,
      reviewedVersionId: version.value.id,
      recordId: test.deal.id,
      requestKey: crypto.randomUUID(),
      mode: "live",
    },
    signal,
  );
  assert(admission.ok, JSON.stringify(admission));
  const runId = admission.value.id;
  expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("running"));
  expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("waiting"));
  const waiting = await storedRetryRun(test, runId);
  expect(waiting).toMatchObject({
    versionId: version.value.id,
    status: "waiting",
    nextNodeId: "form",
    resumeAt: expect.any(Date),
  });
  const deadline = waiting.resumeAt;
  assert(deadline !== null);
  expect(deadline.getTime()).toBeGreaterThan(waiting.updatedAt.getTime());
  expect(waiting.outputs).toEqual({ start: { recordId: test.deal.id } });
  return {
    deadline,
    input: {
      workflowId: workflow.value.id,
      runId,
      nodeId: "form",
      requestKey: crypto.randomUUID(),
      answers: { [fieldId]: response },
    },
  };
}

it("commits one Form receipt for competing submissions and maps the answer to a native task", async () => {
  const test = await setupRetryActor();
  try {
    const { deadline, input } = await armPublishedForm(test);
    expect(await advanceWorkflowRun(test.db, input.runId, signal)).toEqual(ok("waiting"));
    const pending = await readRunDetail(test.db, test.actor, input.workflowId, input.runId, signal);
    assert(pending.ok, JSON.stringify(pending));
    expect(pending.value.pendingForm).toMatchObject({ nodeId: "form", deadline, fields });
    expect(pending.value.steps.map((step) => step.nodeId)).toEqual(["start"]);

    const submitted = await Promise.all([
      submitWorkflowHumanForm(test.db, test.who, input, signal),
      submitWorkflowHumanForm(test.db, test.who, input, signal),
    ]);
    expect(submitted).toEqual(
      expect.arrayContaining([
        ok({ id: input.runId, replayed: false }),
        ok({ id: input.runId, replayed: true }),
      ]),
    );
    expect(
      await submitWorkflowHumanForm(
        test.db,
        test.who,
        { ...input, answers: { [fieldId]: "Different synthetic response" } },
        signal,
      ),
    ).toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
    const advanced = await storedRetryRun(test, input.runId);
    const mappingOutput = { [`answers.${fieldId}`]: response };
    expect(advanced).toMatchObject({ status: "running", nextNodeId: "task", resumeAt: null });
    expect(advanced.outputs.form).toEqual(mappingOutput);
    const steps = await test.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, input.runId));
    expect(steps.filter((step) => step.nodeId === "form")).toEqual([
      expect.objectContaining({
        simulated: false,
        output: { ...mappingOutput, _formSubmission: { requestKey: input.requestKey } },
      }),
    ]);

    expect(await advanceWorkflowRun(test.db, input.runId, signal)).toEqual(ok("succeeded"));
    const tasks = await test.db.select().from(activities);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      subject: response,
      dealId: test.deal.id,
      ownerId: test.user.id,
    });
    const complete = await readRunDetail(
      test.db,
      test.actor,
      input.workflowId,
      input.runId,
      signal,
    );
    assert(complete.ok, JSON.stringify(complete));
    expect(complete.value).toMatchObject({ status: "succeeded", resumeAt: null, nextNodeId: null });
    expect(complete.value).not.toHaveProperty("pendingForm");
    const completedForm = complete.value.steps.find((step) => step.nodeId === "form");
    expect(completedForm).toMatchObject({ nodeId: "form", simulated: false });
    expect(completedForm).not.toHaveProperty("output");
    expect(JSON.stringify(complete.value)).not.toContain(response);
    expect(JSON.stringify(complete.value)).not.toContain(input.requestKey);
  } finally {
    await test.close();
  }
});

it("rejects late answers and records a Form expiry without a receipt or downstream task", async () => {
  const test = await setupRetryActor();
  try {
    const { input } = await armPublishedForm(test);
    const [expired] = await test.db
      .update(workflowRuns)
      .set({ resumeAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(workflowRuns.id, input.runId))
      .returning({ deadline: workflowRuns.resumeAt });
    assert(expired !== undefined && expired.deadline !== null);
    expect(await submitWorkflowHumanForm(test.db, test.who, input, signal)).toEqual(
      err(ERROR_IDS.WORKFLOW_CONFLICT),
    );
    expect(await advanceWorkflowRun(test.db, input.runId, signal)).toEqual(ok("failed"));
    expect(await storedRetryRun(test, input.runId)).toMatchObject({
      status: "failed",
      errorId: ERROR_IDS.WORKFLOW_FORM_EXPIRED,
      resumeAt: null,
      outputs: { start: { recordId: test.deal.id } },
    });
    const failures = await test.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, input.runId));
    expect(failures).toEqual([
      expect.objectContaining({
        nodeId: "form",
        errorId: ERROR_IDS.WORKFLOW_FORM_EXPIRED,
        originalResumeAt: expired.deadline,
      }),
    ]);
    const steps = await test.db
      .select({ nodeId: workflowSteps.nodeId })
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, input.runId));
    expect(steps).toEqual([{ nodeId: "start" }]);
    expect(await test.db.select().from(activities)).toEqual([]);
  } finally {
    await test.close();
  }
});
