import { eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activities, workflowRuns, workflowSteps, workflows } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { admitManualRun } from "./runAdmission";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const conflict = { ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT };
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

function reviewedInput(test: Fixture) {
  return {
    workflowId: test.workflow.id,
    requestKey: crypto.randomUUID(),
    recordId: test.deal.id,
    mode: "live" as const,
    reviewedVersionId: test.version.id,
  };
}

async function republish(test: Fixture, db: Db = test.db) {
  const definition = structuredClone(test.definition);
  definition.nodes[2]!.config.subject = { kind: "value", value: "Changed publication" };
  const saved = await saveWorkflowDraft(
    db,
    test.actor,
    { id: test.workflow.id, revision: 1, name: "Changed workflow", definition },
    signal,
  );
  assert(saved.ok, JSON.stringify(saved));
  const published = await publishWorkflow(db, test.actor, test.workflow.id, 2, signal);
  assert(published.ok, JSON.stringify(published));
  return published.value;
}

// As in lifecycle.integration.test.ts, observe real PostgreSQL lock contention
// before releasing the leading command, and drain both contenders on failure.
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function inLockOrder<A, B>(
  test: TestDb,
  first: (db: Db) => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const ready = deferred();
  const release = deferred();
  let blockerPid = 0;
  let firstError: Error | undefined;
  const leading = test.db.transaction(async (tx) => {
    try {
      const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      blockerPid = pid.rows[0]?.pid ?? 0;
      const value = await first(tx);
      ready.resolve();
      await release.promise;
      return value;
    } catch (error) {
      firstError =
        error instanceof Error
          ? error
          : new Error("Leading review command failed", { cause: error });
      ready.resolve();
      throw firstError;
    }
  });
  const drainedLeading = Promise.allSettled([leading]);
  let trailing: Promise<B> | undefined;
  try {
    await ready.promise;
    if (firstError !== undefined) throw firstError;
    expect(blockerPid).toBeGreaterThan(0);
    trailing = second();
    const drainedTrailing = Promise.allSettled([trailing]);
    await expect
      .poll(
        async () => {
          const blocked = await test.pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity a
              WHERE a.datname = current_database() AND a.wait_event_type = 'Lock'
                AND $1::int = ANY(pg_blocking_pids(a.pid))
                AND a.query ILIKE '%workflows%' AND a.query ILIKE '%for update%'
            ) AS blocked`,
            [blockerPid],
          );
          return blocked.rows[0]?.blocked;
        },
        { timeout: 3000, interval: 10 },
      )
      .toBe(true);
    release.resolve();
    await drainedTrailing;
    return await Promise.all([leading, trailing]);
  } finally {
    release.resolve();
    await drainedLeading;
    if (trailing !== undefined) await Promise.allSettled([trailing]);
  }
}

it("admits a reviewed live command pinned to the exact current publication", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const admitted = await admitManualRun(test.db, test.actor, input, signal);
    assert(admitted.ok, JSON.stringify(admitted));
    expect(admitted.value).toMatchObject({ versionId: test.version.id, mode: "live" });
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("executes and replays a reviewed Global live command after republishing for Deals", async () => {
  const test = await setupWorkflowExecution();
  try {
    const name = "Global task workflow";
    const subject = "Review the synthetic checklist";
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        {
          id: "start",
          type: "trigger.manual",
          version: 1,
          name: "Start",
          config: { scope: "global" },
        },
        {
          id: "task",
          type: "activity.create",
          version: 1,
          name: "Create task",
          config: { subject: { kind: "value", value: subject } },
        },
      ],
      edges: [{ from: "start", to: "task", port: "next" }],
    };
    const created = await createWorkflow(test.db, test.actor, { name, definition }, signal);
    assert(created.ok, JSON.stringify(created));
    const { id: workflowId, revision } = created.value;
    const globalPublication = await publishWorkflow(
      test.db,
      test.actor,
      workflowId,
      revision,
      signal,
    );
    assert(globalPublication.ok, JSON.stringify(globalPublication));
    const input = {
      workflowId,
      requestKey: crypto.randomUUID(),
      mode: "live" as const,
      reviewedVersionId: globalPublication.value.id,
    };
    const forged = { ...input, recordId: test.deal.id };
    expect(await admitManualRun(test.db, test.actor, forged, signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
    const admitted = await admitManualRun(test.db, test.actor, input, signal);
    assert(admitted.ok, JSON.stringify(admitted));
    const runId = admitted.value.id;

    const saved = await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: workflowId, revision, name, definition: test.definition },
      signal,
    );
    assert(saved.ok, JSON.stringify(saved));
    const current = await publishWorkflow(
      test.db,
      test.actor,
      workflowId,
      saved.value.revision,
      signal,
    );
    assert(current.ok, JSON.stringify(current));
    expect(current.value.id).not.toBe(globalPublication.value.id);

    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual({
      ok: true,
      value: "running",
    });
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual({
      ok: true,
      value: "succeeded",
    });
    const steps = await test.db
      .select({
        nodeId: workflowSteps.nodeId,
        output: workflowSteps.output,
        simulated: workflowSteps.simulated,
      })
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, runId));
    expect(steps.find((step) => step.nodeId === "start")).toEqual({
      nodeId: "start",
      output: {},
      simulated: false,
    });
    expect(
      await test.db
        .select({ subject: activities.subject, dealId: activities.dealId })
        .from(activities),
    ).toEqual([{ subject, dealId: null }]);

    const replay = await admitManualRun(test.db, test.actor, input, signal);
    assert(replay.ok, JSON.stringify(replay));
    expect(replay.value).toMatchObject({
      id: runId,
      versionId: globalPublication.value.id,
      mode: "live",
      status: "succeeded",
    });
    expect(replay.value.trigger).toEqual({ scope: "global" });
    expect(replay.value.outputs.start).toEqual({});
    expect(await admitManualRun(test.db, test.actor, forged, signal)).toEqual(conflict);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("rejects a new stale reviewed command without inserting a run", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const version = await republish(test);
    expect(await admitManualRun(test.db, test.actor, input, signal)).toEqual(conflict);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
    const fresh = await admitManualRun(
      test.db,
      test.actor,
      { ...input, requestKey: crypto.randomUUID(), reviewedVersionId: version.id },
      signal,
    );
    assert(fresh.ok, JSON.stringify(fresh));
    expect(fresh.value.versionId).toBe(version.id);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("replays a response-lost original command after a different publication becomes current", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const first = await admitManualRun(test.db, test.actor, input, signal);
    assert(first.ok, JSON.stringify(first));
    await republish(test);
    const replay = await admitManualRun(test.db, test.actor, input, signal);
    assert(replay.ok, JSON.stringify(replay));
    expect(replay.value.id).toBe(first.value.id);
    expect(replay.value.versionId).toBe(test.version.id);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("rejects reuse of an existing command key with another reviewed version", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const first = await admitManualRun(test.db, test.actor, input, signal);
    assert(first.ok, JSON.stringify(first));
    const version = await republish(test);
    expect(
      await admitManualRun(
        test.db,
        test.actor,
        { ...input, reviewedVersionId: version.id },
        signal,
      ),
    ).toEqual(conflict);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it.each(["live", "simulation"] as const)(
  "preserves legacy %s admissions that omit the compatibility review field",
  async (mode) => {
    const test = await setupWorkflowExecution();
    try {
      const result = await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId: test.workflow.id,
          requestKey: crypto.randomUUID(),
          recordId: test.deal.id,
          mode,
        },
        signal,
      );
      assert(result.ok, JSON.stringify(result));
      expect(result.value).toMatchObject({ versionId: test.version.id, mode });
    } finally {
      await test.close();
    }
  },
);

it("rejects a malformed reviewed identity through the existing input-validation result", async () => {
  const test = await setupWorkflowExecution();
  try {
    expect(
      await admitManualRun(
        test.db,
        test.actor,
        { ...reviewedInput(test), reviewedVersionId: "not-a-version-id" },
        signal,
      ),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it.each([false, true])(
  "accepts canonical UUID identity with uppercase review spelling and republished replay=%s",
  async (republished) => {
    const test = await setupWorkflowExecution();
    try {
      const input = {
        ...reviewedInput(test),
        reviewedVersionId: test.version.id.toUpperCase(),
      };
      const first = await admitManualRun(test.db, test.actor, input, signal);
      assert(first.ok, JSON.stringify(first));
      if (republished) await republish(test);
      const replay = await admitManualRun(test.db, test.actor, input, signal);
      assert(replay.ok, JSON.stringify(replay));
      expect(replay.value.id).toBe(first.value.id);
      expect(replay.value.versionId).toBe(test.version.id);
      expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
    } finally {
      await test.close();
    }
  },
);

it("preserves current workflow authority gates when replaying a reviewed command", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    assert((await admitManualRun(test.db, test.actor, input, signal)).ok);
    await test.db
      .update(workflows)
      .set({ active: false })
      .where(eq(workflows.id, test.workflow.id));
    expect(await admitManualRun(test.db, test.actor, input, signal)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("rejects the stale review when publication wins the real workflow lock", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const [version, admitted] = await inLockOrder(
      test,
      (db) => republish(test, db),
      () => admitManualRun(test.db, test.actor, input, signal),
    );
    expect(version.id).not.toBe(test.version.id);
    expect(admitted).toEqual(conflict);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("keeps the reviewed original when admission wins the real workflow lock", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = reviewedInput(test);
    const [admitted, version] = await inLockOrder(
      test,
      (db) => admitManualRun(db, test.actor, input, signal),
      () => republish(test),
    );
    assert(admitted.ok, JSON.stringify(admitted));
    expect(version.id).not.toBe(test.version.id);
    expect(admitted.value.versionId).toBe(test.version.id);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});
