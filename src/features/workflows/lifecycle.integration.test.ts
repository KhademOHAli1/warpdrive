import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  activities,
  permissionSets,
  users,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import type { TestDb } from "@/test/db";
import { advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import {
  archiveWorkflow,
  duplicateWorkflow,
  restoreWorkflowDraft,
  unarchiveWorkflow,
} from "./lifecycle";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { listWorkflows } from "./queries";
import { admitManualRun } from "./runAdmission";
import { cancelWorkflowRun } from "./runControl";
import { retryFlags, setupRetryActor } from "./runRetry.test-helpers";
import { registerWorkflowJobs } from "./worker";

const signal = new AbortController().signal;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const conflict = { ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT };
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

async function readWorkflow(test: TestDb, id: string) {
  const [row] = await test.db.select().from(workflows).where(eq(workflows.id, id));
  assert(row !== undefined, "Missing persisted workflow");
  return row;
}

async function snapshot(test: TestDb) {
  // Sort by IDs rather than relying on heap order after updates.
  return {
    workflows: await test.db.select().from(workflows).orderBy(workflows.id),
    versions: await test.db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await test.db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await test.db.select().from(workflowSteps).orderBy(workflowSteps.id),
    activities: await test.db.select().from(activities).orderBy(activities.id),
  };
}

async function admit(test: Fixture) {
  const result = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: test.workflow.id,
      requestKey: crypto.randomUUID(),
      recordId: test.deal.id,
      mode: "live",
    },
    signal,
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// The first real service command owns the workflow row until the outer transaction
// commits. The second must be visibly blocked on that transaction before release.
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
          : new Error("Leading lifecycle command failed", { cause: error });
      ready.resolve();
      throw firstError;
    }
  });
  // Attach handlers immediately; cleanup must drain both contenders on barrier failure.
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

it("LC01 archives an active published workflow without changing its definition or history", async () => {
  const test = await setupWorkflowExecution();
  try {
    await admit(test);
    const visibleBefore = await listWorkflows(test.db, test.actor, signal);
    assert(visibleBefore.ok, JSON.stringify(visibleBefore));
    expect(visibleBefore.value.items.map((workflow) => workflow.id)).toEqual([test.workflow.id]);
    const before = await snapshot(test);
    const archived = await archiveWorkflow(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1 },
      signal,
    );
    assert(archived.ok, JSON.stringify(archived));
    expect(archived.value).toMatchObject({
      active: false,
      revision: 2,
      archivedAt: expect.any(Date),
    });
    const hiddenAfter = await listWorkflows(test.db, test.actor, signal);
    assert(hiddenAfter.ok, JSON.stringify(hiddenAfter));
    expect(hiddenAfter.value.items).toEqual([]);
    const after = await snapshot(test);
    expect(after.versions).toEqual(before.versions);
    expect(after.runs).toEqual(before.runs);
    expect(after.steps).toEqual(before.steps);
    expect(after.activities).toEqual(before.activities);
    expect(after.workflows[0]).toMatchObject({
      draft: before.workflows[0]?.draft,
      name: before.workflows[0]?.name,
      ownerId: before.workflows[0]?.ownerId,
      publishedNumber: before.workflows[0]?.publishedNumber,
      createdAt: before.workflows[0]?.createdAt,
    });
  } finally {
    await test.close();
  }
});

