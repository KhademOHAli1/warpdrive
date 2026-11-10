import { err, ok, type Result } from "@/types/result";
import type { RunOutputs, StepOutput } from "./runTypes";
import {
  advanceWorkflowIterator,
  armWorkflowIterator,
  type WorkflowIteratorFrame,
  type WorkflowIteratorTransition,
} from "./workflowIteratorFrame";
import type { WorkflowIteratorItemsInput } from "./workflowIteratorFrameContract";
import {
  compileWorkflowIteratorGraph,
  type WorkflowIteratorGraph,
  type WorkflowIteratorGraphIndex,
} from "./workflowIteratorGraph";
import {
  type WorkflowIteratorCursor,
  workflowIteratorCursor,
} from "./workflowIteratorRuntimeContract";
import { workflowRecordSnapshot } from "./workflowRecordQuery";
import { type RecordLookupEntity, recordSearchConfig } from "./workflowRecordQueryContract";

interface RuntimeInput {
  definition: WorkflowIteratorGraph;
  runId: string;
  outputs: RunOutputs;
}

type IteratorItems = {
  items: WorkflowIteratorItemsInput;
  entity?: RecordLookupEntity;
};

type FrameFailure = Extract<ReturnType<typeof armWorkflowIterator>, { ok: false }>["error"];
type RuntimeFailure =
  | FrameFailure
  | "invalid_graph"
  | "invalid_configuration"
  | "invalid_source"
  | "invalid_cursor"
  | "invalid_receipts";

export type WorkflowIteratorRuntimePlan =
  | {
      status: "running";
      nextNodeId: string;
      iteratorFrame: WorkflowIteratorCursor;
      outputs: RunOutputs;
    }
  | (Extract<WorkflowIteratorTransition, { status: "done" }> & { iteratorFrame: null });

export interface WorkflowIteratorBodyReceipt {
  readonly runId: string;
  readonly nodeId: string;
  readonly iterationIndex: number;
  readonly output: unknown;
}

export interface ActiveWorkflowIterator {
  readonly frame: WorkflowIteratorFrame;
  readonly durableOutputs: RunOutputs;
  readonly executionOutputs: RunOutputs;
  readonly currentRecord: { entity: RecordLookupEntity; id: string } | null;
}

