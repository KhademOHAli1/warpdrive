import { eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  deals,
  users,
  workflowRunFailures,
  workflowRuns,
  workflows,
} from "@/db/schema";
import {
  admitPublicDuration,
  advancePublicStates,
  armPublicDuration,
  PUBLIC_CASE_TIMEOUT,
  publicAdmissionInput,
  publishPublicDuration,
  readPublicRun,
  withPublicDuration,
} from "./durationPublicAdmission.test-helpers";
import { advanceWorkflowRun } from "./execution";
import {
  databaseInstant,
  expectPinnedVersion,
  fixedInstantDefinition,
  fixedInstantSteps,
  setStoredDeadline,
} from "./fixedInstantWait.test-helpers";
import { saveWorkflowDraft } from "./persistence";
import { getWorkflow } from "./queries";
import { admitManualRun } from "./runAdmission";
import { cancelWorkflowRun } from "./runControl";

it(
  "publicly arms the exact fixed instant durably and leaves early competing deliveries inert",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      // Retain an explicit offset and authored precision that is exactly whole-ms.
      const authored = `${target.toISOString().slice(0, -1)}000+00:00`;
      const version = await publishPublicDuration(test, fixedInstantDefinition(authored), signal);
      const input = publicAdmissionInput(test, "live");
      const admitted = await admitManualRun(test.db, test.actor, input, signal);
      assert(admitted.ok, JSON.stringify(admitted));
      const replay = await admitManualRun(test.db, test.actor, input, signal);
      assert(replay.ok, JSON.stringify(replay));
      expect(replay.value.id).toBe(admitted.value.id);
      const armed = await armPublicDuration(test, admitted.value.id, signal);
      expect(armed.resumeAt).toEqual(target);
      expect(armed.versionId).toBe(version.id);
      const beforeSteps = await fixedInstantSteps(test, admitted.value.id);
      expect(beforeSteps.map((step) => step.nodeId)).toEqual(["start"]);
      expect(await test.db.select().from(activities)).toEqual([]);
      expect(
        await Promise.all([
          advanceWorkflowRun(test.db, admitted.value.id, signal),
          advanceWorkflowRun(test.db, admitted.value.id, signal),
        ]),
      ).toEqual([
        { ok: true, value: "waiting" },
        { ok: true, value: "waiting" },
      ]);
      expect(await readPublicRun(test, admitted.value.id, signal)).toEqual(armed);
      expect(await fixedInstantSteps(test, admitted.value.id)).toEqual(beforeSteps);
      expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
      expect(await test.db.select().from(activities)).toEqual([]);
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "completes an already elapsed instant immediately and emits the requested deadline",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const requested = "2000-01-01T02:00:00.123000+02:00";
      const expected = "2000-01-01T00:00:00.123Z";
      const version = await publishPublicDuration(test, fixedInstantDefinition(requested), signal);
      const run = await admitPublicDuration(test, "live", signal);
      await advancePublicStates(test, run.id, ["running", "running"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "running",
        nextNodeId: "read",
        resumeAt: null,
        outputs: { wait: { resumeAt: expected } },
      });
      const wait = (await fixedInstantSteps(test, run.id)).find((step) => step.nodeId === "wait");
      expect(wait).toMatchObject({ output: { resumeAt: expected }, simulated: false });
      expect(wait?.completedAt.getTime()).toBeGreaterThan(new Date(expected).getTime());
      expect(await test.db.select().from(activities)).toEqual([]);
      await advancePublicStates(test, run.id, ["running", "succeeded", "succeeded"], signal);
      expect(await test.db.select().from(activities)).toHaveLength(1);
      expect(await fixedInstantSteps(test, run.id)).toHaveLength(4);
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "uses the post-lock database clock when an admitted future instant becomes due during contention",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 5000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(target.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, "live", signal);
      expect((await databaseInstant(test)).getTime()).toBeLessThan(target.getTime());
      await advancePublicStates(test, run.id, ["running"], signal);
      const holder = await test.pool.connect();
      let holding = false;
      let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await holder.query("BEGIN");
        holding = true;
        await holder.query("SET LOCAL statement_timeout = '8s'");
        const blocker = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const blockerPid = blocker.rows[0]?.pid;
        assert(blockerPid !== undefined);
        await holder.query("SELECT id FROM workflow_runs WHERE id=$1 FOR UPDATE", [run.id]);
        pending = Promise.allSettled([advanceWorkflowRun(test.db, run.id, signal)]);
        await expect
          .poll(
            async () => {
              signal.throwIfAborted();
              await holder.query("SELECT pg_stat_clear_snapshot()");
              const blocked = await holder.query<{ blocked: boolean }>(
                `SELECT EXISTS (
                  SELECT 1 FROM pg_stat_activity AS a
                  WHERE a.datname=current_database() AND a.state='active'
                    AND a.wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(a.pid))
                    AND a.query ILIKE '%workflow_runs%' AND a.query ILIKE '%for update%'
                ) AS blocked`,
                [blockerPid],
              );
              return blocked.rows[0]?.blocked === true;
            },
            { timeout: 2000, interval: 10 },
          )
          .toBe(true);
        await holder.query(
          `SELECT pg_sleep(GREATEST(0, extract(epoch from
            ($1::timestamptz-clock_timestamp())))+0.01)`,
          [target.toISOString()],
        );
        await holder.query("COMMIT");
        holding = false;
        expect(await pending).toEqual([
          { status: "fulfilled", value: { ok: true, value: "running" } },
        ]);
        expect(await readPublicRun(test, run.id, signal)).toMatchObject({
          status: "running",
          resumeAt: null,
          nextNodeId: "read",
          outputs: { wait: { resumeAt: target.toISOString() } },
        });
        const steps = await fixedInstantSteps(test, run.id);
        expect(steps.map((step) => step.nodeId)).toEqual(["start", "wait"]);
        expect(
          steps.find((step) => step.nodeId === "wait")?.completedAt.getTime(),
        ).toBeGreaterThanOrEqual(target.getTime());
        await expectPinnedVersion(test, version);
      } finally {
        try {
          if (holding) await holder.query("ROLLBACK");
        } finally {
          holder.release();
          if (pending !== undefined) await pending;
        }
      }
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it.each(["live", "simulation"] as const)(
  "keeps %s publication/admission clock-free but rejects an over-cap deadline on first reach",
  async (mode) => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, (525_600 + 60) * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(target.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, mode, signal);
      expect(run).toMatchObject({ status: "queued", resumeAt: null, versionId: version.id });
      await advancePublicStates(test, run.id, ["running", "failed", "failed"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "failed",
        resumeAt: null,
        errorId: ERROR_IDS.WORKFLOW_INVALID,
        nextNodeId: "wait",
      });
      expect((await fixedInstantSteps(test, run.id)).map((step) => step.nodeId)).toEqual(["start"]);
      expect(await test.db.select().from(activities)).toEqual([]);
      const failures = await test.db.select().from(workflowRunFailures);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ originalResumeAt: null, nodeId: "wait" });
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "arms against the database clock even when the application Date clock is far ahead",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      await publishPublicDuration(test, fixedInstantDefinition(target.toISOString()), signal);
      const run = await admitPublicDuration(test, "live", signal);
      const before = await databaseInstant(test);
      try {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
        await advancePublicStates(test, run.id, ["running", "waiting"], signal);
      } finally {
        vi.useRealTimers();
      }
      const after = await databaseInstant(test);
      const armed = await readPublicRun(test, run.id, signal);
      expect(armed.resumeAt).toEqual(target);
      expect(armed.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(armed.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect((await fixedInstantSteps(test, run.id)).map((step) => step.nodeId)).toEqual(["start"]);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "keeps unarmed and armed runs pinned to their immutable version through draft edits and N+1 publication",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const firstTarget = await databaseInstant(test, 10 * 60_000);
      const first = await publishPublicDuration(
        test,
        fixedInstantDefinition(firstTarget.toISOString()),
        signal,
      );
      const firstRun = await admitPublicDuration(test, "live", signal);
      const secondTarget = await databaseInstant(test, 20 * 60_000);
      const second = await publishPublicDuration(
        test,
        fixedInstantDefinition(secondTarget.toISOString()),
        signal,
      );
      expect(second.number).toBe(first.number + 1);
      const secondRun = await admitPublicDuration(test, "live", signal);
      const firstArmed = await armPublicDuration(test, firstRun.id, signal);
      const secondArmed = await armPublicDuration(test, secondRun.id, signal);
      expect(firstArmed).toMatchObject({ versionId: first.id, resumeAt: firstTarget });
      expect(secondArmed).toMatchObject({ versionId: second.id, resumeAt: secondTarget });
      const current = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
      assert(current.ok, JSON.stringify(current));
      const saved = await saveWorkflowDraft(
        test.db,
        test.actor,
        {
          id: test.workflow.id,
          revision: current.value.revision,
          name: current.value.name,
          definition: fixedInstantDefinition("2099-01-01T00:00:00.000Z"),
        },
        signal,
      );
      assert(saved.ok, JSON.stringify(saved));
      await advancePublicStates(test, firstRun.id, ["waiting", "waiting"], signal);
      await advancePublicStates(test, secondRun.id, ["waiting"], signal);
      expect(await readPublicRun(test, firstRun.id, signal)).toEqual(firstArmed);
      expect(await readPublicRun(test, secondRun.id, signal)).toEqual(secondArmed);
      await expectPinnedVersion(test, first);
      await expectPinnedVersion(test, second);
      expect(await test.db.select().from(activities)).toEqual([]);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "does not rearm or reapply the initial cap to an already stored clock-back wait",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const requested = await databaseInstant(test, 10 * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(requested.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      const stored = await databaseInstant(test, 2 * 525_600 * 60_000);
      await setStoredDeadline(test, run.id, stored);
      const before = await readPublicRun(test, run.id, signal);
      const beforeSteps = await fixedInstantSteps(test, run.id);
      await advancePublicStates(test, run.id, ["waiting", "waiting"], signal);
      expect(await readPublicRun(test, run.id, signal)).toEqual(before);
      expect(await fixedInstantSteps(test, run.id)).toEqual(beforeSteps);
      expect(await test.db.select().from(workflowRunFailures)).toEqual([]);
      expect(await test.db.select().from(activities)).toEqual([]);
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "completes one stored due deadline under repeated competing claims and creates one downstream effect",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const requested = await databaseInstant(test, 10 * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(requested.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      const due = await databaseInstant(test, -1000);
      await setStoredDeadline(test, run.id, due);
      for (let index = 0; index < 4; index++) {
        await Promise.all([
          advanceWorkflowRun(test.db, run.id, signal),
          advanceWorkflowRun(test.db, run.id, signal),
        ]);
      }
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        nextNodeId: null,
        versionId: version.id,
        outputs: { wait: { resumeAt: due.toISOString() } },
      });
      const steps = await fixedInstantSteps(test, run.id);
      expect(steps).toHaveLength(4);
      expect(steps.filter((step) => step.nodeId === "wait")).toHaveLength(1);
      expect(steps.find((step) => step.nodeId === "wait")?.output).toEqual({
        resumeAt: due.toISOString(),
      });
      const tasks = await test.db.select().from(activities);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ dealId: test.deal.id, assigneeId: test.actor.id });
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it.each(["cancel", "archive", "inactive actor"] as const)(
  "preserves the %s fence on a fixed-instant wait before its deadline",
  async (fence) => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(target.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      const beforeSteps = await fixedInstantSteps(test, run.id);
      if (fence === "cancel") {
        expect(await cancelWorkflowRun(test.db, test.actor, run.id, signal)).toEqual({
          ok: true,
          value: "cancelled",
        });
      } else if (fence === "archive") {
        await test.db
          .update(workflows)
          .set({ active: false, archivedAt: await databaseInstant(test) })
          .where(eq(workflows.id, test.workflow.id));
      } else {
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
      }
      const status = fence === "cancel" ? "cancelled" : "failed";
      await advancePublicStates(test, run.id, [status, status], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status,
        resumeAt: null,
        versionId: version.id,
        ...(fence === "cancel"
          ? { cancelledBy: test.actor.id }
          : { errorId: ERROR_IDS.WORKFLOW_DENIED }),
      });
      expect(await fixedInstantSteps(test, run.id)).toEqual(beforeSteps);
      expect(await test.db.select().from(activities)).toEqual([]);
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "rereads downstream effect authority without deriving a new deadline from changed CRM data",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      await publishPublicDuration(test, fixedInstantDefinition(target.toISOString()), signal);
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      await test.db
        .update(deals)
        .set({ deletedAt: await databaseInstant(test) })
        .where(eq(deals.id, test.deal.id));
      const due = await databaseInstant(test, -1000);
      await setStoredDeadline(test, run.id, due);
      await advancePublicStates(test, run.id, ["running", "failed", "failed"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "failed",
        resumeAt: null,
        outputs: { wait: { resumeAt: due.toISOString() } },
      });
      expect(await test.db.select().from(activities)).toEqual([]);
      expect((await fixedInstantSteps(test, run.id)).map((step) => step.nodeId)).toEqual([
        "start",
        "wait",
      ]);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "projects the requested fixed instant in simulation and rolls back downstream activity writes",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(target.toISOString()),
        signal,
      );
      const beforeDeal = await test.db.select().from(deals).where(eq(deals.id, test.deal.id));
      const run = await admitPublicDuration(test, "simulation", signal);
      await advancePublicStates(
        test,
        run.id,
        ["running", "running", "running", "succeeded"],
        signal,
      );
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        outputs: { wait: { resumeAt: target.toISOString() } },
      });
      const steps = await fixedInstantSteps(test, run.id);
      expect(steps).toHaveLength(4);
      expect(steps.every((step) => step.simulated)).toBe(true);
      expect(steps.find((step) => step.nodeId === "wait")?.output).toEqual({
        resumeAt: target.toISOString(),
      });
      expect(steps.find((step) => step.nodeId === "task")?.output.id).toEqual(expect.any(String));
      expect(await test.db.select().from(activities)).toEqual([]);
      expect(await test.db.select().from(deals).where(eq(deals.id, test.deal.id))).toEqual(
        beforeDeal,
      );
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "rolls back a due fixed-instant receipt and cursor together when persistence fails",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const target = await databaseInstant(test, 10 * 60_000);
      const version = await publishPublicDuration(
        test,
        fixedInstantDefinition(target.toISOString()),
        signal,
      );
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      const due = await databaseInstant(test, -1000);
      await setStoredDeadline(test, run.id, due);
      const before = await readPublicRun(test, run.id, signal);
      const beforeSteps = await fixedInstantSteps(test, run.id);
      await test.pool.query(`CREATE FUNCTION fail_fixed_wait_cursor() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.status='waiting' AND NEW.status='running' THEN
            RAISE EXCEPTION 'synthetic fixed instant cursor failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER fail_fixed_wait_cursor BEFORE UPDATE ON workflow_runs
        FOR EACH ROW EXECUTE FUNCTION fail_fixed_wait_cursor()`);
      try {
        await expect(advanceWorkflowRun(test.db, run.id, signal)).rejects.toThrow();
        expect(await readPublicRun(test, run.id, signal)).toEqual(before);
        expect(await fixedInstantSteps(test, run.id)).toEqual(beforeSteps);
        expect(await test.db.select().from(activities)).toEqual([]);
      } finally {
        await test.pool.query("DROP TRIGGER fail_fixed_wait_cursor ON workflow_runs");
      }
      await advancePublicStates(test, run.id, ["running", "running", "succeeded"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        outputs: { wait: { resumeAt: due.toISOString() } },
      });
      expect(await test.db.select().from(activities)).toHaveLength(1);
      expect(await fixedInstantSteps(test, run.id)).toHaveLength(4);
      await expectPinnedVersion(test, version);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);
