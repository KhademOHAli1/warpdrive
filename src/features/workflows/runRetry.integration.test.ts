import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  activities,
  permissionSets,
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import { advanceWorkflowRun } from "./execution";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { readRunHistory } from "./queries";
import { readRunDetail } from "./runDetail";
import { retryWorkflowRun } from "./runRetry";
import {
  failLaterTask,
  repairRetryPermission,
  retryFlags,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";

it("resumes the same failed task with the original version and preserves an earlier completed effect", async () => {
  const h = await setupRetryActor();
  try {
    const failed = await failLaterTask(h);
    const beforeActivities = await h.db.select().from(activities);
    expect(beforeActivities).toHaveLength(1);
    await repairRetryPermission(h);
    const draft = structuredClone(h.definition);
    const laterTask = draft.nodes.find((node) => node.id === "second_task");
    if (laterTask === undefined) throw new Error("Missing later task");
    laterTask.config.subject = { kind: "value", value: "A newer publication" };
    const saved = await saveWorkflowDraft(
      h.db,
      h.actor,
      { id: h.workflow.id, revision: h.workflow.revision, name: "Newer draft", definition: draft },
      retrySignal(),
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(
      (await publishWorkflow(h.db, h.actor, h.workflow.id, saved.value.revision, retrySignal())).ok,
    ).toBe(true);
    const input = retryInput(failed.run.id, failed.failure.id);
    expect(await retryWorkflowRun(h.db, h.who, input, retrySignal())).toEqual({
      ok: true,
      value: { id: failed.run.id, replayed: false },
    });
    const queued = await storedRetryRun(h, failed.run.id);
    expect(queued).toEqual({
      ...failed.run,
      status: "queued",
      errorId: null,
      updatedAt: queued.updatedAt,
    });
    expect(
      await h.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, failed.run.id))
        .orderBy(workflowSteps.id),
    ).toEqual(failed.beforeSteps);
    await Promise.all([
      advanceWorkflowRun(h.db, queued.id, retrySignal()),
      advanceWorkflowRun(h.db, queued.id, retrySignal()),
    ]);
    const done = await storedRetryRun(h, queued.id);
    expect(done.status).toBe("succeeded");
    const allSteps = await h.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, done.id))
      .orderBy(workflowSteps.id);
    expect(allSteps.filter((step) => step.nodeId !== "second_task")).toEqual(failed.beforeSteps);
    expect(done.versionId).toBe(failed.run.versionId);
    expect(done.actorId).toBe(failed.run.actorId);
    expect(done.requestKey).toBe(failed.run.requestKey);
    expect(done.trigger).toEqual(failed.run.trigger);
    expect(done.outputs.task).toEqual(failed.run.outputs.task);
    const effects = await h.db.select().from(activities);
    expect(effects).toHaveLength(2);
    expect(effects.find((row) => row.id === beforeActivities[0]?.id)).toEqual(beforeActivities[0]);
    expect(effects.some((row) => row.subject === "Recovered later task")).toBe(true);
    expect(effects.some((row) => row.subject === "A newer publication")).toBe(false);
    const [history] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.id, failed.failure.id));
    expect(history).toEqual({
      ...failed.failure,
      retryRequestKey: input.requestKey,
      retriedBy: h.user.id,
      retriedAt: history?.retriedAt,
    });
    expect(history?.retriedAt).toBeInstanceOf(Date);
    const detail = await readRunDetail(h.db, h.actor, h.workflow.id, done.id, retrySignal());
    if (!detail.ok) throw new Error(detail.error);
    expect(detail.value.recovery?.history).toHaveLength(1);
    expect(detail.value.recovery?.history[0]).not.toHaveProperty("retryRequestKey");
    for (const field of ["trigger", "outputs", "stored"])
      expect(detail.value).not.toHaveProperty(field);
    expect(detail.value.steps.every((step) => !Object.hasOwn(step, "output"))).toBe(true);
    const historyRows = await readRunHistory(h.db, h.actor, h.workflow.id, retrySignal());
    if (!historyRows.ok) throw new Error(historyRows.error);
    expect(historyRows.value[0]?.recovery?.history).toEqual(detail.value.recovery?.history);
    for (const field of ["trigger", "outputs", "run", "definition"])
      expect(historyRows.value[0]).not.toHaveProperty(field);
  } finally {
    await h.close();
  }
});

