import { and, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { persons, workflowRuns, workflowSteps } from "@/db/schema";
import { toContactActor } from "@/features/contacts/actorAdapters";
import { deletePerson } from "@/features/contacts/deletePerson";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const initialName = "Jordan Example";
const workflowName = "Upsert a Person";
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

function personWorkflow(name: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "upsert",
        type: "record.upsert",
        version: 1,
        name: "Create or Update Record",
        config: {
          entity: "person",
          key: { kind: "value", value: "customer:42" },
          fields: { name: { kind: "value", value: name } },
        },
      },
    ],
    edges: [{ from: "start", to: "upsert", port: "next" }],
  };
}

async function createPersonWorkflow(test: Fixture) {
  const saved = await createWorkflow(
    test.db,
    test.actor,
    { name: workflowName, definition: personWorkflow(initialName) },
    signal,
  );
  assert(saved.ok, JSON.stringify(saved));
  return saved.value;
}

async function publish(test: Fixture, workflow: { id: string; revision: number }) {
  const result = await publishWorkflow(test.db, test.actor, workflow.id, workflow.revision, signal);
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

async function readyRun(
  test: Fixture,
  version: { workflowId: string; id: string },
  mode: "live" | "simulation" = "live",
) {
  const run = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: version.workflowId,
      reviewedVersionId: version.id,
      recordId: test.deal.id,
      requestKey: crypto.randomUUID(),
      mode,
    },
    signal,
  );
  assert(run.ok, JSON.stringify(run));
  const id = run.value.id;
  expect(await advanceWorkflowRun(test.db, id, signal)).toEqual({ ok: true, value: "running" });
  return id;
}

async function upsertReceipt(test: Fixture, runId: string, simulated = false) {
  const steps = await test.db
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.runId, runId), eq(workflowSteps.nodeId, "upsert")));
  const id = steps[0]?.output.id;
  assert(typeof id === "string");
  expect(steps).toEqual([expect.objectContaining({ simulated, output: { id } })]);
  return id;
}

async function compete(test: Fixture, runIds: readonly [string, string]) {
  const holder = await test.pool.connect();
  const cancel = new AbortController();
  const pending: ReturnType<typeof advanceWorkflowRun>[] = [];
  try {
    await holder.query("BEGIN");
    // Let both runs read the absent Person, then hold both inserts at the table lock.
    await holder.query("LOCK TABLE persons IN SHARE MODE");
    pending.push(...runIds.map((id) => advanceWorkflowRun(test.db, id, cancel.signal)));
    const completed = Promise.allSettled(pending);
    await expect
      .poll(
        async () => {
          const { rows } = await test.pool.query<{ count: number }>(`
            SELECT count(*)::int AS count
            FROM pg_locks
            WHERE locktype = 'relation' AND relation = 'persons'::regclass
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND mode = 'RowExclusiveLock' AND NOT granted
          `);
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

it("converges competing live inserts on one Person and updates it in the next version", async () => {
  const test = await setupWorkflowExecution();
  try {
    const workflow = await createPersonWorkflow(test);
    const version = await publish(test, workflow);
    const first = await readyRun(test, version);
    const second = await readyRun(test, version);
    expect(first).not.toBe(second);
    await compete(test, [first, second]);
    const id = await upsertReceipt(test, first);
    expect(await upsertReceipt(test, second)).toBe(id);
    expect(await test.db.select().from(persons)).toEqual([
      expect.objectContaining({ id, name: initialName, ownerId: test.actor.id, deletedAt: null }),
    ]);

    const updatedName = "Jordan Updated";
    const draft = await saveWorkflowDraft(
      test.db,
      test.actor,
      {
        id: workflow.id,
        revision: workflow.revision,
        name: workflowName,
        definition: personWorkflow(updatedName),
      },
      signal,
    );
    assert(draft.ok, JSON.stringify(draft));
    const nextVersion = await publish(test, draft.value);
    expect(nextVersion.id).not.toBe(version.id);
    const update = await readyRun(test, nextVersion);
    expect(await advanceWorkflowRun(test.db, update, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    expect(await upsertReceipt(test, update)).toBe(id);
    expect(await test.db.select().from(persons)).toEqual([
      expect.objectContaining({ id, name: updatedName, ownerId: test.actor.id, deletedAt: null }),
    ]);
  } finally {
    await test.close();
  }
});

it("rolls back both draft and published simulation writes", async () => {
  const test = await setupWorkflowExecution();
  try {
    const workflow = await createPersonWorkflow(test);
    const draft = await simulateWorkflowDraft(
      test.db,
      test.actor,
      {
        workflowId: workflow.id,
        recordId: test.deal.id,
        definition: personWorkflow(initialName),
      },
      signal,
    );
    assert(draft.ok, JSON.stringify(draft));
    expect(draft.value).toMatchObject({
      outcome: "completed",
      steps: [
        { nodeId: "start", status: "succeeded" },
        { nodeId: "upsert", nodeType: "record.upsert", status: "succeeded" },
      ],
    });
    expect(draft.value.steps.at(-1)).not.toHaveProperty("output");
    expect(await test.db.select().from(persons)).toEqual([]);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);

    const version = await publish(test, workflow);
    const run = await readyRun(test, version, "simulation");
    expect(await advanceWorkflowRun(test.db, run, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    await upsertReceipt(test, run, true);
    expect(await test.db.select().from(persons)).toEqual([]);
  } finally {
    await test.close();
  }
});

it("fails on a soft-deleted Person at the same key without creating another record", async () => {
  const test = await setupWorkflowExecution();
  try {
    const version = await publish(test, await createPersonWorkflow(test));
    const first = await readyRun(test, version);
    expect(await advanceWorkflowRun(test.db, first, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    const id = await upsertReceipt(test, first);
    const removed = await deletePerson(test.db, toContactActor(test.actor), id, signal);
    assert(removed.ok, JSON.stringify(removed));

    const retry = await readyRun(test, version);
    expect(await advanceWorkflowRun(test.db, retry, signal)).toEqual({ ok: true, value: "failed" });
    const [failed] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, retry));
    expect(failed).toMatchObject({ errorId: ERROR_IDS.CONTACT_NOT_FOUND });
    expect(failed?.outputs).not.toHaveProperty("upsert");
    expect(await test.db.select().from(persons)).toEqual([
      expect.objectContaining({ id, name: initialName, deletedAt: expect.any(Date) }),
    ]);
  } finally {
    await test.close();
  }
});