function outputRecord(raw: unknown): raw is StepOutput {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

type CompiledGraph = Extract<
  ReturnType<typeof compileWorkflowIteratorGraph>,
  { ok: true }
>["value"];

function resolveItems(compiled: CompiledGraph, outputs: RunOutputs): IteratorItems | null {
  const source = compiled.config.items;
  if (source.kind === "literal") return { items: source };
  const node = compiled.search;
  if (node === null || !Object.hasOwn(outputs, source.nodeId)) return null;
  const search = recordSearchConfig.safeParse(node.config);
  const output = outputs[source.nodeId];
  if (
    !search.success ||
    !outputRecord(output) ||
    !Object.hasOwn(output, "all") ||
    !Array.isArray(output.all)
  )
    return null;
  return { items: { kind: "records", items: output.all }, entity: search.data.entity };
}

function prepare(input: RuntimeInput, iteratorNodeId: string) {
  const compiled = compileWorkflowIteratorGraph(input.definition, iteratorNodeId);
  if (!compiled.ok) return compiled;
  const { graph, config, entryNodeId, doneNodeId, body, nonBodySteps } = compiled.value;
  const source = resolveItems(compiled.value, input.outputs);
  if (source === null) return err("invalid_source" as const);
  const { entity } = source;
  const armed = armWorkflowIterator(
    {
      runId: input.runId,
      iteratorNodeId,
      entryNodeId,
      doneNodeId,
      body,
      nonBodySteps,
      continueOnIterationFailure: config.shouldContinueOnIterationFailure,
    },
    source.items,
    input.outputs,
    entity === undefined ? undefined : (item) => workflowRecordSnapshot(entity, item),
  );
  return armed.ok ? ok({ transition: armed.value, graph, entity }) : armed;
}

function persistencePlan(transition: WorkflowIteratorTransition): WorkflowIteratorRuntimePlan {
  if (transition.status === "done") return { ...transition, iteratorFrame: null };
  const { execution, items, failedCount } = transition.frame;
  return {
    status: "running",
    nextNodeId: execution.nodeId,
    outputs: transition.outputs,
    iteratorFrame: {
      version: 1,
      iteratorNodeId: execution.iteratorNodeId,
      itemIndex: execution.iterationIndex,
      itemCount: items.length,
      failedCount,
    },
  };
}

export function armWorkflowIteratorRuntime(
  input: RuntimeInput & { iteratorNodeId: string },
): Result<WorkflowIteratorRuntimePlan, RuntimeFailure> {
  const prepared = prepare(input, input.iteratorNodeId);
  return prepared.ok ? ok(persistencePlan(prepared.value.transition)) : prepared;
}

function readBodyPrefix(
  graph: WorkflowIteratorGraphIndex,
  frame: WorkflowIteratorFrame,
  receipts: readonly WorkflowIteratorBodyReceipt[],
): RunOutputs | null {
  const allowed = new Set(frame.plan.body.map(({ id }) => id));
  const expected = new Set<string>();
  let cursor = frame.execution.nodeId;
  if (!allowed.has(cursor)) return null;
  while (cursor !== frame.plan.entryNodeId) {
    const parent = graph.incoming.get(cursor)?.from;
    if (parent === undefined || !allowed.has(parent)) return null;
    expected.add(parent);
    cursor = parent;
  }
  if (receipts.length !== expected.size) return null;
  const outputs: RunOutputs = {};
  for (const { runId, nodeId, iterationIndex, output } of receipts) {
    if (
      runId !== frame.execution.runId ||
      iterationIndex !== frame.execution.iterationIndex ||
      !expected.delete(nodeId) ||
      !outputRecord(output)
    )
      return null;
    Object.defineProperty(outputs, nodeId, { value: output, enumerable: true });
  }
  return outputs;
}

function iteratorMappingOutput(frame: WorkflowIteratorFrame): StepOutput {
  const output: StepOutput = {
    currentItemIndex: frame.execution.iterationIndex,
    hasProcessedAllItems: false,
  };
  const item = frame.currentItem;
  if (item === null || typeof item !== "object") return { ...output, currentItem: item };
  for (const [key, value] of Object.entries(item)) output[`currentItem.${key}`] = value;
  return output;
}

export function resumeWorkflowIteratorRuntime(
  input: RuntimeInput & {
    nextNodeId: string | null;
    iteratorFrame: unknown;
    receipts: readonly WorkflowIteratorBodyReceipt[];
  },
): Result<ActiveWorkflowIterator, RuntimeFailure> {
  const parsed = workflowIteratorCursor.safeParse(input.iteratorFrame);
  if (!parsed.success || input.nextNodeId === null) return err("invalid_cursor");
  const cursor = parsed.data;
  const prepared = prepare(input, cursor.iteratorNodeId);
  if (!prepared.ok) return prepared;
  const { graph, entity, transition } = prepared.value;
  if (transition.status !== "running" || transition.frame.items.length !== cursor.itemCount)
    return err("invalid_cursor");
  const currentItem = transition.frame.items[cursor.itemIndex];
  if (currentItem === undefined) return err("invalid_cursor");
  const frame = Object.freeze({
    ...transition.frame,
    currentItem,
    failedCount: cursor.failedCount,
    execution: Object.freeze({
      ...transition.frame.execution,
      nodeId: input.nextNodeId,
      iterationIndex: cursor.itemIndex,
    }),
  });
  const prefix = readBodyPrefix(graph, frame, input.receipts);
  if (prefix === null) return err("invalid_receipts");
  return ok({
    frame,
    durableOutputs: transition.outputs,
    executionOutputs: {
      ...transition.outputs,
      ...prefix,
      [cursor.iteratorNodeId]: iteratorMappingOutput(frame),
    },
    currentRecord:
      entity !== undefined && currentItem !== null && typeof currentItem === "object"
        ? { entity, id: currentItem.id }
        : null,
  });
}

// Call with the branch selection from the actual executed body node. The run
// lock owner commits its receipt and this plan together. Failed items release
// their scope only when the node error was classified as rollback-safe.
export function advanceWorkflowIteratorRuntime(
  active: ActiveWorkflowIterator,
  completion: unknown,
): Result<WorkflowIteratorRuntimePlan, RuntimeFailure> {
  const advanced = advanceWorkflowIterator(active.frame, completion, active.durableOutputs);
  return advanced.ok ? ok(persistencePlan(advanced.value)) : advanced;
}

// A terminal failure or cancellation may discard the frame without promoting
// its current item or any body result into the run's retained output map.
export function releaseWorkflowIteratorRuntime(active: ActiveWorkflowIterator) {
  return { iteratorFrame: null, outputs: active.durableOutputs };
}
