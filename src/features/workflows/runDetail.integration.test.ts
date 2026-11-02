import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { workflows } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { readRunDetail } from "./runDetail";

const signal = new AbortController().signal;
it("shows the immutable executed graph and safe step metadata after the draft changes", async () => {
  const test = await setupWorkflowExecution();
  try {
    const run = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: test.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: test.deal.id,
        mode: "simulation",
      },
      signal,
    );
    if (!run.ok) throw new Error("admission failed");
    for (let i = 0; i < 4; i++) await advanceWorkflowRun(test.db, run.value.id, signal);
    await test.db
      .update(workflows)
      .set({ draft: { ...test.definition, nodes: [] } })
      .where(eq(workflows.id, test.workflow.id));
    const detail = await readRunDetail(test.db, test.actor, test.workflow.id, run.value.id, signal);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.value.definition).toEqual(test.definition);
      expect(detail.value.number).toBe(1);
      expect(detail.value.steps.map((step) => step.nodeId)).toEqual(["start", "read", "task"]);
      expect(detail.value).not.toHaveProperty("trigger");
      expect(detail.value).not.toHaveProperty("outputs");
      expect(detail.value.steps[0]).not.toHaveProperty("output");
    }
    const other = await seedUser(test.db);
    const actor = await hydrateActor(test.db, other.id, signal);
    if (actor === null) throw new Error("missing actor");
    expect((await readRunDetail(test.db, actor, test.workflow.id, run.value.id, signal)).ok).toBe(
      false,
    );
    expect(
      (await readRunDetail(test.db, test.actor, crypto.randomUUID(), run.value.id, signal)).ok,
    ).toBe(false);
  } finally {
    await test.close();
  }
});
