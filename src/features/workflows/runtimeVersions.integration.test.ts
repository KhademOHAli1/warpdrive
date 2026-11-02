import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities } from "@/db/schema";
import { advanceWorkflowRun } from "./execution";
import {
  RUNTIME_CASE_TIMEOUT,
  type RuntimeVersionCase,
  runtimeRun,
  runtimeSteps,
  withRuntimeVersion,
} from "./runtimeVersions.test-helpers";

const rejectedCases: RuntimeVersionCase[] = [
  {
    label: "schema version 2 at a queued delay cursor",
    schemaVersion: 2,
    delayNodeVersion: 1,
    phase: "queued",
  },
  {
    label: "delay node version 2 at a queued delay cursor",
    schemaVersion: 1,
    delayNodeVersion: 2,
    phase: "queued",
  },
  {
    label: "schema version string 1 during an early wait",
    schemaVersion: "1",
    delayNodeVersion: 1,
    phase: "early",
  },
  {
    label: "delay node version string 1 during a due wait",
    schemaVersion: 1,
    delayNodeVersion: "1",
    phase: "due",
  },
];

it.each(rejectedCases)(
  "fails closed for stored $label without new progress or effects",
  async (input) => {
    await withRuntimeVersion(input, async (test, signal) => {
      const before = await runtimeRun(test, signal);
      const steps = await runtimeSteps(test, signal);
      expect(steps).toHaveLength(1);
      expect(await test.db.select().from(activities)).toHaveLength(0);
      expect(await advanceWorkflowRun(test.db, test.run.id, signal)).toEqual({
        ok: true,
        value: "failed",
      });
      const after = await runtimeRun(test, signal);
      expect(after).toMatchObject({
        status: "failed",
        resumeAt: null,
        versionId: before.versionId,
        actorId: before.actorId,
        workflowId: before.workflowId,
      });
      expect(after.errorId).toBe(ERROR_IDS.WORKFLOW_INVALID);
      expect(after.trigger).toEqual(before.trigger);
      expect(after.outputs).toEqual(before.outputs);
      expect(await runtimeSteps(test, signal)).toEqual(steps);
      expect(await test.db.select().from(activities)).toHaveLength(0);
      // A stale delivery after failure must not add the rejected wait step or its task.
      expect(await advanceWorkflowRun(test.db, test.run.id, signal)).toEqual({
        ok: true,
        value: "failed",
      });
      expect(await runtimeSteps(test, signal)).toEqual(steps);
      expect(await test.db.select().from(activities)).toHaveLength(0);
    });
  },
  RUNTIME_CASE_TIMEOUT,
);

it(
  "executes the numeric-v1 due-wait control from the same pre-existing-run fixture",
  async () => {
    await withRuntimeVersion(
      { schemaVersion: 1, delayNodeVersion: 1, phase: "due" },
      async (test, signal) => {
        // Supported stored-runtime execution is independent of new-run admission.
        // A version fence must preserve this supported pre-existing durable run.
        for (const value of ["running", "running", "succeeded"]) {
          expect(await advanceWorkflowRun(test.db, test.run.id, signal)).toEqual({
            ok: true,
            value,
          });
        }
        expect(await runtimeRun(test, signal)).toMatchObject({
          status: "succeeded",
          resumeAt: null,
          versionId: test.version.id,
        });
        expect((await runtimeSteps(test, signal)).map((step) => step.nodeId).sort()).toEqual([
          "read",
          "start",
          "task",
          "wait",
        ]);
        const tasks = await test.db.select().from(activities);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          subject: test.deal.title,
          dealId: test.deal.id,
          ownerId: test.actor.id,
          assigneeId: test.actor.id,
        });
      },
    );
  },
  RUNTIME_CASE_TIMEOUT,
);
