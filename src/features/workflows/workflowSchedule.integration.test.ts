import { eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import { err, ok } from "@/types/result";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow } from "./persistence";
import { readRunDetail } from "./runDetail";
import { type RetryFixture, setupRetryActor, storedRetryRun } from "./runRetry.test-helpers";
import type { WorkflowDefinition } from "./schemas";
import { submitWorkflowHumanForm } from "./workflowHumanFormSubmit";
import {
  admitScheduledWorkflowOccurrence,
  type InsertScheduledWorkflowRun,
} from "./workflowScheduleAdmission";
import { workflowScheduleMinute } from "./workflowScheduleContract";

const fieldId = "a7dd6e4e-9071-4974-ab42-c00dd8d7db50";
const privateAnswer = "SCHEDULE_FORM_PRIVATE_NATIVE_ANSWER";

const insertRun: InsertScheduledWorkflowRun = async (tx, input) =>
  (await tx.insert(workflowRuns).values(input).returning({ id: workflowRuns.id }))[0];

function scheduledForm(dealId: string, label: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.schedule",
        version: 1,
        name: "Every minute",
        config: { interval: "minutes", minutes: 1 },
      },
      {
        id: "form",
        type: "human.form",
        version: 1,
        name: "Collect a task subject",
        config: { fields: [{ id: fieldId, label, type: "text", required: true }] },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Create follow-up task",
        config: {
          subject: { kind: "reference", nodeId: "form", path: ["answers", fieldId] },
          dealId: { kind: "value", value: dealId },
        },
      },
    ],
    edges: [
      { from: "start", to: "form", port: "next" },
      { from: "form", to: "task", port: "next" },
    ],
  };
}

async function seedPublication(
  test: RetryFixture,
  workflowId: string,
  number: number,
  definition: WorkflowDefinition,
) {
  // Seed an already-existing immutable publication. Clock eligibility is
  // independent of whether this fixture begins just before a minute boundary.
  const [version] = await test.db
    .insert(workflowVersions)
    .values({
      workflowId,
      number,
      definition,
      name: "Scheduled Form fixture",
      publishedBy: test.user.id,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    .returning();
  assert(version !== undefined);
  await test.db
    .update(workflows)
    .set({ publishedNumber: number, active: true })
    .where(eq(workflows.id, workflowId));
  return version;
}

async function databaseMinute(test: RetryFixture) {
  const clock = await test.db.execute<{ milliseconds: number }>(
    sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
  );
  const minute = workflowScheduleMinute(clock.rows[0]?.milliseconds ?? Number.NaN);
  assert(minute !== null);
  return minute;
}

async function admitDue(
  test: RetryFixture,
  workflowId: string,
  versionId: string,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const scheduledAt = await databaseMinute(test);
    const occurrence = { workflowId, versionId, scheduledAt };
    const admitted = await admitScheduledWorkflowOccurrence(test.db, occurrence, insertRun, signal);
    if (admitted.ok) return { runId: admitted.value, occurrence };
    // Only a fresh cut that became stale at the DB clock fence can be retried.
    assert(
      admitted.error === ERROR_IDS.WORKFLOW_NOT_READY &&
        (await databaseMinute(test)) !== scheduledAt,
      JSON.stringify(admitted),
    );
  }
  throw new Error("The test crossed three distinct schedule minute boundaries");
}

it("admits a scheduled Form once, runs its pinned publication, and requires the owner's session", async () => {
  const test = await setupRetryActor();
  const signal = AbortSignal.timeout(10_000);
  try {
    const originalLabel = "Original subject label";
    const definition = scheduledForm(test.deal.id, originalLabel);
    const workflow = await createWorkflow(
      test.db,
      test.actor,
      { name: "Scheduled Form fixture", definition },
      signal,
    );
    assert(workflow.ok, JSON.stringify(workflow));
    const workflowId = workflow.value.id;
    const oldVersion = await seedPublication(test, workflowId, 1, definition);
    expect(
      await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId,
          requestKey: crypto.randomUUID(),
          mode: "live",
        },
        signal,
      ),
    ).toEqual(err(ERROR_IDS.WORKFLOW_NOT_READY));
    const { runId, occurrence } = await admitDue(test, workflowId, oldVersion.id, signal);
    expect(await admitScheduledWorkflowOccurrence(test.db, occurrence, insertRun, signal)).toEqual(
      ok(runId),
    );

    const nextVersion = await seedPublication(
      test,
      workflowId,
      2,
      scheduledForm(test.deal.id, "New subject label"),
    );
    expect(
      await admitScheduledWorkflowOccurrence(
        test.db,
        { ...occurrence, versionId: nextVersion.id },
        insertRun,
        signal,
      ),
    ).toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("running"));
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("waiting"));
    const waiting = await storedRetryRun(test, runId);
    expect(waiting).toMatchObject({
      versionId: oldVersion.id,
      actorId: test.user.id,
      outputs: { start: {} },
      status: "waiting",
    });
    const pending = await readRunDetail(test.db, test.actor, workflowId, runId, signal);
    assert(pending.ok, JSON.stringify(pending));
    expect(pending.value.pendingForm).toMatchObject({
      nodeId: "form",
      fields: [{ label: originalLabel }],
    });

    const input = {
      workflowId,
      runId,
      nodeId: "form",
      requestKey: crypto.randomUUID(),
      answers: { [fieldId]: privateAnswer },
    };
    expect(
      await submitWorkflowHumanForm(
        test.db,
        { ...test.who, sessionId: crypto.randomUUID() },
        input,
        signal,
      ),
    ).toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
    expect(await submitWorkflowHumanForm(test.db, test.who, input, signal)).toEqual(
      ok({ id: runId, replayed: false }),
    );
    expect(await submitWorkflowHumanForm(test.db, test.who, input, signal)).toEqual(
      ok({ id: runId, replayed: true }),
    );
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("succeeded"));
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("succeeded"));
    expect(await test.db.select().from(activities)).toEqual([
      expect.objectContaining({ subject: privateAnswer, ownerId: test.user.id }),
    ]);
    const steps = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, runId));
    expect(steps.map((step) => step.nodeId).sort()).toEqual(["form", "start", "task"]);
    const detail = await readRunDetail(test.db, test.actor, workflowId, runId, signal);
    assert(detail.ok, JSON.stringify(detail));
    expect(detail.value).not.toHaveProperty("pendingForm");
    expect(JSON.stringify(detail.value)).not.toContain(privateAnswer);
  } finally {
    await test.close();
  }
});
