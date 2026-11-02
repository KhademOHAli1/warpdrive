import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect } from "vitest";
import { deals, workflowRuns } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { getWorkflow } from "./queries";
import { admitManualRun } from "./runAdmission";
import type { Binding, WorkflowDefinition } from "./schemas";

export const PUBLIC_CASE_TIMEOUT = 30_000;

export function publicDurationDefinition(
  minutes: number,
  subject: Binding = { kind: "reference", nodeId: "read", path: ["title"] },
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Wait",
        config: {
          minutes: { kind: "value", value: minutes },
        },
      },
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
          subject,
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}

async function seedPublicFixture(h: TestDb, signal: AbortSignal) {
  const user = await seedUser(h.db, { isAdmin: true });
  signal.throwIfAborted();
  const actor = await hydrateActor(h.db, user.id, signal);
  assert(actor !== null, "Missing active fixture actor");
  const pipeline = await seedPipelineWithStages(h.db, ["Proposal"]);
  signal.throwIfAborted();
  const stage = pipeline.stages.at(0);
  assert(stage !== undefined, "Missing fixture stage");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "Original customer",
      ownerId: user.id,
      pipelineId: pipeline.pipeline.id,
      stageId: stage.id,
      visibilityLevel: "owner",
    })
    .returning();
  signal.throwIfAborted();
  assert(deal !== undefined, "Missing fixture deal");
  const created = await createWorkflow(
    h.db,
    actor,
    {
      name: "Public duration workflow",
      definition: publicDurationDefinition(1),
    },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  return { ...h, user, actor, deal, workflow: created.value };
}

export type PublicDurationFixture = Awaited<ReturnType<typeof seedPublicFixture>>;

export async function withPublicDuration(
  body: (test: PublicDurationFixture, signal: AbortSignal) => Promise<void>,
) {
  const signal = AbortSignal.timeout(20_000);
  const h = await makeTestDb();
  try {
    const test = await seedPublicFixture(h, signal);
    await body(test, signal);
  } finally {
    await h.close();
  }
}

export async function publishPublicDuration(
  test: PublicDurationFixture,
  definition: WorkflowDefinition,
  signal: AbortSignal,
) {
  const current = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
  assert(current.ok, JSON.stringify(current));
  const saved = await saveWorkflowDraft(
    test.db,
    test.actor,
    {
      id: test.workflow.id,
      revision: current.value.revision,
      name: current.value.name,
      definition,
    },
    signal,
  );
  assert(saved.ok, JSON.stringify(saved));
  const published = await publishWorkflow(
    test.db,
    test.actor,
    test.workflow.id,
    saved.value.revision,
    signal,
  );
  // Exercise supported public publication without inserting a stored version directly.
  assert(published.ok, `Expected public delay publication: ${JSON.stringify(published)}`);
  return published.value;
}

export function publicAdmissionInput(test: PublicDurationFixture, mode: "live" | "simulation") {
  return {
    workflowId: test.workflow.id,
    requestKey: randomUUID(),
    recordId: test.deal.id,
    mode,
  };
}

export async function admitPublicDuration(
  test: PublicDurationFixture,
  mode: "live" | "simulation",
  signal: AbortSignal,
) {
  const admitted = await admitManualRun(
    test.db,
    test.actor,
    publicAdmissionInput(test, mode),
    signal,
  );
  assert(admitted.ok, JSON.stringify(admitted));
  return admitted.value;
}

export async function readPublicRun(
  test: PublicDurationFixture,
  runId: string,
  signal: AbortSignal,
) {
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  signal.throwIfAborted();
  assert(run !== undefined, "Missing publicly admitted run");
  return run;
}

export async function advancePublicStates(
  test: PublicDurationFixture,
  runId: string,
  states: readonly string[],
  signal: AbortSignal,
) {
  for (const state of states) {
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual({ ok: true, value: state });
  }
}

export async function armPublicDuration(
  test: PublicDurationFixture,
  runId: string,
  signal: AbortSignal,
) {
  await advancePublicStates(test, runId, ["running", "waiting"], signal);
  const run = await readPublicRun(test, runId, signal);
  expect(run.status).toBe("waiting");
  expect(run.nextNodeId).toBe("wait");
  expect(run.resumeAt).toBeInstanceOf(Date);
  return run;
}

export async function makePublicDurationDue(
  test: PublicDurationFixture,
  runId: string,
  signal: AbortSignal,
) {
  // Only move an already publicly admitted/armed deadline; never insert a run or version.
  const result = await test.pool.query(
    "UPDATE workflow_runs SET resume_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND status='waiting'",
    [runId],
  );
  signal.throwIfAborted();
  expect(result.rowCount).toBe(1);
}

export async function finishPublicDuration(
  test: PublicDurationFixture,
  runId: string,
  signal: AbortSignal,
) {
  await makePublicDurationDue(test, runId, signal);
  await advancePublicStates(test, runId, ["running", "running", "succeeded"], signal);
  return readPublicRun(test, runId, signal);
}
