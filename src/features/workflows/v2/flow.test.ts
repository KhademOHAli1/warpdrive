import { expect, it } from "vitest";
import type { WorkflowV2Definition, WorkflowV2Node } from "@/features/blocks/contracts";
import { initialV2State } from "./admission";
import { evaluateBlockCondition, executeFlowNode, finishFlowStep } from "./flow";

const node = (
  id: string,
  type: WorkflowV2Node["type"],
  config: WorkflowV2Node["config"] = {},
): WorkflowV2Node => ({ id, type, version: 1, name: id, config });
it("compares decimal strings exactly and rejects incompatible ordering", () => {
  expect(
    evaluateBlockCondition({
      left: "99999999999999.9999",
      operator: "gt",
      right: "99999999999999.9998",
    }),
  ).toEqual({ ok: true, value: true });
  expect(evaluateBlockCondition({ left: 1, operator: "gte", right: "1" }).ok).toBe(false);
});
it("chooses the first matching branch and false filters end the run", () => {
  const branch = node("choice", "IF_ELSE");
  expect(
    executeFlowNode(
      branch,
      {
        branches: [
          { id: "first", condition: { left: 1, operator: "eq", right: 1 } },
          { id: "second" },
        ],
      },
      new Date(),
    ),
  ).toEqual({ ok: true, value: { output: { matchingBranchId: "first" }, port: "first" } });
  expect(
    executeFlowNode(
      node("filter", "FILTER"),
      { condition: { left: 1, operator: "eq", right: 2 } },
      new Date(),
    ),
  ).toEqual({
    ok: true,
    value: { output: { matchesFilter: false, shouldEndWorkflowRun: true }, stop: true },
  });
});
it("keeps per-iteration visit keys distinct and queues done only after the last item", () => {
  const iterator = node("loop", "ITERATOR", { items: ["a", "b"] }),
    body = node("body", "FILTER"),
    done = node("done", "FILTER");
  const definition: WorkflowV2Definition = {
    schemaVersion: 2,
    trigger: { type: "manual", config: {} },
    nodes: [iterator, body, done],
    entryNodeIds: ["loop"],
    edges: [
      { id: "body", source: "loop", target: "body", sourcePort: "loop" },
      { id: "done", source: "loop", target: "done", sourcePort: "done" },
    ],
  };
  const state = initialV2State(definition);
  const first = state.queue.shift();
  if (first === undefined) throw new Error("no token");
  finishFlowStep(state, definition, first, iterator, { output: {}, iteratorItems: ["a", "b"] });
  const bodyA = state.queue.shift();
  if (bodyA === undefined) throw new Error("no body");
  expect(state.outputs["|loop"]?.output.currentItem).toBe("a");
  finishFlowStep(state, definition, bodyA, body, { output: {} });
  const bodyB = state.queue.shift();
  if (bodyB === undefined) throw new Error("no body");
  expect(bodyB.visitKey).not.toBe(bodyA.visitKey);
  expect(state.outputs["|loop"]?.output.currentItem).toBe("b");
  finishFlowStep(state, definition, bodyB, body, { output: {} });
  expect(state.queue.map((token) => token.nodeId)).toEqual(["done"]);
  expect(state.frames).toEqual([]);
});
it("waits for actual forms/events and succeeds immediately for elapsed date delays", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  expect(executeFlowNode(node("form", "FORM"), { fields: [] }, now)).toMatchObject({
    ok: true,
    value: { wait: { kind: "form" } },
  });
  expect(
    executeFlowNode(
      node("event", "WAIT_FOR_EVENT"),
      { eventName: "deal.updated", timeoutSeconds: 30 },
      now,
    ),
  ).toMatchObject({
    ok: true,
    value: { wait: { kind: "event", expiresAt: new Date("2026-11-05T12:00:30Z") } },
  });
  expect(
    executeFlowNode(node("delay", "DELAY"), { mode: "date", until: "2026-11-04T00:00:00Z" }, now),
  ).toEqual({ ok: true, value: { output: { resumedAt: now.toISOString() } } });
});
