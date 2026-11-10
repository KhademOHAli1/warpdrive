import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { persons, workflowRuns, workflowSteps } from "@/db/schema";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import { readRunDetail } from "./runDetail";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const items = ["ITERATOR_PRIVATE_FIRST", "ITERATOR_PRIVATE_SECOND"];
const doneName = "ITERATOR_PRIVATE_DONE";
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

function iteratorDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: "Start",
        config: { scope: "global" },
      },
      {
        id: "iterate",
        type: "iterator",
        version: 1,
        name: "Iterator",
        config: { items: { kind: "literal", itemKind: "text", items } },
      },
      {
        id: "each",
        type: "record.create",
        version: 1,
        name: "Create each person",
        config: {
          entity: "person",
          fields: { name: { kind: "reference", nodeId: "iterate", path: ["currentItem"] } },
        },
      },
      {
        id: "done",
        type: "record.create",
        version: 1,
        name: "Create final person",
        config: { entity: "person", fields: { name: { kind: "value", value: doneName } } },
      },
    ],
    edges: [
      { from: "start", to: "iterate", port: "next" },
      { from: "iterate", to: "each", port: "loop" },
      { from: "iterate", to: "done", port: "done" },
    ],
  };
}

async function publishedIterator(test: Fixture, definition: WorkflowDefinition) {
  const created = await createWorkflow(
    test.db,
    test.actor,
    { name: "Iterator fixture", definition },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  const version = await publishWorkflow(
    test.db,
    test.actor,
    created.value.id,
    created.value.revision,
    signal,
  );
  assert(version.ok, JSON.stringify(version));
  return version.value;
}

async function executeIterator(
  test: Fixture,
  version: Awaited<ReturnType<typeof publishedIterator>>,
  mode: "simulation" | "live",
) {
  const admitted = await admitManualRun(
    test.db,
    test.actor,
    {
      workflowId: version.workflowId,
      reviewedVersionId: version.id,
      requestKey: crypto.randomUUID(),
      mode,
    },
    signal,
  );
  assert(admitted.ok, JSON.stringify(admitted));
  const id = admitted.value.id;
  for (let step = 0; step < 2; step++) {
    expect(await advanceWorkflowRun(test.db, id, signal)).toEqual({ ok: true, value: "running" });
  }
  const [armed] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  expect(armed).toMatchObject({
    nextNodeId: "each",
    iteratorFrame: { version: 1, itemIndex: 0, itemCount: 2 },
  });
  const competing = await Promise.all(
    Array.from({ length: 5 }, () => advanceWorkflowRun(test.db, id, signal)),
  );
  expect(competing.filter((step) => step.ok && step.value === "running")).toHaveLength(2);
  expect(competing.filter((step) => step.ok && step.value === "succeeded")).toHaveLength(3);
  const steps = await test.db.select().from(workflowSteps).where(eq(workflowSteps.runId, id));
  expect(steps).toHaveLength(5);
  const each = steps
    .filter((step) => step.nodeId === "each")
    .sort((a, b) => a.iterationIndex - b.iterationIndex);
  expect(
    each.map(({ iterationIndex, outcome, simulated }) => ({ iterationIndex, outcome, simulated })),
  ).toEqual([
    { iterationIndex: 0, outcome: "succeeded", simulated: mode === "simulation" },
    { iterationIndex: 1, outcome: "succeeded", simulated: mode === "simulation" },
  ]);
  expect(new Set(each.map((step) => step.output.id)).size).toBe(2);
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  expect(run).toMatchObject({
    iteratorFrame: null,
    status: "succeeded",
    nextNodeId: null,
    outputs: { iterate: { hasProcessedAllItems: true, processedCount: 2, failedCount: 0 } },
  });
  expect(run?.outputs).not.toHaveProperty("each");
  return { id, each };
}

it("commits separate scoped writes once under competing deliveries and rolls back both simulation paths", async () => {
  const test = await setupWorkflowExecution();
  try {
    const definition = iteratorDefinition();
    const version = await publishedIterator(test, definition);
    const live = await executeIterator(test, version, "live");
    const names = await test.db
      .select({ id: persons.id, name: persons.name })
      .from(persons)
      .orderBy(persons.name);
    expect(names).toHaveLength(3);
    for (const [index, step] of live.each.entries()) {
      expect(names.find((person) => person.id === step.output.id)?.name).toBe(items[index]);
    }
    expect(names.filter((person) => person.name === doneName)).toHaveLength(1);
    const detail = await readRunDetail(test.db, test.actor, version.workflowId, live.id, signal);
    assert(detail.ok, JSON.stringify(detail));
    expect(
      detail.value.steps
        .filter((step) => step.nodeId === "each")
        .map((step) => step.iterationIndex)
        .sort(),
    ).toEqual([0, 1]);
    expect(detail.value.steps.find((step) => step.nodeId === "iterate")?.iteratorSummary).toEqual({
      processedCount: 2,
      failedCount: 0,
    });
    expect(detail.value.steps.every((step) => !Object.hasOwn(step, "output"))).toBe(true);

    await executeIterator(test, version, "simulation");
    expect(
      await test.db
        .select({ id: persons.id, name: persons.name })
        .from(persons)
        .orderBy(persons.name),
    ).toEqual(names);
    const storedRuns = await test.db.select({ id: workflowRuns.id }).from(workflowRuns);
    const draft = await simulateWorkflowDraft(
      test.db,
      test.actor,
      { workflowId: version.workflowId, definition },
      signal,
    );
    assert(draft.ok, JSON.stringify(draft));
    expect(draft.value.outcome).toBe("completed");
    expect(draft.value.steps.map(({ nodeId, iterationIndex }) => [nodeId, iterationIndex])).toEqual(
      [
        ["start", undefined],
        ["each", 0],
        ["each", 1],
        ["iterate", undefined],
        ["done", undefined],
      ],
    );
    expect(draft.value.steps.find((step) => step.nodeId === "iterate")?.iteratorSummary).toEqual({
      processedCount: 2,
      failedCount: 0,
    });
    for (const privateName of [...items, doneName])
      expect(JSON.stringify(draft.value)).not.toContain(privateName);
    expect(
      await test.db
        .select({ id: persons.id, name: persons.name })
        .from(persons)
        .orderBy(persons.name),
    ).toEqual(names);
    expect(await test.db.select({ id: workflowRuns.id }).from(workflowRuns)).toEqual(storedRuns);
  } finally {
    await test.close();
  }
});
