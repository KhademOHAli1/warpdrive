import { and, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { deals, permissionSets, workflowRuns, workflowSteps } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";
const privateId = "10000000-0000-4000-8000-000000000003";
const archivedPipelineId = "10000000-0000-4000-8000-000000000004";
const deletedId = "10000000-0000-4000-8000-000000000005";
const signal = new AbortController().signal;

const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", name: "Start", type: "trigger.manual", version: 1, config: {} },
    {
      id: "search",
      name: "Search Records",
      type: "record.search",
      version: 1,
      config: {
        entity: "deal",
        filter: {
          kind: "group",
          id: "10000000-0000-4000-8000-000000000006",
          combinator: "and",
          entries: [
            {
              kind: "condition",
              id: "10000000-0000-4000-8000-000000000007",
              field: "title",
              operator: "startsWith",
              value: { kind: "value", value: "Rotation " },
            },
          ],
        },
        orderBy: [{ field: "title", direction: "desc" }],
        limit: { kind: "value", value: 1 },
      },
    },
    {
      id: "pick",
      name: "Pick Record",
      type: "record.pick",
      version: 1,
      config: {
        entity: "deal",
        strategy: "ROUND_ROBIN",
        recordIds: [secondId, privateId, archivedPipelineId, deletedId, firstId],
      },
    },
  ],
  edges: [
    { from: "start", to: "search", port: "next" },
    { from: "search", to: "pick", port: "next" },
  ],
};

async function seed(test: TestDb) {
  const [permissions] = await test.db
    .insert(permissionSets)
    .values({
      name: "Lookup workflow author",
      flags: {
        "workflow.create": true,
        "workflow.edit": true,
        "workflow.publish": true,
        "workflow.run": true,
      },
    })
    .returning();
  assert(permissions !== undefined);
  const operator = await seedUser(test.db, { permissionSetId: permissions.id });
  const otherOwner = await seedUser(test.db);
  const actor = await hydrateActor(test.db, operator.id, signal);
  assert(actor !== null && actor.type === "regular");
  const active = await seedPipelineWithStages(test.db, ["Open"]);
  const archived = await seedPipelineWithStages(test.db, ["Archived"], { isArchived: true });
  const stage = active.stages[0];
  const archivedStage = archived.stages[0];
  assert(stage !== undefined && archivedStage !== undefined);
  const ownDeal = {
    ownerId: operator.id,
    pipelineId: active.pipeline.id,
    stageId: stage.id,
    visibilityLevel: "owner" as const,
  };
  await test.db.insert(deals).values([
    { ...ownDeal, id: firstId, title: "Rotation 01" },
    { ...ownDeal, id: secondId, title: "Rotation 02" },
    { ...ownDeal, id: privateId, title: "Rotation 99", ownerId: otherOwner.id },
    {
      ...ownDeal,
      id: archivedPipelineId,
      title: "Rotation 98",
      pipelineId: archived.pipeline.id,
      stageId: archivedStage.id,
    },
    { ...ownDeal, id: deletedId, title: "Rotation 97", deletedAt: new Date() },
    { ...ownDeal, title: "Unrelated visible record" },
  ]);
  const created = await createWorkflow(
    test.db,
    actor,
    { name: "Record rotation", definition },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  const published = await publishWorkflow(test.db, actor, created.value.id, 1, signal);
  assert(published.ok, JSON.stringify(published));
  return { actor, workflowId: created.value.id };
}

async function atPick(
  test: TestDb,
  { actor, workflowId }: Awaited<ReturnType<typeof seed>>,
  mode: "live" | "simulation",
) {
  const admitted = await admitManualRun(
    test.db,
    actor,
    { workflowId, requestKey: crypto.randomUUID(), recordId: firstId, mode },
    signal,
  );
  assert(admitted.ok, JSON.stringify(admitted));
  const { id } = admitted.value;
  expect(await advanceWorkflowRun(test.db, id, signal)).toEqual({ ok: true, value: "running" });
  expect(await advanceWorkflowRun(test.db, id, signal)).toEqual({ ok: true, value: "running" });
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  expect(run).toMatchObject({
    nextNodeId: "pick",
    outputs: {
      search: {
        first: { id: secondId, title: "Rotation 02" },
        firstId: secondId,
        all: [{ id: secondId, title: "Rotation 02" }],
        totalCount: 2,
      },
    },
  });
  return id;
}

async function pickReceipt(test: TestDb, runId: string) {
  const steps = await test.db
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.runId, runId), eq(workflowSteps.nodeId, "pick")));
  expect(steps).toHaveLength(1);
  const receipt = steps[0];
  assert(receipt !== undefined);
  return receipt;
}

