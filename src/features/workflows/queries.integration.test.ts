import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { workflows } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { admitManualRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { getWorkflow, listWorkflows, pauseWorkflow, readRunHistory } from "./queries";

const signal = new AbortController().signal;
it("authorizes workflow reads and keeps run payloads out of history responses", async () => {
  const test = await setupWorkflowExecution();
  try {
    const other = await seedUser(test.db);
    const actor = await hydrateActor(test.db, other.id, signal);
    if (actor === null) throw new Error("missing actor");
    expect((await getWorkflow(test.db, actor, test.workflow.id, signal)).ok).toBe(false);
    expect((await listWorkflows(test.db, actor, signal)).ok).toBe(false);
    const owned = await getWorkflow(test.db, test.actor, test.workflow.id, signal);
    expect(owned.ok).toBe(true);
    await admitManualRun(
      test.db,
      test.actor,
      { workflowId: test.workflow.id, requestKey: crypto.randomUUID(), recordId: test.deal.id },
      signal,
    );
    const history = await readRunHistory(test.db, test.actor, test.workflow.id, signal);
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.value).toHaveLength(1);
      expect(history.value[0]).not.toHaveProperty("outputs");
      expect(history.value[0]).not.toHaveProperty("trigger");
    }
    expect((await readRunHistory(test.db, actor, test.workflow.id, signal)).ok).toBe(false);
  } finally {
    await test.close();
  }
});
it("pauses admission with a revision check without cancelling existing runs", async () => {
  const test = await setupWorkflowExecution();
  try {
    expect((await pauseWorkflow(test.db, test.actor, test.workflow.id, 99, signal)).ok).toBe(false);
    expect((await pauseWorkflow(test.db, test.actor, test.workflow.id, 1, signal)).ok).toBe(true);
    expect(
      (await test.db.select().from(workflows).where(eq(workflows.id, test.workflow.id)))[0]?.active,
    ).toBe(false);
    expect(
      (
        await admitManualRun(
          test.db,
          test.actor,
          { workflowId: test.workflow.id, requestKey: crypto.randomUUID(), recordId: test.deal.id },
          signal,
        )
      ).ok,
    ).toBe(false);
  } finally {
    await test.close();
  }
});
