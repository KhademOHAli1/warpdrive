import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { persons, workflowRuns, workflowSteps } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

const signal = new AbortController().signal;
function route(id: string, value: string) {
  return {
    id,
    predicate: {
      defaultPort: "false",
      expression: {
        kind: "group",
        id: `rules_${id}`,
        operator: "and",
        children: [
          {
            kind: "predicate",
            id: `rule_${id}`,
            operator: "equals",
            left: { kind: "reference", nodeId: "read", path: ["status"] },
            right: { kind: "value", value },
          },
        ],
      },
    },
  };
}
function person(id: string, name: string): WorkflowNode {
  return {
    id,
    type: "record.create",
    version: 1,
    name: "Create Record",
    config: { entity: "person", fields: { name: { kind: "value", value: name } } },
  };
}

it.each(["live", "simulation"] as const)(
  "publishes and executes only the first matching record route in %s mode",
  async (mode) => {
    const test = await setupWorkflowExecution();
    try {
      const [start, read] = test.definition.nodes;
      assert(start !== undefined && read !== undefined);
      const definition: WorkflowDefinition = {
        schemaVersion: 1,
        nodes: [
          start,
          read,
          {
            id: "route",
            type: "ifElse",
            version: 1,
            name: "If/else",
            config: {
              branches: [route("first", test.deal.status), route("second", test.deal.status)],
              fallbackId: "else",
            },
          },
          person("firstPerson", "Selected record"),
          person("secondPerson", "Unselected record"),
          person("elsePerson", "Fallback record"),
        ],
        edges: [
          { from: "start", to: "read", port: "next" },
          { from: "read", to: "route", port: "next" },
          { from: "route", to: "firstPerson", port: "branch:first" },
          { from: "route", to: "secondPerson", port: "branch:second" },
          { from: "route", to: "elsePerson", port: "branch:else" },
        ],
      };
      const created = await createWorkflow(
        test.db,
        test.actor,
        { name: "First matching record", definition },
        signal,
      );
      assert(created.ok, JSON.stringify(created));
      const published = await publishWorkflow(test.db, test.actor, created.value.id, 1, signal);
      assert(published.ok, JSON.stringify(published));
      const run = await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId: created.value.id,
          recordId: test.deal.id,
          requestKey: crypto.randomUUID(),
          mode,
        },
        signal,
      );
      assert(run.ok, JSON.stringify(run));
      for (let count = 0; count < 3; count++)
        assert((await advanceWorkflowRun(test.db, run.value.id, signal)).ok);
      const competing = await Promise.all([
        advanceWorkflowRun(test.db, run.value.id, signal),
        advanceWorkflowRun(test.db, run.value.id, signal),
      ]);
      expect(competing.every((result) => result.ok)).toBe(true);
      const [stored] = await test.db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run.value.id));
      expect(stored).toMatchObject({
        status: "succeeded",
        nextNodeId: null,
        outputs: { route: { matchingBranchId: "first" } },
      });
      const steps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.value.id));
      expect(steps.map((step) => step.nodeId).sort()).toEqual(
        ["firstPerson", "read", "route", "start"].sort(),
      );
      const rows = await test.db.select({ name: persons.name }).from(persons);
      expect(rows).toEqual(mode === "live" ? [{ name: "Selected record" }] : []);
    } finally {
      await test.close();
    }
  },
);
