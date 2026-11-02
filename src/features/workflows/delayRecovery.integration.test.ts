import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";
import { activities, workflowRuns, workflowSteps } from "@/db/schema";
import { enterWait, makeDue, setupWaitingCandidate } from "./delay.test-helpers";
import { advanceWorkflowRun } from "./execution";
import { cancelWorkflowRun } from "./runControl";
import { readRunDetail } from "./runDetail";
import { reconcileWorkflowRuns, registerWorkflowJobs } from "./worker";

const signal = new AbortController().signal;

it("arms exactly one minute from the database clock after the current node is locked", async () => {
  const test = await setupWaitingCandidate();
  try {
    const holder = await test.pool.connect();
    const advanceSignal = AbortSignal.timeout(5000);
    let holding = false;
    let pendingAdvance: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      holding = true;
      await holder.query("SET LOCAL statement_timeout = '2s'");
      const blocker = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const blockerPid = blocker.rows[0]?.pid;
      expect(blockerPid).toBeGreaterThan(0);
      await holder.query("SELECT id FROM workflow_runs WHERE id = $1 FOR UPDATE", [test.run.id]);
      // Attach rejection handling immediately so barrier failures can still drain the advance.
      pendingAdvance = Promise.allSettled([
        advanceWorkflowRun(test.db, test.run.id, advanceSignal),
      ]);
      await expect
        .poll(
          async () => {
            advanceSignal.throwIfAborted();
            await holder.query("SELECT pg_stat_clear_snapshot()");
            const blocked = await holder.query<{ blocked: boolean }>(
              `SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity AS a
                WHERE a.datname = current_database() AND a.state = 'active'
                  AND a.wait_event_type = 'Lock' AND $1::int = ANY(pg_blocking_pids(a.pid))
                  AND a.query ILIKE '%workflow_runs%' AND a.query ILIKE '%for update%'
              ) AS blocked`,
              [blockerPid],
            );
            advanceSignal.throwIfAborted();
            return blocked.rows[0]?.blocked === true;
          },
          { timeout: 2000, interval: 10 },
        )
        .toBe(true);
      // Keep the verified contention long enough to distinguish a pre-lock clock sample.
      await holder.query("SELECT pg_sleep(0.05)");
      const released = await holder.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      await holder.query("COMMIT");
      holding = false;
      expect(await pendingAdvance).toEqual([
        { status: "fulfilled", value: { ok: true, value: "waiting" } },
      ]);
      const after = await test.pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const deadline = await test.pool.query<{ resume_at: Date | null }>(
        "SELECT resume_at FROM workflow_runs WHERE id = $1",
        [test.run.id],
      );
      const at = deadline.rows[0]?.resume_at?.getTime();
      expect(at).toBeGreaterThanOrEqual((released.rows[0]?.now.getTime() ?? Number.NaN) + 60_000);
      expect(at).toBeLessThanOrEqual((after.rows[0]?.now.getTime() ?? Number.NaN) + 60_000);
    } finally {
      try {
        if (holding) await holder.query("ROLLBACK");
      } finally {
        try {
          holder.release();
        } finally {
          if (pendingAdvance !== undefined) await pendingAdvance;
        }
      }
    }
  } finally {
    await test.close();
  }
});

it("recovers an expired persisted wait on worker boot through real pg-boss", async () => {
  const test = await setupWaitingCandidate();
  const boss = new PgBoss({ connectionString: test.url, maintenanceIntervalSeconds: 1 });
  boss.on("error", () => undefined);
  try {
    await enterWait(test);
    await makeDue(test);
    await boss.start();
    await registerWorkflowJobs(boss, test.db);
    await expect
      .poll(
        async () => {
          const [run] = await test.db
            .select()
            .from(workflowRuns)
            .where(eq(workflowRuns.id, test.run.id));
          return run?.status;
        },
        { timeout: 15_000 },
      )
      .toBe("succeeded");
    expect(await test.db.select().from(activities)).toHaveLength(1);
  } finally {
    try {
      await boss.stop();
    } finally {
      await test.close();
    }
  }
});

it("excludes one hundred future waits before selecting due reconciliation work", async () => {
  const test = await setupWaitingCandidate();
  const boss = new PgBoss({ connectionString: test.url });
  boss.on("error", () => undefined);
  try {
    await enterWait(test);
    await makeDue(test);
    await test.db.insert(workflowRuns).values(
      Array.from({ length: 100 }, () => ({
        workflowId: test.workflow.id,
        versionId: test.waitingVersion.id,
        actorId: test.actor.id,
        requestKey: crypto.randomUUID(),
        mode: "live" as const,
        status: "waiting" as const,
        trigger: { recordId: test.deal.id },
        nextNodeId: "wait",
        resumeAt: new Date("2099-01-01T00:00:00Z"),
        updatedAt: new Date("2000-01-01T00:00:00Z"),
      })),
    );
    await boss.start();
    await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RUN);
    await reconcileWorkflowRuns(boss, test.db, signal);
    const jobs = await boss.fetch<{ runId: string }>(PGBOSS_QUEUE_WORKFLOW_RUN, { batchSize: 100 });
    expect(jobs.map((job) => job.data.runId)).toEqual([test.run.id]);
  } finally {
    try {
      await boss.stop();
    } finally {
      await test.close();
    }
  }
});

