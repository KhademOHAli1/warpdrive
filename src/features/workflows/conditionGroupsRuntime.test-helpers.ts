import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals, workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { setupRetryActor } from "./runRetry.test-helpers";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type Json = WorkflowNode["config"][string];
export const groupSignal = new AbortController().signal;
export const groupValue = (value: string | number | boolean | null) => ({
  kind: "value" as const,
  value,
});
export const groupReference = (field: string) => ({
  kind: "reference" as const,
  nodeId: "read",
  path: [field],
});
export function groupPredicate(id: string, left: Json, operator: string, right?: Json): Json {
  return { kind: "predicate", id, left, operator, ...(right === undefined ? {} : { right }) };
}
export function groupExpression(id: string, operator: "and" | "or", children: Json[]): Json {
  return { kind: "group", id, operator, children };
}
export function groupConfig(expression: Json): WorkflowNode["config"] {
  return { expression, defaultPort: "false" };
}
export function matchingGroupConfig() {
  return groupConfig(
    groupExpression("qualification", "and", [
      groupPredicate("status", groupReference("status"), "equals", groupValue("open")),
      groupExpression("details", "or", [
        groupPredicate("title", groupReference("title"), "contains", groupValue("Not present")),
        groupPredicate("date", groupReference("expectedCloseDate"), "equals", {
          kind: "value",
          value: "2028-02-29",
          literalType: "date",
        }),
      ]),
    ]),
  );
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, label);
  return row;
}

export async function setupConditionGroups() {
  const test = await setupRetryActor();
  try {
    await test.db
      .update(deals)
      .set({ expectedCloseDate: "2028-02-29", value: "12.34" })
      .where(eq(deals.id, test.deal.id));
    const start = requireRow(
      test.definition.nodes.find((node) => node.id === "start"),
      "Missing manual fixture",
    );
    const read = requireRow(
      test.definition.nodes.find((node) => node.id === "read"),
      "Missing read fixture",
    );
    const task = requireRow(
      test.definition.nodes.find((node) => node.id === "task"),
      "Missing task fixture",
    );
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        structuredClone(start),
        structuredClone(read),
        {
          id: "check",
          type: "condition",
          version: 1,
          name: "Grouped qualification",
          config: matchingGroupConfig(),
        },
        {
          ...structuredClone(task),
          id: "matched",
          name: "Matched",
          config: { ...task.config, subject: groupValue("Matched grouped path") },
        },
        {
          ...structuredClone(task),
          id: "otherwise",
          name: "Otherwise",
          config: { ...task.config, subject: groupValue("Default grouped path") },
        },
      ],
      edges: [
        { from: "start", to: "read", port: "next" },
        { from: "read", to: "check", port: "next" },
        { from: "check", to: "matched", port: "true" },
        { from: "check", to: "otherwise", port: "false" },
      ],
    };
    return { ...test, definition };
  } catch (error) {
    await test.close();
    if (error instanceof Error) throw error;
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Condition group fixture setup failed");
  }
}
export type ConditionGroupsFixture = Awaited<ReturnType<typeof setupConditionGroups>>;

export function withGroupConfig(
  test: ConditionGroupsFixture,
  config: WorkflowNode["config"],
): WorkflowDefinition {
  return {
    ...structuredClone(test.definition),
    nodes: test.definition.nodes.map((node) =>
      node.id === "check" ? { ...node, config } : structuredClone(node),
    ),
  };
}
export async function saveGroupGraph(test: ConditionGroupsFixture, definition = test.definition) {
  const [current] = await test.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, test.workflow.id));
  const row = requireRow(current, "Missing workflow fixture");
  const saved = await saveWorkflowDraft(
    test.db,
    test.actor,
    { id: row.id, revision: row.revision, name: "Grouped qualification", definition },
    groupSignal,
  );
  if (!saved.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, saved.error);
  return saved.value;
}
export async function publishGroupGraph(
  test: ConditionGroupsFixture,
  definition = test.definition,
) {
  const saved = await saveGroupGraph(test, definition);
  const published = await publishWorkflow(
    test.db,
    test.actor,
    saved.id,
    saved.revision,
    groupSignal,
  );
  if (!published.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, published.error);
  return published.value;
}
export async function admitGroupRun(
  test: ConditionGroupsFixture,
  mode: "live" | "simulation" = "live",
  requestKey = crypto.randomUUID(),
) {
  const admitted = await admitManualRun(
    test.db,
    test.actor,
    { workflowId: test.workflow.id, recordId: test.deal.id, requestKey, mode },
    groupSignal,
  );
  if (!admitted.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, admitted.error);
  return admitted.value;
}
export async function advanceGroupRun(test: ConditionGroupsFixture, runId: string, count: number) {
  for (let index = 0; index < count; index++) {
    const result = await advanceWorkflowRun(test.db, runId, groupSignal);
    if (!result.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, result.error);
  }
}
export async function storedGroupRun(test: ConditionGroupsFixture, runId: string) {
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  return requireRow(run, "Missing run fixture");
}
export async function storedGroupSteps(test: ConditionGroupsFixture, runId: string) {
  return test.db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(workflowSteps.nodeId);
}

// Simulate the coherent shape of an old completed reader receipt. This is not a
// fresh CRM fetch or a claim that an old worker executed a grouped configuration.
export async function removeLegacyDateReceipt(test: ConditionGroupsFixture, runId: string) {
  const run = await storedGroupRun(test, runId);
  const read = { ...run.outputs.read };
  delete read.expectedCloseDate;
  await test.db
    .update(workflowRuns)
    .set({ outputs: { ...run.outputs, read } })
    .where(eq(workflowRuns.id, runId));
  const steps = await storedGroupSteps(test, runId);
  const receipt = requireRow(
    steps.find((step) => step.nodeId === "read"),
    "Missing actual read receipt",
  );
  await test.db.update(workflowSteps).set({ output: read }).where(eq(workflowSteps.id, receipt.id));
}

// Deliberately corrupt persisted-data fixture only. Public publication is never
// asked to accept this graph; valid immutable versions/current pointer stay intact.
export async function seedCorruptGroupRun(
  test: ConditionGroupsFixture,
  prefixRunId: string,
  definition: WorkflowDefinition,
) {
  const prefix = await storedGroupRun(test, prefixRunId);
  const receipts = await storedGroupSteps(test, prefixRunId);
  const [insertedVersion] = await test.db
    .insert(workflowVersions)
    .values({
      workflowId: test.workflow.id,
      number: 500,
      name: "Deliberately corrupt stored branch fixture",
      definition,
      publishedBy: test.actor.id,
    })
    .returning();
  const version = requireRow(insertedVersion, "Missing corrupt fixture version");
  const [insertedRun] = await test.db
    .insert(workflowRuns)
    .values({
      workflowId: test.workflow.id,
      versionId: version.id,
      actorId: prefix.actorId,
      requestKey: crypto.randomUUID(),
      mode: prefix.mode,
      trigger: prefix.trigger,
      status: "running",
      nextNodeId: "check",
      outputs: structuredClone(prefix.outputs),
      createdAt: prefix.createdAt,
      updatedAt: prefix.updatedAt,
    })
    .returning();
  const run = requireRow(insertedRun, "Missing corrupt fixture run");
  await test.db.insert(workflowSteps).values(
    receipts.map((receipt) => ({
      runId: run.id,
      nodeId: receipt.nodeId,
      simulated: receipt.simulated,
      completedAt: receipt.completedAt,
      output: structuredClone(receipt.output),
    })),
  );
  return { run, version };
}
