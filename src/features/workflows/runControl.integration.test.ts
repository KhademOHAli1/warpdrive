import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { cancelWorkflowRun } from "./runControl";

const signal = new AbortController().signal;
const requestKey = "5ac63a9e-9e40-491b-9308-9ddd70b0336d";

it("cancels persisted work before an effect and records the cancelling identity", async () => {
  const test = await setupWorkflowExecution();
  try {
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "live" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    for (let i = 0; i < 2; i++) await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect(await cancelWorkflowRun(test.db, test.actor, admitted.value.id, signal)).toEqual({
      ok: true,
      value: "cancelled",
    });
    await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(0);
    const [run] = await test.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, admitted.value.id));
    expect(run?.cancelledBy).toBe(test.actor.id);
    expect(run?.cancelledAt).toBeInstanceOf(Date);
  } finally {
    await test.close();
  }
});

it("retains an invalid record literal as a draft while rejecting publication without replacing the current version", async () => {
  const test = await setupWorkflowExecution();
  try {
    const definition = structuredClone(test.definition);
    const read = definition.nodes.find((node) => node.id === "read");
    if (read === undefined) throw new Error("Missing read fixture");
    read.config.recordId = { kind: "value", value: "not-a-uuid" };
    const saved = await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1, name: "Invalid mapping", definition },
      signal,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.value.revision).toBe(2);
    expect(saved.value.draft).toStrictEqual(definition);
    expect(
      await publishWorkflow(test.db, test.actor, test.workflow.id, saved.value.revision, signal),
    ).toStrictEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    const [current] = await test.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, test.workflow.id));
    expect(current).toStrictEqual(saved.value);
    expect(current?.revision).toBe(saved.value.revision);
    expect(current?.draft).toStrictEqual(definition);
    expect(current?.publishedNumber).toBe(test.version.number);
    const versions = await test.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, test.workflow.id));
    expect(versions).toStrictEqual([test.version]);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
    expect(await test.db.select().from(workflowSteps)).toHaveLength(0);
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("fails a malformed persisted mapped identifier before mapped record lookup or effects", async () => {
  const test = await setupWorkflowExecution();
  try {
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "live" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    expect(await advanceWorkflowRun(test.db, admitted.value.id, signal)).toStrictEqual({
      ok: true,
      value: "running",
    });
    const [running] = await test.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, admitted.value.id));
    expect(running?.nextNodeId).toBe("read");
    expect(running?.outputs.start).toStrictEqual({ recordId: test.deal.id });
    if (running === undefined) throw new Error("Missing admitted run");
    // Corrupt only the persisted source value, preserving the admitted immutable
    // definition and actual cursor. No invalid definition bypasses publication.
    await test.db
      .update(workflowRuns)
      .set({
        outputs: { ...running.outputs, start: { recordId: "not-a-uuid" } },
      })
      .where(eq(workflowRuns.id, running.id));
    expect(await advanceWorkflowRun(test.db, admitted.value.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    const [run] = await test.db.select().from(workflowRuns);
    expect(run?.errorId).toBe(ERROR_IDS.WORKFLOW_INVALID);
    expect(run?.outputs.start).toStrictEqual({ recordId: "not-a-uuid" });
    expect(run?.trigger).toStrictEqual({ recordId: test.deal.id });
    expect(run?.versionId).toBe(test.version.id);
    const receipts = await test.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, admitted.value.id));
    expect(receipts.map((step) => step.nodeId)).toStrictEqual(["start"]);
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});
