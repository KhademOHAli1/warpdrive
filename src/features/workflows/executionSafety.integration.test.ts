import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, deals, permissionSets, users, workflowRuns } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";

const signal = new AbortController().signal;
const requestKey = "481a5947-e6c4-4e95-b627-5528bba98e97";

it("rejects reuse of an admission key for a different execution mode", async () => {
  const test = await setupWorkflowExecution();
  try {
    const input = {
      workflowId: test.workflow.id,
      requestKey,
      recordId: test.deal.id,
      mode: "simulation",
    };
    expect((await admitManualRun(test.db, test.actor, input, signal)).ok).toBe(true);
    expect(await admitManualRun(test.db, test.actor, { ...input, mode: "live" }, signal)).toEqual({
      ok: false,
      error: "E_WORKFLOW_003",
    });
    expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("uses the same archived-deal validation for simulation and actual activity creation", async () => {
  const test = await setupWorkflowExecution();
  try {
    await test.db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, test.deal.id));
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "simulation" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("failed");
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("rolls back an activity if persisting its progress fails, then retries without duplication", async () => {
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
    await test.pool.query(
      "ALTER TABLE workflow_steps ADD CONSTRAINT workflow_test_failure CHECK (node_id <> 'task')",
    );
    await expect(advanceWorkflowRun(test.db, admitted.value.id, signal)).rejects.toThrow();
    expect(await test.db.select().from(activities)).toHaveLength(0);
    expect((await test.db.select().from(workflowRuns))[0]?.nextNodeId).toBe("task");
    await test.pool.query("ALTER TABLE workflow_steps DROP CONSTRAINT workflow_test_failure");
    await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect(await test.db.select().from(activities)).toHaveLength(1);
    expect((await test.db.select().from(workflowRuns))[0]?.status).toBe("succeeded");
  } finally {
    await test.close();
  }
});

it("rehydrates downgraded authority and does not expose another owner's hidden deal", async () => {
  const test = await setupWorkflowExecution();
  try {
    const other = await seedUser(test.db);
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({ name: "Workflow tester", flags: { "workflow.run": true, "activity.create": true } })
      .returning();
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: permissions!.id })
      .where(eq(users.id, test.user.id));
    await test.db.update(deals).set({ ownerId: other.id }).where(eq(deals.id, test.deal.id));
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "live" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, admitted.value.id, signal);
    const [run] = await test.db.select().from(workflowRuns);
    expect(run?.status).toBe("failed");
    expect(JSON.stringify(run?.outputs)).not.toContain(test.deal.title);
    expect(await test.db.select().from(activities)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("refuses publishing configuration that the initial executor does not implement", async () => {
  const test = await setupWorkflowExecution();
  try {
    const definition = structuredClone(test.definition);
    Object.assign(definition.nodes[2]!.config, {
      dueAt: { kind: "value", value: "2026-11-01T09:00:00Z" },
    });
    const created = await createWorkflow(
      test.db,
      test.actor,
      { name: "Not ready", definition },
      signal,
    );
    if (!created.ok) throw new Error(created.error);
    expect(await publishWorkflow(test.db, test.actor, created.value.id, 1, signal)).toEqual({
      ok: false,
      error: "E_WORKFLOW_005",
    });
  } finally {
    await test.close();
  }
});

it("keeps a queued run on its original published definition after a new version is activated", async () => {
  const test = await setupWorkflowExecution();
  try {
    const admitted = await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode: "live" },
      signal,
    );
    if (!admitted.ok) throw new Error(admitted.error);
    const definition = structuredClone(test.definition);
    definition.nodes[2]!.config.subject = { kind: "value", value: "Neue Aufgabe" };
    await saveWorkflowDraft(
      test.db,
      test.actor,
      { id: test.workflow.id, revision: 1, name: "New version", definition },
      signal,
    );
    await publishWorkflow(test.db, test.actor, test.workflow.id, 2, signal);
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, admitted.value.id, signal);
    expect((await test.db.select().from(activities))[0]?.subject).toBe("تماس با مشتری");
    expect((await test.db.select().from(workflowRuns))[0]?.versionId).toBe(test.version.id);
  } finally {
    await test.close();
  }
});