it("serializes a due transition and cancellation without allowing a later effect", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await makeDue(test);
    await Promise.all([
      advanceWorkflowRun(test.db, test.run.id, signal),
      cancelWorkflowRun(test.db, test.actor, test.run.id, signal),
    ]);
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, test.run.id, signal);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("cancelled");
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("reserves discovery capacity for due waits when older ready runs do not progress", async () => {
  const test = await setupWaitingCandidate();
  const boss = new PgBoss({ connectionString: test.url });
  boss.on("error", () => undefined);
  try {
    await enterWait(test);
    await makeDue(test);
    await test.db.insert(workflowRuns).values(
      Array.from({ length: 100 }, () => ({
        workflowId: test.workflow.id,
        versionId: test.waitingVersion.id,
        actorId: test.actor.id,
        requestKey: crypto.randomUUID(),
        mode: "live" as const,
        status: "queued" as const,
        trigger: { recordId: test.deal.id },
        nextNodeId: "start",
        updatedAt: new Date("2000-01-01T00:00:00Z"),
      })),
    );
    await boss.start();
    await boss.createQueue(PGBOSS_QUEUE_WORKFLOW_RUN);
    await reconcileWorkflowRuns(boss, test.db, signal);
    const jobs = await boss.fetch<{ runId: string }>(PGBOSS_QUEUE_WORKFLOW_RUN, { batchSize: 100 });
    expect(jobs.map((job) => job.data.runId)).toContain(test.run.id);
    expect(jobs).toHaveLength(100);
    expect(new Set(jobs.map((job) => job.data.runId)).size).toBe(100);
  } finally {
    try {
      await boss.stop();
    } finally {
      await test.close();
    }
  }
});

it("rolls back a completed wait step when persisting its next cursor fails", async () => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await makeDue(test);
    const [before] = await test.db.select().from(workflowRuns);
    await test.pool.query(`CREATE FUNCTION fail_wait_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.status = 'waiting' AND NEW.status = 'running' THEN
        RAISE EXCEPTION 'synthetic wait cursor failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_wait_cursor BEFORE UPDATE ON workflow_runs
      FOR EACH ROW EXECUTE FUNCTION fail_wait_cursor()`);
    await expect(advanceWorkflowRun(test.db, test.run.id, signal)).rejects.toThrow();
    expect((await test.db.select().from(workflowRuns))[0]).toEqual(before);
    expect(await test.db.select().from(workflowSteps)).toHaveLength(1);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    await test.pool.query("DROP TRIGGER fail_wait_cursor ON workflow_runs");
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, test.run.id, signal);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("succeeded");
    expect(await test.db.select().from(activities)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it.each([
  "resume_at = NULL",
  "resume_at = 'infinity'::timestamptz",
  "next_node_id = NULL",
  "status = 'running'",
])("rejects inconsistent persisted wait state: %s", async (assignment) => {
  const test = await setupWaitingCandidate();
  try {
    await enterWait(test);
    await expect(
      test.pool.query(`UPDATE workflow_runs SET ${assignment} WHERE id = $1`, [test.run.id]),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await test.close();
  }
});

it("exposes only validated wait timing metadata and keeps stored outputs private", async () => {
  const test = await setupWaitingCandidate("simulation");
  try {
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, test.run.id, signal);
    await test.db
      .update(workflowSteps)
      .set({ output: { resumeAt: "2026-11-01T10:01:00.000Z", secret: "private CRM value" } })
      .where(eq(workflowSteps.nodeId, "start"));
    const detail = await readRunDetail(test.db, test.actor, test.workflow.id, test.run.id, signal);
    if (!detail.ok) throw new Error(detail.error);
    const wait = detail.value.steps.find((step) => step.nodeId === "wait");
    const start = detail.value.steps.find((step) => step.nodeId === "start");
    expect(wait?.waitResumeAt).toBeInstanceOf(Date);
    expect(start).not.toHaveProperty("waitResumeAt");
    expect(detail.value).not.toHaveProperty("outputs");
    expect(detail.value.steps.every((step) => !Object.hasOwn(step, "output"))).toBe(true);
    expect(JSON.stringify(detail.value)).not.toContain("private CRM value");
  } finally {
    await test.close();
  }
});
