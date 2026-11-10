import { describe, expect, it } from "vitest";
import type { RunOutputs } from "./runTypes";
import {
  advanceWorkflowIteratorRuntime,
  armWorkflowIteratorRuntime,
  releaseWorkflowIteratorRuntime,
  resumeWorkflowIteratorRuntime,
} from "./workflowIteratorRuntime";

const runId = "565e43a5-bd61-48df-9992-df7ec582f949";
const recordId = "2c963d35-4683-4189-a937-c825e95a95cc";
const secondId = "748ac2a4-c36e-4617-9b8f-cffbaf5a816e";

function record(id: string, title: string) {
  return {
    id,
    title,
    status: "open",
    value: null,
    currency: "EUR",
    expectedCloseDate: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
    unreviewed: "must not be mapped",
  };
}

function node(id: string, type: string, config: unknown = {}) {
  return { id, type, config, version: 1 };
}

function fixture(
  config: unknown = { items: { kind: "reference", nodeId: "search", path: ["all"] } },
) {
  const definition = {
    nodes: [
      node("start", "trigger.manual"),
      node("search", "record.search", { entity: "deal" }),
      node("iter", "iterator", config),
      node("predicate", "filter"),
      node("effect", "record.update"),
      node("after", "record.read"),
    ],
    edges: [
      { from: "start", to: "search", port: "next" },
      { from: "search", to: "iter", port: "next" },
      { from: "iter", to: "predicate", port: "loop" },
      { from: "predicate", to: "effect", port: "next" },
      { from: "iter", to: "after", port: "done" },
    ],
  };
  const outputs: RunOutputs = {
    search: { all: [record(recordId, "First"), record(secondId, "Second")] },
  };
  return { definition, runId, outputs, iteratorNodeId: "iter" };
}

function activePlan(result: ReturnType<typeof armWorkflowIteratorRuntime>) {
  if (!result.ok || result.value.status !== "running") throw new Error("Expected an armed plan");
  return result.value;
}

function activeOccurrence(result: ReturnType<typeof resumeWorkflowIteratorRuntime>) {
  if (!result.ok) throw new Error(`Expected an active occurrence, got ${result.error}`);
  return result.value;
}

