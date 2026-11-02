import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, deals, workflowRuns, workflowSteps, workflows } from "@/db/schema";
import {
  admitPublicDuration,
  advancePublicStates,
  armPublicDuration,
  finishPublicDuration,
  makePublicDurationDue,
  PUBLIC_CASE_TIMEOUT,
  publicAdmissionInput,
  publicDurationDefinition,
  publishPublicDuration,
  readPublicRun,
  withPublicDuration,
} from "./durationPublicAdmission.test-helpers";
import { getWorkflow, pauseWorkflow } from "./queries";
import { admitManualRun } from "./runAdmission";

it(
  "publicly admits a literal live wait, rereads the deal, and creates a linked assigned task",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const version = await publishPublicDuration(test, publicDurationDefinition(1), signal);
      const run = await admitPublicDuration(test, "live", signal);
      expect(run).toMatchObject({
        status: "queued",
        versionId: version.id,
        actorId: test.actor.id,
      });
      await armPublicDuration(test, run.id, signal);
      expect(await test.db.select().from(activities)).toHaveLength(0);
      const title = "Changed during the public wait";
      await test.db.update(deals).set({ title }).where(eq(deals.id, test.deal.id));
      await makePublicDurationDue(test, run.id, signal);
      await advancePublicStates(test, run.id, ["running"], signal);
      expect((await readPublicRun(test, run.id, signal)).nextNodeId).toBe("read");
      await advancePublicStates(test, run.id, ["running"], signal);
      const steps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.id));
      expect(steps.find((step) => step.nodeId === "read")?.output.title).toBe(title);
      await advancePublicStates(test, run.id, ["succeeded"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        versionId: version.id,
      });
      const tasks = await test.db.select().from(activities);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        subject: title,
        dealId: test.deal.id,
        ownerId: test.actor.id,
        assigneeId: test.actor.id,
      });
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "publicly admits simulation and completes the wait immediately while rolling the task back",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const version = await publishPublicDuration(test, publicDurationDefinition(1), signal);
      const run = await admitPublicDuration(test, "simulation", signal);
      expect(run.versionId).toBe(version.id);
      await advancePublicStates(
        test,
        run.id,
        ["running", "running", "running", "succeeded"],
        signal,
      );
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        mode: "simulation",
        resumeAt: null,
      });
      expect(await test.db.select().from(activities)).toHaveLength(0);
      const steps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.id));
      expect(steps).toHaveLength(4);
      expect(steps.find((step) => step.nodeId === "wait")).toMatchObject({
        simulated: true,
        output: { resumeAt: expect.any(String) },
      });
      expect(steps.find((step) => step.nodeId === "task")).toMatchObject({
        simulated: true,
        output: { id: expect.any(String) },
      });
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "keeps an armed run pinned to N after changed N+1 publication and admits the new version",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const first = await publishPublicDuration(
        test,
        publicDurationDefinition(1, {
          kind: "value",
          value: "Task from version N",
        }),
        signal,
      );
      const oldRun = await admitPublicDuration(test, "live", signal);
      const armed = await armPublicDuration(test, oldRun.id, signal);
      const deadline = armed.resumeAt?.toISOString();
      const second = await publishPublicDuration(
        test,
        publicDurationDefinition(2, {
          kind: "value",
          value: "Task from version N+1",
        }),
        signal,
      );
      expect(second.number).toBe(first.number + 1);
      expect(second.id).not.toBe(first.id);
      const stillArmed = await readPublicRun(test, oldRun.id, signal);
      expect(stillArmed).toMatchObject({
        status: "waiting",
        nextNodeId: "wait",
        versionId: first.id,
      });
      expect(stillArmed.resumeAt?.toISOString()).toBe(deadline);
      const newRun = await admitPublicDuration(test, "live", signal);
      expect(newRun.id).not.toBe(oldRun.id);
      expect(newRun.versionId).toBe(second.id);
      await armPublicDuration(test, newRun.id, signal);
      expect(await finishPublicDuration(test, oldRun.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        versionId: first.id,
      });
      expect(await finishPublicDuration(test, newRun.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
        versionId: second.id,
      });
      const tasks = await test.db.select().from(activities);
      expect(tasks).toHaveLength(2);
      expect(tasks.map((task) => task.subject).sort()).toEqual([
        "Task from version N",
        "Task from version N+1",
      ]);
      expect(
        tasks.every((task) => task.dealId === test.deal.id && task.assigneeId === test.actor.id),
      ).toBe(true);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "continues an already armed wait after public pause while denying a new admission",
  async () => {
    await withPublicDuration(async (test, signal) => {
      await publishPublicDuration(test, publicDurationDefinition(1), signal);
      const run = await admitPublicDuration(test, "live", signal);
      const armed = await armPublicDuration(test, run.id, signal);
      const current = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
      assert(current.ok, JSON.stringify(current));
      const paused = await pauseWorkflow(
        test.db,
        test.actor,
        test.workflow.id,
        current.value.revision,
        signal,
      );
      assert(paused.ok, JSON.stringify(paused));
      expect(paused.value.active).toBe(false);
      expect(await readPublicRun(test, run.id, signal)).toEqual(armed);
      expect(
        await admitManualRun(test.db, test.actor, publicAdmissionInput(test, "live"), signal),
      ).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_DENIED,
      });
      expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
      expect(await finishPublicDuration(test, run.id, signal)).toMatchObject({
        status: "succeeded",
        resumeAt: null,
      });
      const tasks = await test.db.select().from(activities);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ dealId: test.deal.id, assigneeId: test.actor.id });
      const after = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
      assert(after.ok, JSON.stringify(after));
      expect(after.value.active).toBe(false);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);

it(
  "fails an armed public run at the intentional archive fence and clears its deadline",
  async () => {
    await withPublicDuration(async (test, signal) => {
      const version = await publishPublicDuration(test, publicDurationDefinition(1), signal);
      const run = await admitPublicDuration(test, "live", signal);
      await armPublicDuration(test, run.id, signal);
      const beforeSteps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.id));
      // No public archive service exists. This fixture preserves the SQL active/archive invariant.
      await test.db
        .update(workflows)
        .set({ active: false, archivedAt: new Date() })
        .where(eq(workflows.id, test.workflow.id));
      await advancePublicStates(test, run.id, ["failed"], signal);
      expect(await readPublicRun(test, run.id, signal)).toMatchObject({
        status: "failed",
        resumeAt: null,
        errorId: ERROR_IDS.WORKFLOW_DENIED,
        versionId: version.id,
      });
      await advancePublicStates(test, run.id, ["failed"], signal);
      expect(await test.db.select().from(activities)).toHaveLength(0);
      expect(
        await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id)),
      ).toEqual(beforeSteps);
      expect(
        await admitManualRun(test.db, test.actor, publicAdmissionInput(test, "live"), signal),
      ).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_DENIED,
      });
      expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
    });
  },
  PUBLIC_CASE_TIMEOUT,
);
