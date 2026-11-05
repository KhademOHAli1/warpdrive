import { describe, expect, it, vi } from "vitest";
import type { RunOutputs } from "./runTypes";
import {
  advanceWorkflowIterator,
  armWorkflowIterator,
  type WorkflowIteratorFrame,
} from "./workflowIteratorFrame";
import type {
  WorkflowIteratorPlanInput,
  WorkflowIteratorRecordItem,
} from "./workflowIteratorFrameContract";

const runId = "565e43a5-bd61-48df-9992-df7ec582f949";
const foreignRun = "72a36997-8e3a-4302-9c66-8fab1beae20e";
const recordId = "2c963d35-4683-4189-a937-c825e95a95cc";

function plan(overrides: Partial<WorkflowIteratorPlanInput> = {}): WorkflowIteratorPlanInput {
  return {
    runId,
    iteratorNodeId: "iterator",
    entryNodeId: "predicate",
    doneNodeId: "after",
    body: [
      { id: "predicate", nextNodeIds: ["action"], mayEndItem: true },
      { id: "action", nextNodeIds: [], mayEndItem: false },
    ],
    nonBodySteps: 3,
    continueOnIterationFailure: false,
    ...overrides,
  };
}

function numbers(items: readonly (number | null)[]) {
  return { kind: "literal", itemKind: "number", items } as const;
}

function running(result: ReturnType<typeof armWorkflowIterator>) {
  if (!result.ok || result.value.status !== "running") throw new Error("Expected an active frame");
  return result.value;
}

function complete(
  frame: WorkflowIteratorFrame,
  nextNodeId: string | null,
  outputs: RunOutputs = {},
) {
  return advanceWorkflowIterator(
    frame,
    { status: "completed", receipt: frame.execution, nextNodeId },
    outputs,
  );
}

function failItem(frame: WorkflowIteratorFrame, outputs: RunOutputs = {}) {
  return advanceWorkflowIterator(
    frame,
    { status: "itemFailed", receipt: frame.execution },
    outputs,
  );
}