describe("Iterator runtime adapter", () => {
  it("enters Loop, maps scoped item leaves and goes to Done after ordered occurrences", () => {
    const input = fixture();
    const armed = activePlan(armWorkflowIteratorRuntime(input));
    expect(armed).toMatchObject({
      nextNodeId: "predicate",
      iteratorFrame: {
        version: 1,
        iteratorNodeId: "iter",
        itemIndex: 0,
        itemCount: 2,
        failedCount: 0,
      },
      outputs: input.outputs,
    });
    const first = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...input, ...armed, receipts: [] }),
    );
    expect(first.currentRecord).toEqual({ entity: "deal", id: recordId });
    expect(first.executionOutputs.iter).toMatchObject({
      currentItemIndex: 0,
      "currentItem.id": recordId,
      "currentItem.title": "First",
      "currentItem.expectedCloseDate": null,
    });
    expect(first.executionOutputs.iter).not.toHaveProperty(["currentItem.unreviewed"]);
    expect(first.durableOutputs).toEqual(input.outputs);

    const pendingEffect = activePlan(
      advanceWorkflowIteratorRuntime(first, {
        status: "completed",
        receipt: first.frame.execution,
        nextNodeId: "effect",
      }),
    );
    const predicateReceipt = { ...first.frame.execution, output: { matchesFilter: true } };
    const effect = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...input, ...pendingEffect, receipts: [predicateReceipt] }),
    );
    expect(effect.frame.execution).toMatchObject({ nodeId: "effect", iterationIndex: 0 });
    expect(effect.executionOutputs.predicate).toEqual(predicateReceipt.output);
    const secondPlan = activePlan(
      advanceWorkflowIteratorRuntime(effect, {
        status: "completed",
        receipt: effect.frame.execution,
        nextNodeId: null,
      }),
    );
    const second = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...input, ...secondPlan, receipts: [] }),
    );
    expect(second.frame.execution).toMatchObject({ nodeId: "predicate", iterationIndex: 1 });
    expect(second.executionOutputs.iter).toMatchObject({
      currentItemIndex: 1,
      "currentItem.id": secondId,
    });
    expect(second.executionOutputs).not.toHaveProperty("predicate");
    expect(
      advanceWorkflowIteratorRuntime(second, {
        status: "completed",
        receipt: second.frame.execution,
        nextNodeId: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        status: "done",
        nextNodeId: "after",
        iteratorFrame: null,
        outputs: input.outputs,
        summary: { hasProcessedAllItems: true, processedCount: 2, failedCount: 0 },
      },
    });
  });

  it("reconstructs current outputs exclusively from same-index path receipts", () => {
    const input = fixture();
    const contaminated = {
      ...input.outputs,
      iter: { currentItemIndex: 0 },
      predicate: { matchesFilter: false },
      effect: { id: "stale" },
    };
    const cursor = {
      version: 1,
      iteratorNodeId: "iter",
      itemIndex: 1,
      itemCount: 2,
      failedCount: 0,
    };
    const pending = {
      ...input,
      outputs: contaminated,
      nextNodeId: "effect",
      iteratorFrame: cursor,
    };
    const receipt = {
      runId,
      nodeId: "predicate",
      iterationIndex: 1,
      output: { matchesFilter: true },
    };
    const missing = { ok: false, error: "invalid_receipts" };
    expect(resumeWorkflowIteratorRuntime({ ...pending, receipts: [] })).toEqual(missing);
    expect(
      resumeWorkflowIteratorRuntime({ ...pending, receipts: [{ ...receipt, iterationIndex: 0 }] }),
    ).toEqual(missing);
    expect(
      resumeWorkflowIteratorRuntime({ ...pending, receipts: [{ ...receipt, nodeId: "after" }] }),
    ).toEqual(missing);
    const current = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...pending, receipts: [receipt] }),
    );
    expect(current.executionOutputs.predicate).toEqual({ matchesFilter: true });
    expect(current.executionOutputs).not.toHaveProperty("effect");
    expect(releaseWorkflowIteratorRuntime(current)).toEqual({
      iteratorFrame: null,
      outputs: input.outputs,
    });
  });

  it("rejects a non-upstream or malformed Search binding and output", () => {
    const input = fixture({ items: { kind: "reference", nodeId: "after", path: ["all"] } });
    input.definition.nodes[5] = node("after", "record.search", { entity: "deal" });
    expect(
      armWorkflowIteratorRuntime({ ...input, outputs: { ...input.outputs, after: { all: [] } } }),
    ).toEqual({ ok: false, error: "invalid_source" });
    const wrongPath = fixture({
      items: { kind: "reference", nodeId: "search", path: ["firstId"] },
    });
    expect(armWorkflowIteratorRuntime(wrongPath)).toEqual({
      ok: false,
      error: "invalid_configuration",
    });
    expect(
      armWorkflowIteratorRuntime({ ...fixture(), outputs: { search: { firstId: recordId } } }),
    ).toEqual({ ok: false, error: "invalid_source" });
    expect(
      armWorkflowIteratorRuntime({
        ...fixture(),
        outputs: { search: { all: [{ id: recordId }] } },
      }),
    ).toEqual({ ok: false, error: "invalid_items" });
  });

  it("advances empty sources directly to Done and verifies rehydrated cursor counts", () => {
    const input = fixture();
    expect(
      armWorkflowIteratorRuntime({ ...input, outputs: { search: { all: [] } } }),
    ).toMatchObject({
      ok: true,
      value: {
        status: "done",
        nextNodeId: "after",
        iteratorFrame: null,
        summary: { processedCount: 0 },
      },
    });
    const armed = activePlan(armWorkflowIteratorRuntime(input));
    expect(
      resumeWorkflowIteratorRuntime({
        ...input,
        ...armed,
        receipts: [],
        iteratorFrame: { ...armed.iteratorFrame, itemCount: 1 },
      }),
    ).toEqual({ ok: false, error: "invalid_cursor" });
  });

  it("maps a typed scalar item and releases a locally failed item when configured", () => {
    const input = fixture({
      items: { kind: "literal", itemKind: "number", items: [12, null] },
      shouldContinueOnIterationFailure: true,
    });
    const armed = activePlan(armWorkflowIteratorRuntime(input));
    const current = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...input, ...armed, receipts: [] }),
    );
    expect(current.currentRecord).toBeNull();
    expect(current.executionOutputs.iter).toMatchObject({ currentItem: 12 });
    const next = activePlan(
      advanceWorkflowIteratorRuntime(current, {
        status: "itemFailed",
        receipt: current.frame.execution,
      }),
    );
    expect(next.iteratorFrame).toMatchObject({ itemIndex: 1, failedCount: 1 });
    const second = activeOccurrence(
      resumeWorkflowIteratorRuntime({ ...input, ...next, receipts: [] }),
    );
    expect(second.executionOutputs.iter).toMatchObject({ currentItem: null });
  });

  it("rejects invalid ports, cross-scope joins and human form nodes in the body", () => {
    const wrongPort = fixture();
    wrongPort.definition.edges[2] = { from: "iter", to: "predicate", port: "next" };
    expect(armWorkflowIteratorRuntime(wrongPort)).toEqual({ ok: false, error: "invalid_graph" });
    const joined = fixture();
    joined.definition.edges.push({ from: "effect", to: "after", port: "next" });
    expect(armWorkflowIteratorRuntime(joined)).toEqual({ ok: false, error: "invalid_graph" });
    const waiting = fixture();
    waiting.definition.nodes[4] = node("effect", "human.form");
    expect(armWorkflowIteratorRuntime(waiting)).toEqual({ ok: false, error: "invalid_graph" });
  });
});