it("accepts a parallel identical retry only once and returns its durable receipt", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    const input = retryInput(f.run.id, f.failure.id);
    const results = await Promise.all([
      retryWorkflowRun(h.db, h.who, input, retrySignal()),
      retryWorkflowRun(h.db, h.who, input, retrySignal()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && !result.value.replayed)).toHaveLength(1);
    await advanceWorkflowRun(h.db, f.run.id, retrySignal());
    expect(await h.db.select().from(activities)).toHaveLength(2);
    expect(await h.db.select().from(workflowRunFailures)).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("does not consume the same failure twice when two tabs use different request keys", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    const results = await Promise.all([
      retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
      retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error === "E_WORKFLOW_003"),
    ).toHaveLength(1);
    await advanceWorkflowRun(h.db, f.run.id, retrySignal());
    expect(await h.db.select().from(activities)).toHaveLength(2);
  } finally {
    await h.close();
  }
});

it("replays a lost acknowledgment without retrying a newer failure generation", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    const first = retryInput(f.run.id, f.failure.id);
    expect((await retryWorkflowRun(h.db, h.who, first, retrySignal())).ok).toBe(true);
    await h.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "activity.create": false } })
      .where(eq(permissionSets.id, h.permissions.id));
    await advanceWorkflowRun(h.db, f.run.id, retrySignal());
    const [next] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(and(eq(workflowRunFailures.runId, f.run.id), isNull(workflowRunFailures.retriedAt)));
    expect(next?.id).not.toBe(f.failure.id);
    if (next === undefined) throw new Error("Missing newer failure");
    await repairRetryPermission(h);
    const before = await storedRetryRun(h, f.run.id);
    expect(await retryWorkflowRun(h.db, h.who, first, retrySignal())).toEqual({
      ok: true,
      value: { id: f.run.id, replayed: true },
    });
    expect(await storedRetryRun(h, f.run.id)).toEqual(before);
    expect(
      await retryWorkflowRun(
        h.db,
        h.who,
        { ...first, requestKey: crypto.randomUUID() },
        retrySignal(),
      ),
    ).toEqual({ ok: false, error: "E_WORKFLOW_003" });
    expect(
      await retryWorkflowRun(h.db, h.who, { ...first, failureId: next.id }, retrySignal()),
    ).toEqual({ ok: false, error: "E_WORKFLOW_003" });
    expect(await h.db.select().from(activities)).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("binds an actor's request key to one run and one failure", async () => {
  const h = await setupRetryActor();
  try {
    const first = await failLaterTask(h);
    const second = await failLaterTask(h);
    await repairRetryPermission(h);
    const key = crypto.randomUUID();
    const results = await Promise.all([
      retryWorkflowRun(h.db, h.who, retryInput(first.run.id, first.failure.id, key), retrySignal()),
      retryWorkflowRun(
        h.db,
        h.who,
        retryInput(second.run.id, second.failure.id, key),
        retrySignal(),
      ),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error === "E_WORKFLOW_003"),
    ).toHaveLength(1);
    expect(
      (await h.db.select().from(workflowRuns)).filter((run) => run.status === "queued"),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("keeps an accepted retry durable when its effect-to-progress transaction fails", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    const input = retryInput(f.run.id, f.failure.id);
    expect((await retryWorkflowRun(h.db, h.who, input, retrySignal())).ok).toBe(true);
    await h.pool.query(
      "ALTER TABLE workflow_steps ADD CONSTRAINT retry_progress_failure CHECK(node_id <> 'second_task')",
    );
    await expect(advanceWorkflowRun(h.db, f.run.id, retrySignal())).rejects.toThrow();
    expect(await h.db.select().from(activities)).toHaveLength(1);
    expect((await storedRetryRun(h, f.run.id)).status).toBe("queued");
    await h.pool.query("ALTER TABLE workflow_steps DROP CONSTRAINT retry_progress_failure");
    await advanceWorkflowRun(h.db, f.run.id, retrySignal());
    expect(await h.db.select().from(activities)).toHaveLength(2);
    expect((await retryWorkflowRun(h.db, h.who, input, retrySignal())).ok).toBe(true);
    expect(await h.db.select().from(activities)).toHaveLength(2);
  } finally {
    await h.close();
  }
});