describe("Iterator frame", () => {
  it("uses separate occurrence identities and resets only the loop output scope", () => {
    const upstream = { all: [{ id: recordId }] };
    const previous = { search: upstream, iterator: { currentItem: "old" }, action: { id: "old" } };
    const first = running(armWorkflowIterator(plan(), numbers([4, 4]), previous));
    expect(first.outputs).toEqual({ search: upstream });
    expect(first.frame.execution).toEqual({
      runId,
      iteratorNodeId: "iterator",
      nodeId: "predicate",
      iterationIndex: 0,
    });
    expect(first.frame.currentItem).toBe(4);
    expect(previous.action.id).toBe("old");

    const withPredicate = { ...first.outputs, predicate: { matchesFilter: true } };
    const action = running(complete(first.frame, "action", withPredicate));
    expect(action.outputs).toBe(withPredicate);
    expect(action.frame.execution).toMatchObject({ nodeId: "action", iterationIndex: 0 });

    const second = running(
      complete(action.frame, null, { ...action.outputs, action: { id: "created" } }),
    );
    expect(second.frame.items).toBe(first.frame.items);
    expect(second.frame.currentItem).toBe(4);
    expect(second.frame.execution).toMatchObject({ nodeId: "predicate", iterationIndex: 1 });
    expect(second.outputs).toEqual({ search: upstream });
    expect(
      advanceWorkflowIterator(
        second.frame,
        { status: "completed", receipt: first.frame.execution, nextNodeId: null },
        second.outputs,
      ),
    ).toEqual({ ok: false, error: "receipt_mismatch" });

    expect(
      complete(second.frame, null, {
        ...second.outputs,
        iterator: { currentItem: 4 },
        predicate: { matchesFilter: false },
      }),
    ).toEqual({
      ok: true,
      value: {
        status: "done",
        nextNodeId: "after",
        summary: { hasProcessedAllItems: true, processedCount: 2, failedCount: 0 },
        outputs: { search: upstream },
      },
    });
  });

  it("rejects foreign or stale receipt coordinates", () => {
    const { frame } = running(armWorkflowIterator(plan(), numbers([1]), {}));
    const expected = frame.execution;
    const wrong = [
      { ...expected, runId: foreignRun },
      { ...expected, iteratorNodeId: "another" },
      { ...expected, nodeId: "action" },
      { ...expected, iterationIndex: 1 },
    ];
    for (const receipt of wrong) {
      expect(
        advanceWorkflowIterator(frame, { status: "completed", receipt, nextNodeId: "action" }, {}),
      ).toEqual({ ok: false, error: "receipt_mismatch" });
    }
  });

  it("requires a real child or a qualified end of item", () => {
    const { frame } = running(
      armWorkflowIterator(
        plan({
          body: [
            { id: "predicate", nextNodeIds: ["action"], mayEndItem: false },
            { id: "action", nextNodeIds: [], mayEndItem: false },
          ],
        }),
        numbers([1]),
        {},
      ),
    );
    for (const invalid of ["predicate", "after", "unknown", null]) {
      expect(complete(frame, invalid)).toEqual({ ok: false, error: "invalid_transition" });
    }
    expect(
      advanceWorkflowIterator(frame, { status: "completed", receipt: frame.execution }, {}),
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("allows a classified local failure to skip an item only when configured", () => {
    const { frame } = running(armWorkflowIterator(plan(), numbers([1]), {}));
    expect(failItem(frame)).toEqual({ ok: false, error: "item_failed" });
    const first = running(
      armWorkflowIterator(plan({ continueOnIterationFailure: true }), numbers([1, 2]), {}),
    );
    const second = running(
      failItem(first.frame, { predicate: { matchesFilter: true }, search: { totalCount: 2 } }),
    );
    expect(second.frame.execution.iterationIndex).toBe(1);
    expect(second.frame.failedCount).toBe(1);
    expect(second.outputs).toEqual({ search: { totalCount: 2 } });
    expect(complete(second.frame, null, second.outputs)).toMatchObject({
      ok: true,
      value: { status: "done", summary: { processedCount: 2, failedCount: 1 } },
    });
  });

  it.each([
    [plan(), numbers([])],
    [plan({ entryNodeId: null, body: [] }), numbers([2])],
  ])("finishes immediately for empty items or an unconnected body", (definition, items) => {
    expect(armWorkflowIterator(definition, items, {})).toEqual({
      ok: true,
      value: {
        status: "done",
        nextNodeId: "after",
        summary: { hasProcessedAllItems: true, processedCount: 0, failedCount: 0 },
        outputs: {},
      },
    });
  });

  it("admits exactly the expanded limit and rejects the next item before arming", () => {
    const branching = plan({
      body: [
        { id: "predicate", nextNodeIds: ["action", "another"], mayEndItem: false },
        { id: "action", nextNodeIds: [], mayEndItem: false },
        { id: "another", nextNodeIds: [], mayEndItem: false },
      ],
    });
    expect(
      running(armWorkflowIterator(branching, numbers(Array<number>(98).fill(1)), {})).frame.plan
        .longestBodyPath,
    ).toBe(2);
    expect(armWorkflowIterator(branching, numbers(Array<number>(99).fill(1)), {})).toEqual({
      ok: false,
      error: "budget_exceeded",
    });
  });

  it.each(
    [
      [{ id: "predicate", nextNodeIds: ["predicate"], mayEndItem: false }],
      [{ id: "predicate", nextNodeIds: ["after"], mayEndItem: false }],
      [
        { id: "predicate", nextNodeIds: [], mayEndItem: false },
        { id: "orphan", nextNodeIds: ["orphan"], mayEndItem: false },
      ],
      [
        { id: "predicate", nextNodeIds: ["one", "two"], mayEndItem: false },
        { id: "one", nextNodeIds: ["two"], mayEndItem: false },
        { id: "two", nextNodeIds: [], mayEndItem: false },
      ],
    ].map((body) => [body] as const),
  )("rejects invalid body scope %#", (body) => {
    expect(armWorkflowIterator(plan({ body }), numbers([1]), {})).toEqual({
      ok: false,
      error: "invalid_plan",
    });
  });

  it("freezes the admitted plan and one copied ordered list", () => {
    const admittedPlan = plan();
    const input = [null, 5];
    const { frame } = running(armWorkflowIterator(admittedPlan, numbers(input), {}));
    input[1] = 9;
    admittedPlan.body[0]?.nextNodeIds.splice(0);
    expect(frame.currentItem).toBeNull();
    expect(frame.items).toEqual([null, 5]);
    expect(frame.plan.body[0]?.nextNodeIds).toEqual(["action"]);
    expect(Object.isFrozen(frame.items)).toBe(true);
    expect(Object.isFrozen(frame.plan.body[0]?.nextNodeIds)).toBe(true);
  });

  it("requires a record projector and retains only its frozen snapshot", () => {
    const input = { id: recordId, title: "Visible", email: "hidden@example.invalid" };
    const projected = { id: recordId, title: input.title };
    const project = vi.fn<(raw: unknown) => WorkflowIteratorRecordItem | null>(() => projected);
    const items = { kind: "records", items: [input] };
    expect(armWorkflowIterator(plan(), items, {})).toEqual({ ok: false, error: "invalid_items" });
    const { frame } = running(armWorkflowIterator(plan(), items, {}, project));
    expect(project).toHaveBeenCalledExactlyOnceWith(input);
    projected.title = "Changed";
    expect(frame.currentItem).toEqual({ id: recordId, title: "Visible" });
    expect(Object.isFrozen(frame.currentItem)).toBe(true);
    expect(armWorkflowIterator(plan(), items, {}, () => null)).toEqual({
      ok: false,
      error: "invalid_items",
    });
  });

  it.each([
    numbers(Array<number>(101).fill(1)),
    numbers([Number.NaN]),
    { kind: "literal", itemKind: "number", items: [1, "2"] },
    { kind: "literal", itemKind: "text", items: ["x".repeat(256)] },
  ])("rejects malformed or excessive item lists %#", (items) => {
    expect(armWorkflowIterator(plan(), items, {})).toEqual({ ok: false, error: "invalid_items" });
  });
});
