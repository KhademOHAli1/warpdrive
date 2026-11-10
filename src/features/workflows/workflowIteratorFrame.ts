import { err, ok, type Result } from "@/types/result";
import type { RunOutputs } from "./runTypes";
import {
  type WorkflowIteratorItem,
  type WorkflowIteratorPlan,
  type WorkflowIteratorReceiptIdentity,
  type WorkflowIteratorRecordProjector,
  workflowIteratorCompletion,
  workflowIteratorItems,
  workflowIteratorPlan,
  workflowIteratorWithinBudget,
} from "./workflowIteratorFrameContract";

export interface WorkflowIteratorFrame {
  readonly plan: WorkflowIteratorPlan;
  readonly items: readonly WorkflowIteratorItem[];
  readonly execution: WorkflowIteratorReceiptIdentity;
  readonly currentItem: WorkflowIteratorItem;
  readonly failedCount: number;
}

export type WorkflowIteratorTransition =
  | { status: "running"; frame: WorkflowIteratorFrame; outputs: RunOutputs }
  | {
      status: "done";
      nextNodeId: string | null;
      summary: { hasProcessedAllItems: true; processedCount: number; failedCount: number };
      outputs: RunOutputs;
    };

type IteratorError =
  | "invalid_plan"
  | "invalid_items"
  | "budget_exceeded"
  | "receipt_mismatch"
  | "invalid_transition"
  | "item_failed";
type Transition = Result<WorkflowIteratorTransition, IteratorError>;

function withoutBodyOutputs(outputs: RunOutputs, plan: WorkflowIteratorPlan): RunOutputs {
  const next = { ...outputs };
  for (const { id } of plan.body) delete next[id];
  delete next[plan.iteratorNodeId];
  return next;
}

function done(
  plan: WorkflowIteratorPlan,
  processedCount: number,
  failedCount: number,
  outputs: RunOutputs,
): Transition {
  return ok({
    status: "done",
    nextNodeId: plan.doneNodeId,
    summary: { hasProcessedAllItems: true, processedCount, failedCount },
    outputs: withoutBodyOutputs(outputs, plan),
  });
}

function running(frame: WorkflowIteratorFrame, outputs: RunOutputs): Transition {
  return ok({ status: "running", frame: Object.freeze(frame), outputs });
}

function startItem(
  plan: WorkflowIteratorPlan,
  items: readonly WorkflowIteratorItem[],
  iterationIndex: number,
  failedCount: number,
  outputs: RunOutputs,
): Transition {
  const currentItem = items[iterationIndex];
  if (currentItem === undefined || plan.entryNodeId === null) return err("invalid_transition");
  return running(
    {
      plan,
      items,
      currentItem,
      failedCount,
      execution: Object.freeze({
        runId: plan.runId,
        iteratorNodeId: plan.iteratorNodeId,
        nodeId: plan.entryNodeId,
        iterationIndex,
      }),
    },
    withoutBodyOutputs(outputs, plan),
  );
}

// The caller provides the plan from the pinned graph, and supplies its approved
// Search Records projector when the item list came from a search result.
export function armWorkflowIterator(
  rawPlan: unknown,
  rawItems: unknown,
  outputs: RunOutputs,
  projectRecord?: WorkflowIteratorRecordProjector,
): Transition {
  const plan = workflowIteratorPlan(rawPlan);
  if (plan === null) return err("invalid_plan");
  const items = workflowIteratorItems(rawItems, projectRecord);
  if (items === null) return err("invalid_items");
  if (plan.entryNodeId === null || items.length === 0) return done(plan, 0, 0, outputs);
  if (!workflowIteratorWithinBudget(plan.nonBodySteps, items.length, plan.longestBodyPath))
    return err("budget_exceeded");
  return startItem(plan, items, 0, 0, outputs);
}

function sameReceipt(
  expected: WorkflowIteratorReceiptIdentity,
  actual: WorkflowIteratorReceiptIdentity,
) {
  return (
    expected.runId === actual.runId &&
    expected.iteratorNodeId === actual.iteratorNodeId &&
    expected.nodeId === actual.nodeId &&
    expected.iterationIndex === actual.iterationIndex
  );
}

function finishItem(
  frame: WorkflowIteratorFrame,
  failedCount: number,
  outputs: RunOutputs,
): Transition {
  const nextIndex = frame.execution.iterationIndex + 1;
  if (nextIndex === frame.items.length) return done(frame.plan, nextIndex, failedCount, outputs);
  return startItem(frame.plan, frame.items, nextIndex, failedCount, outputs);
}

// This reducer consumes a completed occurrence. The durable caller must reread
// its active cursor under lock and commit the occurrence, effects and new cursor
// together. Only classified, rollback-safe item failures take the itemFailed path.
export function advanceWorkflowIterator(
  frame: WorkflowIteratorFrame,
  rawCompletion: unknown,
  outputs: RunOutputs,
): Transition {
  const parsed = workflowIteratorCompletion.safeParse(rawCompletion);
  if (!parsed.success) return err("invalid_transition");
  const completion = parsed.data;
  if (!sameReceipt(frame.execution, completion.receipt)) return err("receipt_mismatch");
  if (completion.status === "itemFailed") {
    return frame.plan.continueOnIterationFailure
      ? finishItem(frame, frame.failedCount + 1, outputs)
      : err("item_failed");
  }
  const node = frame.plan.body.find((item) => item.id === frame.execution.nodeId);
  if (node === undefined) return err("invalid_transition");
  const next = completion.nextNodeId;
  if (next === null) {
    return node.nextNodeIds.length === 0 || node.mayEndItem
      ? finishItem(frame, frame.failedCount, outputs)
      : err("invalid_transition");
  }
  if (!node.nextNodeIds.includes(next)) return err("invalid_transition");
  return running(
    {
      ...frame,
      execution: Object.freeze({ ...frame.execution, nodeId: next }),
    },
    outputs,
  );
}