async function compete(test: TestDb, workflowId: string, runIds: readonly [string, string]) {
  const holder = await test.pool.connect();
  const cancel = new AbortController();
  const pending: ReturnType<typeof advanceWorkflowRun>[] = [];
  try {
    await holder.query("BEGIN");
    const session = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = session.rows[0]?.pid;
    assert(pid !== undefined);
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `workflow-pick:${workflowId}:pick:record.pick:1:deal:ROUND_ROBIN`,
    ]);
    pending.push(...runIds.map((id) => advanceWorkflowRun(test.db, id, cancel.signal)));
    const completed = Promise.allSettled(pending);
    // Both distinct run transactions must reach the shared rotation lock while it is held.
    await expect
      .poll(
        async () => {
          const { rows } = await test.pool.query<{ count: number }>(
            `
        SELECT count(*)::int AS count
        FROM pg_locks held
        JOIN pg_locks waiting USING (locktype, database, classid, objid, objsubid)
        WHERE held.pid = $1 AND held.locktype = 'advisory' AND held.granted AND NOT waiting.granted
      `,
            [pid],
          );
          return rows[0]?.count;
        },
        { timeout: 5_000 },
      )
      .toBe(2);
    await holder.query("COMMIT");
    expect(await completed).toEqual([
      { status: "fulfilled", value: { ok: true, value: "succeeded" } },
      { status: "fulfilled", value: { ok: true, value: "succeeded" } },
    ]);
  } finally {
    cancel.abort();
    try {
      await holder.query("ROLLBACK");
    } finally {
      holder.release();
      await Promise.allSettled(pending);
    }
  }
}

it("searches visible records and commits a single round-robin assignment per competing live run", async () => {
  const test = await makeTestDb();
  try {
    const scope = await seed(test);
    const preview = await simulateWorkflowDraft(
      test.db,
      scope.actor,
      { workflowId: scope.workflowId, recordId: firstId, definition },
      signal,
    );
    assert(preview.ok, JSON.stringify(preview));
    expect(preview.value).toMatchObject({
      outcome: "completed",
      steps: [
        { nodeId: "start", status: "succeeded" },
        { nodeId: "search", status: "succeeded" },
        { nodeId: "pick", status: "succeeded" },
      ],
    });
    expect(JSON.stringify(preview.value)).not.toContain(firstId);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
    expect(await test.db.select().from(workflowSteps)).toEqual([]);

    const simulation = await atPick(test, scope, "simulation");
    expect(await advanceWorkflowRun(test.db, simulation, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    const simulated = await pickReceipt(test, simulation);
    expect(simulated).toMatchObject({ simulated: true, output: { id: firstId } });
    expect(simulated.output).not.toHaveProperty("__pickProfile");

    const left = await atPick(test, scope, "live");
    const right = await atPick(test, scope, "live");
    await compete(test, scope.workflowId, [left, right]);
    const firstPair = await Promise.all([pickReceipt(test, left), pickReceipt(test, right)]);
    expect(firstPair.map((receipt) => receipt.output.id)).toEqual(
      expect.arrayContaining([firstId, secondId]),
    );

    const redelivered = await Promise.all(
      [left, right, left].map((id) => advanceWorkflowRun(test.db, id, signal)),
    );
    expect(redelivered).toEqual(
      Array.from({ length: 3 }, () => ({ ok: true, value: "succeeded" })),
    );
    expect(await Promise.all([pickReceipt(test, left), pickReceipt(test, right)])).toEqual(
      firstPair,
    );

    const next = await atPick(test, scope, "live");
    expect(await advanceWorkflowRun(test.db, next, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    expect(await pickReceipt(test, next)).toMatchObject({
      simulated: false,
      output: { id: firstId },
    });
  } finally {
    await test.close();
  }
});