for (const archiveFirst of [true, false]) {
  it(`LC02 serializes admission and archive with ${archiveFirst ? "archive" : "admission"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const runInput = {
        workflowId: test.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: test.deal.id,
        mode: "live",
      };
      const archive = (db: Db) =>
        archiveWorkflow(db, test.actor, { id: test.workflow.id, revision: 1 }, signal);
      const admission = (db: Db) => admitManualRun(db, test.actor, runInput, signal);
      if (archiveFirst) {
        const [archived, blockedAdmission] = await inLockOrder(test, archive, () =>
          admission(test.db),
        );
        expect(archived.ok).toBe(true);
        expect(blockedAdmission).toEqual(denied);
        expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
      } else {
        const [admitted, archived] = await inLockOrder(test, admission, () => archive(test.db));
        assert(admitted.ok, JSON.stringify(admitted));
        expect(archived.ok).toBe(true);
        const before = await test.db.select().from(workflowRuns);
        expect(before).toHaveLength(1);
        expect(before[0]?.versionId).toBe(test.version.id);
        expect(await advanceWorkflowRun(test.db, admitted.value.id, signal)).toEqual({
          ok: true,
          value: "failed",
        });
        const [after] = await test.db.select().from(workflowRuns);
        expect(after).toMatchObject({
          versionId: test.version.id,
          resumeAt: null,
          status: "failed",
        });
        expect(await test.db.select().from(activities)).toHaveLength(0);
        expect(await test.db.select().from(workflowSteps)).toHaveLength(0);
        expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
      }
    } finally {
      await test.close();
    }
  }, 15_000);
}

it("LC03 preserves a completed task and pinned wait when a restarted worker observes archive", async () => {
  const test = await setupRetryActor();
  const boss = new PgBoss({ connectionString: test.url, maintenanceIntervalSeconds: 1 });
  boss.on("error", () => undefined);
  try {
    const definition = structuredClone(test.definition);
    definition.nodes.push({
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait",
      config: { minutes: { kind: "value", value: 1 } },
    });
    definition.edges = definition.edges.filter((edge) => edge.from !== "task");
    definition.edges.push(
      { from: "task", to: "wait", port: "next" },
      { from: "wait", to: "second_task", port: "next" },
    );
    const saved = await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1, name: "Partial wait", definition },
      signal,
    );
    assert(saved.ok, JSON.stringify(saved));
    const published = await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal);
    assert(published.ok, JSON.stringify(published));
    const run = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: test.deal.id,
        mode: "live",
      },
      signal,
    );
    assert(run.ok, JSON.stringify(run));
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, run.value.id, signal);
    const [waiting] = await test.db.select().from(workflowRuns);
    expect(waiting).toMatchObject({
      status: "waiting",
      nextNodeId: "wait",
      versionId: published.value.id,
    });
    expect(waiting?.resumeAt).toBeInstanceOf(Date);
    await test.pool.query(
      "UPDATE workflow_runs SET resume_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [run.value.id],
    );
    const before = await snapshot(test);
    expect(before.activities).toHaveLength(1);
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 2 }, signal))
        .ok,
    );
    await boss.start();
    await registerWorkflowJobs(boss, test.db);
    await expect
      .poll(async () => (await test.db.select().from(workflowRuns))[0]?.status, { timeout: 15_000 })
      .toBe("failed");
    const after = await snapshot(test);
    expect(after.activities).toEqual(before.activities);
    expect(after.steps).toEqual(before.steps);
    expect(after.versions).toEqual(before.versions);
    expect(after.runs[0]).toMatchObject({
      versionId: published.value.id,
      status: "failed",
      resumeAt: null,
      outputs: before.runs[0]?.outputs,
    });
  } finally {
    try {
      await boss.stop();
    } finally {
      await test.close();
    }
  }
}, 25_000);

for (const status of ["queued", "running", "waiting"] as const) {
  it(`LC04 permits explicit cancellation after archive while ${status}`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const run = await admit(test);
      if (status === "running") await advanceWorkflowRun(test.db, run.id, signal);
      if (status === "waiting") {
        // Native eligible-state fixture; real wait/restart behavior is covered in LC03.
        await test.db
          .update(workflowRuns)
          .set({ status, resumeAt: new Date("2099-01-01T00:00:00Z") })
          .where(eq(workflowRuns.id, run.id));
      }
      const before = await test.db.select().from(workflowSteps);
      assert(
        (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
          .ok,
      );
      expect(await cancelWorkflowRun(test.db, test.actor, run.id, signal)).toEqual({
        ok: true,
        value: "cancelled",
      });
      const [cancelled] = await test.db.select().from(workflowRuns);
      expect(cancelled).toMatchObject({
        cancelledBy: test.actor.id,
        cancelledAt: expect.any(Date),
        resumeAt: null,
      });
      await advanceWorkflowRun(test.db, run.id, signal);
      expect(await test.db.select().from(workflowRuns)).toEqual([cancelled]);
      expect(await test.db.select().from(workflowSteps)).toEqual(before);
      expect(await test.db.select().from(activities)).toHaveLength(0);
    } finally {
      await test.close();
    }
  });
}

it("LC04 leaves terminal archive-fence identity and time untouched on cancellation retry", async () => {
  const test = await setupWorkflowExecution();
  try {
    const run = await admit(test);
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
        .ok,
    );
    await advanceWorkflowRun(test.db, run.id, signal);
    const before = await test.db.select().from(workflowRuns);
    expect(before[0]).toMatchObject({ status: "failed", cancelledBy: null, cancelledAt: null });
    expect(await cancelWorkflowRun(test.db, test.actor, run.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    expect(await test.db.select().from(workflowRuns)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("LC05 denies a nonarchived continuation after current run rights are revoked", async () => {
  const test = await setupRetryActor();
  try {
    const run = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: test.deal.id,
        mode: "live",
      },
      signal,
    );
    assert(run.ok, JSON.stringify(run));
    await advanceWorkflowRun(test.db, run.value.id, signal);
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.run": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(await advanceWorkflowRun(test.db, run.value.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    expect((await readWorkflow(test, test.workflow.id)).archivedAt).toBeNull();
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

for (const published of [true, false]) {
  it(`LC08 unarchives ${published ? "formerly active" : "never published"} state inactive`, async () => {
    const test = await setupWorkflowExecution();
    try {
      let id = test.workflow.id;
      if (!published) {
        const source = await createWorkflow(
          test.db,
          test.actor,
          { name: "Draft only", definition: test.definition },
          signal,
        );
        assert(source.ok, JSON.stringify(source));
        id = source.value.id;
      }
      const before = await readWorkflow(test, id);
      assert((await archiveWorkflow(test.db, test.actor, { id, revision: 1 }, signal)).ok);
      const restored = await unarchiveWorkflow(test.db, test.actor, { id, revision: 2 }, signal);
      assert(restored.ok, JSON.stringify(restored));
      expect(restored.value).toMatchObject({
        active: false,
        archivedAt: null,
        revision: 3,
        publishedNumber: before.publishedNumber,
        draft: before.draft,
      });
      expect(
        await admitManualRun(
          test.db,
          test.actor,
          { workflowId: id, requestKey: crypto.randomUUID(), recordId: test.deal.id, mode: "live" },
          signal,
        ),
      ).toEqual(denied);
      expect(await publishWorkflow(test.db, test.actor, id, 3, signal)).toMatchObject({ ok: true });
      expect((await readWorkflow(test, id)).active).toBe(true);
    } finally {
      await test.close();
    }
  });
}

it("LC09 rejects stale lifecycle/save commands without losing the current draft or pointer", async () => {
  const test = await setupWorkflowExecution();
  try {
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
        .ok,
    );
    let before = await snapshot(test);
    expect(
      await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal),
    ).toEqual(conflict);
    expect(
      await unarchiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal),
    ).toEqual(conflict);
    expect(await snapshot(test)).toEqual(before);
    assert(
      (await unarchiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 2 }, signal))
        .ok,
    );
    before = await snapshot(test);
    expect(
      await unarchiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 2 }, signal),
    ).toEqual(conflict);
    expect(
      await saveWorkflowDraft(
        test.db,
        test.actor,
        {
          id: test.workflow.id,
          revision: 1,
          name: "Unsaved local name",
          definition: test.definition,
        },
        signal,
      ),
    ).toEqual(conflict);
    expect(
      await restoreWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 1, versionNumber: 1 },
        signal,
      ),
    ).toEqual(conflict);
    expect(await snapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

for (const archiveFirst of [true, false]) {
  it(`LC10 serializes archive/save with ${archiveFirst ? "archive" : "save"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const archive = (db: Db) =>
        archiveWorkflow(db, test.actor, { id: test.workflow.id, revision: 1 }, signal);
      const save = (db: Db) =>
        saveWorkflowDraft(
          db,
          test.actor,
          {
            id: test.workflow.id,
            revision: 1,
            name: "Saved before archive",
            definition: test.definition,
          },
          signal,
        );
      const results = archiveFirst
        ? await inLockOrder(test, archive, () => save(test.db))
        : await inLockOrder(test, save, () => archive(test.db));
      expect(results[0].ok).toBe(true);
      expect(results[1]).toEqual(conflict);
      const current = await readWorkflow(test, test.workflow.id);
      expect(current.revision).toBe(2);
      expect(current.name).toBe(archiveFirst ? "Follow up" : "Saved before archive");
      expect(current.archivedAt === null).toBe(!archiveFirst);
      expect(current.active).toBe(!archiveFirst);
      expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
    } finally {
      await test.close();
    }
  }, 15_000);
}

