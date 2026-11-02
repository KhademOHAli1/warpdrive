import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect } from "vitest";
import { deals, workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { initialBlankDefinition } from "./editorModel";
import { createWorkflow } from "./persistence";

export const RUNTIME_CASE_TIMEOUT = 30_000;
export interface RuntimeVersionSpec {
  schemaVersion: number | string;
  delayNodeVersion: number | string;
  phase: "queued" | "early" | "due";
}
export interface RuntimeVersionCase extends RuntimeVersionSpec {
  label: string;
}

function storedDefinition(schemaVersion: number | string, delayNodeVersion: number | string) {
  return {
    schemaVersion,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "wait",
        type: "delay",
        version: delayNodeVersion,
        name: "Wait",
        config: {
          minutes: { kind: "value", value: 1 },
        },
      },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Task",
        config: {
          subject: { kind: "reference", nodeId: "read", path: ["title"] },
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

async function seedRuntimeVersion(h: TestDb, spec: RuntimeVersionSpec, signal: AbortSignal) {
  // The graph/configuration is valid when only the two version fields are supported.
  expect(validateDefinition(storedDefinition(1, 1)).ok).toBe(true);
  const user = await seedUser(h.db, { isAdmin: true });
  signal.throwIfAborted();
  const actor = await hydrateActor(h.db, user.id, signal);
  assert(actor !== null, "Missing active runtime-version fixture actor");
  const pipeline = await seedPipelineWithStages(h.db, ["Proposal"]);
  signal.throwIfAborted();
  const stage = pipeline.stages.at(0);
  assert(stage !== undefined, "Missing fixture stage");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "Runtime-version customer",
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
      name: "Pre-existing runtime-version fixture",
      definition: initialBlankDefinition("Start"),
    },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  const versionId = randomUUID();
  const runId = randomUUID();
  const trigger = { recordId: deal.id };
  // Deliberately model opaque pre-existing storage, not a public publication/admission bypass.
  await h.pool.query(
    `INSERT INTO workflow_versions
    (id,workflow_id,number,name,definition,published_by)
    VALUES($1,$2,1,'Runtime version fixture',$3::jsonb,$4)`,
    [
      versionId,
      created.value.id,
      JSON.stringify(storedDefinition(spec.schemaVersion, spec.delayNodeVersion)),
      user.id,
    ],
  );
  signal.throwIfAborted();
  const [workflow] = await h.db
    .update(workflows)
    .set({ publishedNumber: 1, active: true })
    .where(eq(workflows.id, created.value.id))
    .returning();
  signal.throwIfAborted();
  assert(workflow !== undefined, "Missing fixture workflow pointer");
  // A queued recovery cursor and both armed states already completed their manual trigger.
  await h.pool.query(
    `WITH timing AS (
      SELECT CASE $7::text
        WHEN 'early' THEN clock_timestamp()+interval '1 minute'
        WHEN 'due' THEN clock_timestamp()-interval '1 second'
        ELSE NULL::timestamptz END AS deadline
    ) INSERT INTO workflow_runs
      (id,workflow_id,version_id,actor_id,request_key,mode,status,trigger,
       next_node_id,resume_at,outputs,created_at,updated_at)
    SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'live',
      CASE WHEN $7::text='queued' THEN 'queued' ELSE 'waiting' END,$6::jsonb,
      'wait',deadline,$8::jsonb,clock_timestamp()-interval '5 minutes',
      coalesce(deadline-interval '1 minute',clock_timestamp()-interval '1 minute')
    FROM timing`,
    [
      runId,
      workflow.id,
      versionId,
      actor.id,
      randomUUID(),
      JSON.stringify(trigger),
      spec.phase,
      JSON.stringify({ start: trigger }),
    ],
  );
  signal.throwIfAborted();
  await h.pool.query(
    `INSERT INTO workflow_steps(run_id,node_id,simulated,output,completed_at)
    VALUES($1,'start',false,$2::jsonb,clock_timestamp()-interval '2 minutes')`,
    [runId, JSON.stringify(trigger)],
  );
  signal.throwIfAborted();
  // ORM literal types do not validate the stored numeric/string version values.
  const [version] = await h.db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId));
  const [run] = await h.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  signal.throwIfAborted();
  assert(version !== undefined && run !== undefined, "Missing stored fixture rows");
  const node = version.definition.nodes.find((item) => item.id === "wait");
  assert(node !== undefined, "Missing fixture wait node");
  expect(version.definition.schemaVersion).toBe(spec.schemaVersion);
  expect(node.version).toBe(spec.delayNodeVersion);
  expect(workflow).toMatchObject({ ownerId: actor.id, archivedAt: null, active: true });
  expect(actor.isActive).toBe(true);
  expect(canWorkflow(actor, "run", workflow.ownerId)).toBe(true);
  expect(run).toMatchObject({
    status: spec.phase === "queued" ? "queued" : "waiting",
    nextNodeId: "wait",
    versionId: version.id,
    actorId: actor.id,
  });
  const timing = await h.pool.query<{ early: boolean | null; due: boolean | null }>(
    "SELECT resume_at>clock_timestamp() AS early,resume_at<=clock_timestamp() AS due FROM workflow_runs WHERE id=$1",
    [run.id],
  );
  signal.throwIfAborted();
  if (spec.phase === "queued") expect(run.resumeAt).toBeNull();
  if (spec.phase === "early") expect(timing.rows[0]?.early).toBe(true);
  if (spec.phase === "due") expect(timing.rows[0]?.due).toBe(true);
  return { ...h, actor, deal, workflow, version, run };
}

export type RuntimeVersionFixture = Awaited<ReturnType<typeof seedRuntimeVersion>>;

export async function withRuntimeVersion(
  spec: RuntimeVersionSpec,
  body: (test: RuntimeVersionFixture, signal: AbortSignal) => Promise<void>,
) {
  const signal = AbortSignal.timeout(20_000);
  const h = await makeTestDb();
  try {
    const test = await seedRuntimeVersion(h, spec, signal);
    await body(test, signal);
  } finally {
    await h.close();
  }
}

export async function runtimeRun(test: RuntimeVersionFixture, signal: AbortSignal) {
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, test.run.id));
  signal.throwIfAborted();
  assert(run !== undefined, "Missing persisted runtime-version run");
  return run;
}

export async function runtimeSteps(test: RuntimeVersionFixture, signal: AbortSignal) {
  const rows = await test.db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, test.run.id))
    .orderBy(workflowSteps.id);
  signal.throwIfAborted();
  return rows;
}
