import { expect, it } from "vitest";
import { activities } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

it.each(["open", "won"])(
  "runs only the connected branch when comparing status to %s",
  async (status) => {
    const test = await setupWorkflowExecution();
    const signal = AbortSignal.timeout(15000);
    try {
      const graph: WorkflowDefinition = {
        ...test.definition,
        nodes: [
          test.definition.nodes[0]!,
          test.definition.nodes[1]!,
          {
            id: "check",
            type: "condition",
            version: 1,
            name: "Check status",
            config: {
              left: { kind: "reference", nodeId: "read", path: ["status"] },
              operator: "equals",
              right: { kind: "value", value: status },
            },
          },
          {
            ...test.definition.nodes[2]!,
            id: "matched",
            config: {
              ...test.definition.nodes[2]!.config,
              subject: { kind: "value", value: "Matched branch" },
            },
          },
          {
            ...test.definition.nodes[2]!,
            id: "other",
            config: {
              ...test.definition.nodes[2]!.config,
              subject: { kind: "value", value: "Other branch" },
            },
          },
        ],
        edges: [
          { from: "start", to: "read", port: "next" },
          { from: "read", to: "check", port: "next" },
          { from: "check", to: "matched", port: "true" },
          { from: "check", to: "other", port: "false" },
        ],
      };
      const created = await createWorkflow(
        test.db,
        test.actor,
        { name: "Branch process", definition: graph },
        signal,
      );
      if (!created.ok) throw new Error(created.error);
      const published = await publishWorkflow(test.db, test.actor, created.value.id, 1, signal);
      expect(published.ok).toBe(true);
      const admitted = await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId: created.value.id,
          recordId: test.deal.id,
          requestKey: crypto.randomUUID(),
          mode: "live",
        },
        signal,
      );
      if (!admitted.ok) throw new Error(admitted.error);
      for (let index = 0; index < 6; index++)
        await advanceWorkflowRun(test.db, admitted.value.id, signal);
      const rows = await test.db.select().from(activities);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.subject).toBe(status === "open" ? "Matched branch" : "Other branch");
    } finally {
      await test.close();
    }
  },
);