for (const archiveFirst of [true, false]) {
  it(`LC11 serializes archive/publication with ${archiveFirst ? "archive" : "publication"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const saved = await saveWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 1, name: "Next version", definition: test.definition },
        signal,
      );
      assert(saved.ok, JSON.stringify(saved));
      const archive = (db: Db) =>
        archiveWorkflow(db, test.actor, { id: test.workflow.id, revision: 2 }, signal);
      const publish = (db: Db) => publishWorkflow(db, test.actor, test.workflow.id, 2, signal);
      if (archiveFirst) {
        const [archived, publication] = await inLockOrder(test, archive, () => publish(test.db));
        expect(archived.ok).toBe(true);
        expect(publication).toEqual(conflict);
        expect(await test.db.select().from(workflowVersions)).toHaveLength(1);
      } else {
        const [publication, archived] = await inLockOrder(test, publish, () => archive(test.db));
        expect(publication.ok).toBe(true);
        expect(archived.ok).toBe(true);
        const versions = await test.db
          .select()
          .from(workflowVersions)
          .orderBy(workflowVersions.number);
        expect(versions).toHaveLength(2);
        expect(versions[1]).toMatchObject({ name: "Next version", number: 2 });
      }
      expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
        revision: 3,
        active: false,
        archivedAt: expect.any(Date),
      });
    } finally {
      await test.close();
    }
  }, 15_000);
}

it("LC12 serializes unarchive before restore and rejects an old publication revision", async () => {
  const test = await setupWorkflowExecution();
  try {
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
        .ok,
    );
    const before = await snapshot(test);
    // At the current archived revision, publication/restore cannot author the workflow.
    expect((await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal)).ok).toBe(
      false,
    );
    expect(
      (
        await restoreWorkflowDraft(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 2, versionNumber: 1 },
          signal,
        )
      ).ok,
    ).toBe(false);
    expect(await snapshot(test)).toEqual(before);
    const [unarchived, staleRestore] = await inLockOrder(
      test,
      (db) => unarchiveWorkflow(db, test.actor, { id: test.workflow.id, revision: 2 }, signal),
      () =>
        restoreWorkflowDraft(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 2, versionNumber: 1 },
          signal,
        ),
    );
    expect(unarchived.ok).toBe(true);
    expect(staleRestore).toEqual(conflict);
    expect(await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal)).toEqual(
      conflict,
    );
    expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
      active: false,
      revision: 3,
      publishedNumber: 1,
      draft: test.definition,
    });
    expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
  } finally {
    await test.close();
  }
}, 15_000);

for (const archived of [false, true]) {
  it(`LC13 duplicates a saved ${archived ? "archived" : "unarchived"} source into an inert caller-owned draft`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const definition = structuredClone(test.definition);
      definition.layout = { start: { x: -14, y: 40 }, task: { x: 90, y: 120 } };
      definition.nodes[2]!.name = "Kunden nachfassen";
      definition.nodes[2]!.nameMode = "custom";
      const saved = await saveWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 1, name: "Saved source", definition },
        signal,
      );
      assert(saved.ok, JSON.stringify(saved));
      await admit(test);
      if (archived)
        assert(
          (
            await archiveWorkflow(
              test.db,
              test.actor,
              { id: test.workflow.id, revision: 2 },
              signal,
            )
          ).ok,
        );
      const copier = await seedUser(test.db, { isAdmin: true });
      const copierActor = await hydrateActor(test.db, copier.id, signal);
      assert(copierActor !== null);
      const before = await snapshot(test);
      const copy = await duplicateWorkflow(
        test.db,
        copierActor,
        { id: test.workflow.id, revision: archived ? 3 : 2, name: "  Kopie پیگیری  " },
        signal,
      );
      assert(copy.ok, JSON.stringify(copy));
      expect(copy.value.id).not.toBe(test.workflow.id);
      expect(copy.value).toMatchObject({
        ownerId: copier.id,
        name: "Kopie پیگیری",
        revision: 1,
        active: false,
        archivedAt: null,
        publishedNumber: null,
        draft: definition,
      });
      const after = await snapshot(test);
      expect(after.workflows.filter((row) => row.id !== copy.value.id)).toEqual(before.workflows);
      expect(after.versions).toEqual(before.versions);
      expect(after.runs).toEqual(before.runs);
      expect(after.activities).toEqual(before.activities);
      expect(copy.value).not.toHaveProperty("requestKey");
      expect(copy.value).not.toHaveProperty("publishedBy");
    } finally {
      await test.close();
    }
  });
}

it("LC14 requires create plus source view while source edit/publish are unnecessary", async () => {
  const test = await setupRetryActor();
  try {
    const input = { id: test.workflow.id, revision: 1, name: "Viewable source copy" };
    const before = await snapshot(test);
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(await duplicateWorkflow(test.db, test.actor, input, signal)).toEqual(denied);
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.create": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(await duplicateWorkflow(test.db, test.actor, input, signal)).toEqual(denied);
    expect(await snapshot(test)).toEqual(before);
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true, "workflow.create": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    const result = await duplicateWorkflow(test.db, test.actor, input, signal);
    assert(result.ok, JSON.stringify(result));
    expect(result.value).toMatchObject({
      ownerId: test.actor.id,
      active: false,
      publishedNumber: null,
    });
    const fresh = await hydrateActor(test.db, test.actor.id, signal);
    assert(fresh !== null);
    expect(fresh.flags.has("workflow.edit")).toBe(false);
    expect(fresh.flags.has("workflow.publish")).toBe(false);
    expect(fresh.flags.has("activity.create")).toBe(false);
  } finally {
    await test.close();
  }
});

it("LC15 rejects stale source revisions and unreviewed sensitive config without copying or echoing it", async () => {
  const test = await setupWorkflowExecution();
  try {
    const before = await snapshot(test);
    expect(
      await duplicateWorkflow(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 99, name: "Stale copy" },
        signal,
      ),
    ).toEqual(conflict);
    expect(await snapshot(test)).toEqual(before);
    const definition = structuredClone(test.definition);
    definition.nodes[2]!.config.connectionToken = "copy-secret-canary";
    const saved = await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1, name: "Unreviewed source", definition },
      signal,
    );
    assert(saved.ok, JSON.stringify(saved));
    const unsafeBefore = await snapshot(test);
    const copy = await duplicateWorkflow(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 2, name: "Unsafe copy" },
      signal,
    );
    expect(copy).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_NOT_READY,
      reason: "copy-unavailable",
    });
    expect(JSON.stringify(copy)).not.toContain("copy-secret-canary");
    expect(await snapshot(test)).toEqual(unsafeBefore);
  } finally {
    await test.close();
  }
});

it("LC16 restores v1 as draft while v2 and both pinned runs remain immutable", async () => {
  const test = await setupWorkflowExecution();
  try {
    const run1 = await admit(test);
    const definition2 = structuredClone(test.definition);
    definition2.nodes[2]!.config.subject = { kind: "value", value: "Version two task" };
    definition2.layout = { task: { x: 22, y: 44 } };
    assert(
      (
        await saveWorkflowDraft(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 1, name: "Version two", definition: definition2 },
          signal,
        )
      ).ok,
    );
    const version2 = await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal);
    assert(version2.ok, JSON.stringify(version2));
    const run2 = await admit(test);
    expect(run1.versionId).toBe(test.version.id);
    expect(run2.versionId).toBe(version2.value.id);
    const before = await snapshot(test);
    const restored = await restoreWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 2, versionNumber: 1 },
      signal,
    );
    assert(restored.ok, JSON.stringify(restored));
    expect(restored.value).toMatchObject({
      revision: 3,
      name: test.version.name,
      draft: test.version.definition,
      active: true,
      publishedNumber: 2,
    });
    const after = await snapshot(test);
    expect(after.versions).toEqual(before.versions);
    expect(after.runs).toEqual(before.runs);
    const identical = await restoreWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 3, versionNumber: 1 },
      signal,
    );
    assert(identical.ok, JSON.stringify(identical));
    expect(identical.value.revision).toBe(4);
    const published = await publishWorkflow(test.db, test.actor, test.workflow.id, 4, signal);
    assert(published.ok, JSON.stringify(published));
    expect(published.value).toMatchObject({
      number: 3,
      definition: test.version.definition,
      name: test.version.name,
    });
    expect(
      (await test.db.select().from(workflowVersions).orderBy(workflowVersions.number)).slice(0, 2),
    ).toEqual(before.versions.sort((a, b) => a.number - b.number));
    expect(await test.db.select().from(workflowRuns).orderBy(workflowRuns.id)).toEqual(before.runs);
  } finally {
    await test.close();
  }
});

it("LC17 denies unavailable same-workflow versions without copying another workflow", async () => {
  const test = await setupWorkflowExecution();
  try {
    const other = await createWorkflow(
      test.db,
      test.actor,
      { name: "Other private definition", definition: test.definition },
      signal,
    );
    assert(other.ok, JSON.stringify(other));
    const otherVersion = await publishWorkflow(test.db, test.actor, other.value.id, 1, signal);
    assert(otherVersion.ok, JSON.stringify(otherVersion));
    // Version number 2 exists only for the other workflow.
    assert(
      (
        await saveWorkflowDraft(
          test.db,
          test.actor,
          {
            id: other.value.id,
            revision: 1,
            name: "Only other workflow v2",
            definition: test.definition,
          },
          signal,
        )
      ).ok,
    );
    assert((await publishWorkflow(test.db, test.actor, other.value.id, 2, signal)).ok);
    const before = await snapshot(test);
    expect(
      await restoreWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 1, versionNumber: 2 },
        signal,
      ),
    ).toEqual(denied);
    expect(
      await restoreWorkflowDraft(
        test.db,
        test.actor,
        { id: test.workflow.id, revision: 1, versionNumber: 999 },
        signal,
      ),
    ).toEqual(denied);
    expect(await snapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

for (const raw of [
  { id: "not-a-uuid", revision: 1 },
  { id: crypto.randomUUID(), revision: 0 },
  { id: crypto.randomUUID(), revision: Number.MAX_SAFE_INTEGER + 1 },
  { id: crypto.randomUUID(), revision: 1, injected: true },
]) {
  it("LC17 rejects malformed lifecycle input before writes", async () => {
    const test = await setupWorkflowExecution();
    try {
      const before = await snapshot(test);
      expect(await archiveWorkflow(test.db, test.actor, raw, signal)).toEqual(invalid);
      expect(await unarchiveWorkflow(test.db, test.actor, raw, signal)).toEqual(invalid);
      expect(
        await duplicateWorkflow(test.db, test.actor, { ...raw, name: "Copy" }, signal),
      ).toEqual(invalid);
      expect(
        await restoreWorkflowDraft(test.db, test.actor, { ...raw, versionNumber: 1 }, signal),
      ).toEqual(invalid);
      expect(await snapshot(test)).toEqual(before);
    } finally {
      await test.close();
    }
  });
}

const commandNames = ["archive", "unarchive", "duplicate", "restore"] as const;
async function prepareCommand(test: Fixture, command: (typeof commandNames)[number]) {
  let revision = 1;
  if (command === "unarchive") {
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision }, signal)).ok,
    );
    revision++;
  }
  return (commandSignal: AbortSignal) => {
    const input = { id: test.workflow.id, revision };
    switch (command) {
      case "archive":
        return archiveWorkflow(test.db, test.actor, input, commandSignal);
      case "unarchive":
        return unarchiveWorkflow(test.db, test.actor, input, commandSignal);
      case "duplicate":
        return duplicateWorkflow(
          test.db,
          test.actor,
          { ...input, name: "Rollback copy" },
          commandSignal,
        );
      case "restore":
        return restoreWorkflowDraft(
          test.db,
          test.actor,
          { ...input, versionNumber: 1 },
          commandSignal,
        );
    }
  };
}

for (const command of commandNames) {
  it(`LC18 rolls back ${command} and returns a safe result on a database failure`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const invoke = await prepareCommand(test, command);
      const before = await snapshot(test);
      await test.pool.query(`CREATE FUNCTION lifecycle_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'lifecycle-private-database-canary'; END $$;
        CREATE TRIGGER lifecycle_injected_failure AFTER INSERT OR UPDATE ON workflows
        FOR EACH ROW EXECUTE FUNCTION lifecycle_injected_failure()`);
      const result = await invoke(signal);
      expect(result).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_WRITE_FAILED });
      expect(JSON.stringify(result)).not.toContain("lifecycle-private-database-canary");
      expect(await snapshot(test)).toEqual(before);
    } finally {
      await test.close();
    }
  });

  it(`LC18 propagates cancellation and rolls back ${command} before commit`, async () => {
    const test = await setupWorkflowExecution();
    const holder = await test.pool.connect();
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      const invoke = await prepareCommand(test, command);
      const before = await snapshot(test);
      await test.pool.query(`CREATE FUNCTION lifecycle_pause_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(668018); RETURN NEW; END $$;
        CREATE TRIGGER lifecycle_pause_write BEFORE INSERT OR UPDATE ON workflows
        FOR EACH ROW EXECUTE FUNCTION lifecycle_pause_write()`);
      await holder.query("SELECT pg_advisory_lock(668018)");
      const pid = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      pending = invoke(controller.signal);
      const drained = Promise.allSettled([pending]);
      await expect
        .poll(
          async () => {
            const blocked = await test.pool.query<{ blocked: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = current_database() AND $1::int = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type = 'Lock') AS blocked",
              [pid.rows[0]?.pid],
            );
            return blocked.rows[0]?.blocked;
          },
          { timeout: 3000, interval: 10 },
        )
        .toBe(true);
      controller.abort(new DOMException("Lifecycle test cancelled", "AbortError"));
      await holder.query("SELECT pg_advisory_unlock(668018)");
      const [outcome] = await drained;
      expect(outcome?.status).toBe("rejected");
      if (outcome?.status === "rejected") expect(outcome.reason).toBe(controller.signal.reason);
      expect(await snapshot(test)).toEqual(before);
    } finally {
      controller.abort();
      try {
        await holder.query("SELECT pg_advisory_unlock(668018)");
      } finally {
        holder.release();
        if (pending !== undefined) await Promise.allSettled([pending]);
        await test.close();
      }
    }
  }, 15_000);
}

it("LC19 retains immutable-version and same-workflow foreign-key guards after lifecycle commands", async () => {
  const test = await setupWorkflowExecution();
  try {
    const run = await admit(test);
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
        .ok,
    );
    assert(
      (await unarchiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 2 }, signal))
        .ok,
    );
    const copy = await duplicateWorkflow(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 3, name: "Guard copy" },
      signal,
    );
    assert(copy.ok, JSON.stringify(copy));
    assert(
      (
        await restoreWorkflowDraft(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 3, versionNumber: 1 },
          signal,
        )
      ).ok,
    );
    await expect(
      test.pool.query("UPDATE workflow_versions SET name = 'tampered' WHERE id = $1", [
        test.version.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      test.pool.query("DELETE FROM workflow_versions WHERE id = $1", [test.version.id]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      test.pool.query("UPDATE workflows SET published_number = 1 WHERE id = $1", [copy.value.id]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      test.pool.query("UPDATE workflow_runs SET workflow_id = $1 WHERE id = $2", [
        copy.value.id,
        run.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      test.pool.query(
        "UPDATE workflows SET active = true, archived_at = clock_timestamp() WHERE id = $1",
        [test.workflow.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      test.pool.query("UPDATE workflows SET revision = 0 WHERE id = $1", [test.workflow.id]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
    expect((await test.db.select().from(workflowRuns))[0]?.versionId).toBe(test.version.id);
  } finally {
    await test.close();
  }
});

for (const command of commandNames) {
  it(`LC07 authorizes ${command} before exposing stale revisions or hidden state`, async () => {
    const test = await setupWorkflowExecution();
    try {
      if (command === "unarchive")
        assert(
          (
            await archiveWorkflow(
              test.db,
              test.actor,
              { id: test.workflow.id, revision: 1 },
              signal,
            )
          ).ok,
        );
      const [outsiderPermissions] = await test.db
        .insert(permissionSets)
        .values({ name: "Other workflow owner", flags: retryFlags })
        .returning();
      assert(outsiderPermissions !== undefined);
      const other = await seedUser(test.db, { permissionSetId: outsiderPermissions.id });
      const outsider = await hydrateActor(test.db, other.id, signal);
      assert(outsider !== null);
      const invoke = (actor: typeof test.actor, id = test.workflow.id) => {
        // Deliberately stale. A denied actor must not discover that this is a conflict.
        const input = { id, revision: 99 };
        switch (command) {
          case "archive":
            return archiveWorkflow(test.db, actor, input, signal);
          case "unarchive":
            return unarchiveWorkflow(test.db, actor, input, signal);
          case "duplicate":
            return duplicateWorkflow(test.db, actor, { ...input, name: "Hidden source" }, signal);
          case "restore":
            return restoreWorkflowDraft(test.db, actor, { ...input, versionNumber: 1 }, signal);
        }
      };
      const before = await snapshot(test);
      expect(await invoke(outsider)).toEqual(denied);
      expect(await invoke(test.actor, crypto.randomUUID())).toEqual(denied);
      await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
      // test.actor is the same previously active administrator object retained by the caller.
      expect(test.actor.isActive).toBe(true);
      expect(await invoke(test.actor)).toEqual(denied);
      expect(await snapshot(test)).toEqual(before);
    } finally {
      await test.close();
    }
  });
}

for (const restoreFirst of [true, false]) {
  it(`LC12 serializes restoration/publication with ${restoreFirst ? "restore" : "publication"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const changed = structuredClone(test.definition);
      changed.nodes[2]!.config.subject = { kind: "value", value: "Coherent next snapshot" };
      assert(
        (
          await saveWorkflowDraft(
            test.db,
            test.actor,
            { id: test.workflow.id, revision: 1, name: "Coherent next name", definition: changed },
            signal,
          )
        ).ok,
      );
      const restore = (db: Db) =>
        restoreWorkflowDraft(
          db,
          test.actor,
          { id: test.workflow.id, revision: 2, versionNumber: 1 },
          signal,
        );
      const publish = (db: Db) => publishWorkflow(db, test.actor, test.workflow.id, 2, signal);
      if (restoreFirst) {
        const [restored, stalePublication] = await inLockOrder(test, restore, () =>
          publish(test.db),
        );
        expect(restored.ok).toBe(true);
        expect(stalePublication).toEqual(conflict);
        expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
        expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
          revision: 3,
          name: test.version.name,
          draft: test.definition,
          active: true,
          publishedNumber: 1,
        });
      } else {
        const [published, restored] = await inLockOrder(test, publish, () => restore(test.db));
        assert(published.ok, JSON.stringify(published));
        expect(published.value).toMatchObject({
          number: 2,
          name: "Coherent next name",
          definition: changed,
        });
        expect(restored.ok).toBe(true);
        expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
          revision: 3,
          name: test.version.name,
          draft: test.definition,
          active: true,
          publishedNumber: 2,
        });
        expect(
          await test.db.select().from(workflowVersions).orderBy(workflowVersions.number),
        ).toEqual([test.version, published.value]);
      }
    } finally {
      await test.close();
    }
  }, 15_000);
}

