import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, workflowRuns } from "@/db/schema";
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

it("fails malformed mapped record identifiers as an operational result before SQL execution", async () => {
  const test = await setupWorkflowExecution();
  try {
    const definition = structuredClone(test.definition);
    definition.nodes[1]!.config.recordId = { kind: "value", value: "not-a-uuid" };
    await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1, name: "Invalid mapping", definition },
      signal,
    );
    await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal);
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "live" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect(await advanceWorkflowRun(test.db, admitted.value.id, signal)).toEqual({
      ok: true,
      value: "failed",
    });
    const [run] = await test.db.select().from(workflowRuns);
    expect(run?.errorId).toBe("E_WORKFLOW_002");
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});