for (const duplicateFirst of [true, false]) {
  it(`LC15 serializes duplicate/source-save with ${duplicateFirst ? "duplicate" : "save"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      const changed = structuredClone(test.definition);
      changed.nodes[2]!.config.subject = { kind: "value", value: "Changed saved source" };
      const duplicate = (db: Db) =>
        duplicateWorkflow(
          db,
          test.actor,
          { id: test.workflow.id, revision: 1, name: "Coherent copy" },
          signal,
        );
      const save = (db: Db) =>
        saveWorkflowDraft(
          db,
          test.actor,
          { id: test.workflow.id, revision: 1, name: "Changed source name", definition: changed },
          signal,
        );
      if (duplicateFirst) {
        const [copy, saved] = await inLockOrder(test, duplicate, () => save(test.db));
        assert(copy.ok, JSON.stringify(copy));
        expect(saved.ok).toBe(true);
        expect(copy.value).toMatchObject({
          draft: test.definition,
          name: "Coherent copy",
          active: false,
          publishedNumber: null,
        });
        expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
          revision: 2,
          draft: changed,
          name: "Changed source name",
        });
      } else {
        const [saved, staleCopy] = await inLockOrder(test, save, () => duplicate(test.db));
        expect(saved.ok).toBe(true);
        expect(staleCopy).toEqual(conflict);
        expect(await test.db.select().from(workflows)).toHaveLength(1);
      }
    } finally {
      await test.close();
    }
  }, 15_000);
}

it("LC17 rejects invalid restore versions and duplicate names before writes", async () => {
  const test = await setupWorkflowExecution();
  try {
    const before = await snapshot(test);
    for (const versionNumber of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(
        await restoreWorkflowDraft(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 1, versionNumber },
          signal,
        ),
      ).toEqual(invalid);
    }
    for (const name of ["", "   ", "x".repeat(121)]) {
      expect(
        await duplicateWorkflow(
          test.db,
          test.actor,
          { id: test.workflow.id, revision: 1, name },
          signal,
        ),
      ).toEqual(invalid);
    }
    expect(await snapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("LC07 rehydrates current cancellation authority for archived history and hidden runs", async () => {
  const test = await setupWorkflowExecution();
  try {
    const run = await admit(test);
    assert(
      (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
        .ok,
    );
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({ name: "Other canceller", flags: retryFlags })
      .returning();
    assert(permissions !== undefined);
    const other = await seedUser(test.db, { permissionSetId: permissions.id });
    const outsider = await hydrateActor(test.db, other.id, signal);
    assert(outsider !== null);
    const before = await snapshot(test);
    expect(await cancelWorkflowRun(test.db, outsider, run.id, signal)).toEqual(denied);
    expect(await cancelWorkflowRun(test.db, test.actor, crypto.randomUUID(), signal)).toEqual(
      denied,
    );
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
    expect(await cancelWorkflowRun(test.db, test.actor, run.id, signal)).toEqual(denied);
    expect(await snapshot(test)).toEqual(before);
  } finally {
    await test.close();
  }
});

for (const unarchiveFirst of [true, false]) {
  it(`LC12 serializes unarchive/publication with ${unarchiveFirst ? "unarchive" : "publication"} first`, async () => {
    const test = await setupWorkflowExecution();
    try {
      assert(
        (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision: 1 }, signal))
          .ok,
      );
      const unarchive = (db: Db) =>
        unarchiveWorkflow(db, test.actor, { id: test.workflow.id, revision: 2 }, signal);
      const publish = (db: Db) => publishWorkflow(db, test.actor, test.workflow.id, 2, signal);
      if (unarchiveFirst) {
        const [unarchived, stalePublication] = await inLockOrder(test, unarchive, () =>
          publish(test.db),
        );
        expect(unarchived.ok).toBe(true);
        expect(stalePublication).toEqual(conflict);
      } else {
        const [archivedPublication, unarchived] = await inLockOrder(test, publish, () =>
          unarchive(test.db),
        );
        expect(archivedPublication.ok).toBe(false);
        expect(unarchived.ok).toBe(true);
      }
      expect(await readWorkflow(test, test.workflow.id)).toMatchObject({
        revision: 3,
        active: false,
        archivedAt: null,
        publishedNumber: 1,
        draft: test.definition,
      });
      expect(await test.db.select().from(workflowVersions)).toEqual([test.version]);
    } finally {
      await test.close();
    }
  }, 15_000);
}

it.each(["archive", "unarchive", "restore"] as const)(
  "LC07 denies %s after current edit revocation before revealing revision conflicts",
  async (command) => {
    const test = await setupRetryActor();
    try {
      let revision = 1;
      if (command === "unarchive") {
        assert(
          (await archiveWorkflow(test.db, test.actor, { id: test.workflow.id, revision }, signal))
            .ok,
        );
        revision++;
      }
      await test.db
        .update(permissionSets)
        .set({ flags: { ...retryFlags, "workflow.edit": false } })
        .where(eq(permissionSets.id, test.permissions.id));
      expect(test.actor.flags.has("workflow.edit")).toBe(true);
      const current = await hydrateActor(test.db, test.actor.id, signal);
      assert(current !== null);
      expect(current.type).toBe("regular");
      expect(current.isActive).toBe(true);
      expect(current.flags.has("workflow.view")).toBe(true);
      expect(current.flags.has("workflow.edit")).toBe(false);
      const before = await snapshot(test);
      for (const expectedRevision of [revision, 99]) {
        const input = { id: test.workflow.id, revision: expectedRevision };
        const result =
          command === "archive"
            ? await archiveWorkflow(test.db, test.actor, input, signal)
            : command === "unarchive"
              ? await unarchiveWorkflow(test.db, test.actor, input, signal)
              : await restoreWorkflowDraft(
                  test.db,
                  test.actor,
                  { ...input, versionNumber: 1 },
                  signal,
                );
        expect(result).toEqual(denied);
        expect(await snapshot(test)).toEqual(before);
      }
    } finally {
      await test.close();
    }
  },
);
