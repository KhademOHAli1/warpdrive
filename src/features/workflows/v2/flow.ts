import type {
  BlockJson,
  BlockOutput,
  WorkflowV2Definition,
  WorkflowV2Node,
  WorkflowV2RunState,
  WorkflowV2Token,
} from "@/features/blocks/contracts";
import { err, ok, type Result } from "@/types/result";

function record(value: BlockJson | undefined): value is BlockOutput {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}
function empty(value: BlockJson | undefined) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
function compare<T extends number | string | bigint>(left: T, right: T): number {
  return left === right ? 0 : left > right ? 1 : -1;
}
function scaledDecimal(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0")}`) * (negative ? -1n : 1n);
}
function ordered(left: BlockJson | undefined, right: BlockJson | undefined): number | null {
  if (typeof left === "number" && typeof right === "number") return compare(left, right);
  if (typeof left !== "string" || typeof right !== "string") return null;
  const decimal = /^-?\d{1,20}(?:\.\d{1,8})?$/;
  return decimal.test(left) && decimal.test(right)
    ? compare(scaledDecimal(left), scaledDecimal(right))
    : compare(left, right);
}
function equal(left: BlockJson | undefined, right: BlockJson | undefined) {
  return typeof left === typeof right && JSON.stringify(left) === JSON.stringify(right);
}
function matchOrdered(
  operator: string,
  left: BlockJson | undefined,
  right: BlockJson | undefined,
): Result<boolean, string> {
  const order = ordered(left, right);
  if (order === null) return err("E_WORKFLOW_V2_CONDITION_TYPE");
  if (operator === "gt") return ok(order > 0);
  if (operator === "gte") return ok(order >= 0);
  if (operator === "lt") return ok(order < 0);
  return ok(order <= 0);
}
function evaluateComparison(value: BlockOutput): Result<boolean, string> {
  const { left, right, operator } = value;
  if (typeof operator !== "string") return err("E_WORKFLOW_V2_CONDITION");
  switch (operator) {
    case "eq":
      return ok(equal(left, right));
    case "ne":
      return ok(!equal(left, right));
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return matchOrdered(operator, left, right);
    case "contains":
    case "starts_with":
      return typeof left === "string" && typeof right === "string"
        ? ok(operator === "contains" ? left.includes(right) : left.startsWith(right))
        : err("E_WORKFLOW_V2_CONDITION_TYPE");
    case "in":
      return Array.isArray(right)
        ? ok(right.some((item) => equal(item, left)))
        : err("E_WORKFLOW_V2_CONDITION_TYPE");
    case "is_empty":
      return ok(empty(left));
    case "is_not_empty":
      return ok(!empty(left));
    default:
      return err("E_WORKFLOW_V2_CONDITION");
  }
}
export function evaluateBlockCondition(raw: BlockJson): Result<boolean, string> {
  let count = 0;
  function evaluate(value: BlockJson, depth: number): Result<boolean, string> {
    if (++count > 200 || depth > 15 || !record(value)) return err("E_WORKFLOW_V2_CONDITION");
    if (value.combinator !== "and" && value.combinator !== "or") return evaluateComparison(value);
    if (!Array.isArray(value.conditions) || value.conditions.length === 0)
      return err("E_WORKFLOW_V2_CONDITION");
    const outcomes: boolean[] = [];
    for (const child of value.conditions) {
      const result = evaluate(child, depth + 1);
      if (!result.ok) return result;
      outcomes.push(result.value);
    }
    return ok(value.combinator === "and" ? outcomes.every(Boolean) : outcomes.some(Boolean));
  }
  return evaluate(raw, 0);
}
export interface FlowOutcome {
  output: BlockOutput;
  port?: string;
  stop?: boolean;
  wait?: {
    kind: "delay" | "form" | "event" | "chat";
    config: BlockOutput;
    wakeAt?: Date;
    expiresAt?: Date;
    responderId?: string;
  };
  iteratorItems?: BlockJson[];
}
type FlowHandler = (config: BlockOutput, now: Date) => Result<FlowOutcome, string>;
function filter(config: BlockOutput): Result<FlowOutcome, string> {
  const result = evaluateBlockCondition(config.condition ?? null);
  return result.ok
    ? ok({
        output: { matchesFilter: result.value, shouldEndWorkflowRun: !result.value },
        stop: !result.value,
      })
    : result;
}
function branch(config: BlockOutput): Result<FlowOutcome, string> {
  if (!Array.isArray(config.branches)) return err("E_WORKFLOW_V2_BRANCH");
  for (const value of config.branches) {
    if (!record(value) || typeof value.id !== "string") return err("E_WORKFLOW_V2_BRANCH");
    const result =
      value.condition === undefined ? ok(true) : evaluateBlockCondition(value.condition);
    if (!result.ok) return result;
    if (result.value) return ok({ output: { matchingBranchId: value.id }, port: value.id });
  }
  return err("E_WORKFLOW_V2_NO_BRANCH");
}
function iterator(config: BlockOutput): Result<FlowOutcome, string> {
  let items = config.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items) as BlockJson;
    } catch {
      return err("E_WORKFLOW_V2_ITERATOR_ITEMS");
    }
  }
  if (!Array.isArray(items) || items.length > 10_000) return err("E_WORKFLOW_V2_ITERATOR_ITEMS");
  return ok({ output: { hasProcessedAllItems: items.length === 0 }, iteratorItems: items });
}
function delay(config: BlockOutput, now: Date): Result<FlowOutcome, string> {
  const wakeAt =
    config.mode === "date" && typeof config.until === "string"
      ? new Date(config.until)
      : typeof config.seconds === "number"
        ? new Date(now.getTime() + config.seconds * 1000)
        : null;
  if (wakeAt === null || !Number.isFinite(wakeAt.getTime())) return err("E_WORKFLOW_V2_DELAY");
  return wakeAt <= now
    ? ok({ output: { resumedAt: now.toISOString() } })
    : ok({ output: {}, wait: { kind: "delay", config, wakeAt } });
}
const flowHandlers: Partial<Record<WorkflowV2Node["type"], FlowHandler>> = {
  FILTER: filter,
  IF_ELSE: branch,
  ITERATOR: iterator,
  DELAY: delay,
  FORM: (config) =>
    ok({
      output: {},
      wait: {
        kind: "form",
        config,
        ...(typeof config.responderId === "string" ? { responderId: config.responderId } : {}),
      },
    }),
  WAIT_FOR_EVENT: (config, now) =>
    ok({
      output: {},
      wait: {
        kind: "event",
        config,
        ...(typeof config.timeoutSeconds === "number"
          ? { expiresAt: new Date(now.getTime() + config.timeoutSeconds * 1000) }
          : {}),
      },
    }),
};
export function executeFlowNode(
  node: WorkflowV2Node,
  config: BlockOutput,
  now: Date,
): Result<FlowOutcome, string> {
  return flowHandlers[node.type]?.(config, now) ?? err("E_WORKFLOW_V2_NOT_FLOW");
}
export function tokensFor(
  definition: WorkflowV2Definition,
  nodeId: string,
  port: string,
  path: string[],
): WorkflowV2Token[] {
  return definition.edges
    .filter((edge) => edge.source === nodeId && edge.sourcePort === port)
    .map((edge) => ({
      nodeId: edge.target,
      framePath: [...path],
      visitKey: `${path.join("/")}|${edge.target}`,
    }));
}
function pathPrefix(path: string[], prefix: string[]) {
  return prefix.every((part, index) => path[index] === part);
}
export function finishFlowStep(
  state: WorkflowV2RunState,
  definition: WorkflowV2Definition,
  token: WorkflowV2Token,
  node: WorkflowV2Node,
  outcome: FlowOutcome,
) {
  state.outputs[`${token.framePath.join("/")}|${node.id}`] = {
    nodeId: node.id,
    framePath: token.framePath,
    output: outcome.output,
  };
  if (outcome.stop === true) {
    state.queue = [];
    state.frames = [];
    return;
  }
  if (outcome.iteratorItems !== undefined && outcome.iteratorItems.length > 0) {
    const frame = {
      id: node.id,
      iteratorId: node.id,
      items: outcome.iteratorItems,
      index: 0,
      parentPath: token.framePath,
      doneNodeIds: tokensFor(definition, node.id, "done", token.framePath).map(
        (next) => next.nodeId,
      ),
      bodyNodeIds: tokensFor(definition, node.id, "loop", token.framePath).map(
        (next) => next.nodeId,
      ),
      continueOnFailure: node.config.shouldContinueOnIterationFailure === true,
    };
    state.frames.push(frame);
    startIteration(state, frame);
    return;
  }
  state.queue.push(
    ...tokensFor(
      definition,
      node.id,
      outcome.iteratorItems !== undefined ? "done" : (outcome.port ?? "next"),
      token.framePath,
    ),
  );
  settleFrames(state);
}
function startIteration(state: WorkflowV2RunState, frame: WorkflowV2RunState["frames"][number]) {
  const path = [...frame.parentPath, `${frame.id}:${frame.index}`];
  state.outputs[`${frame.parentPath.join("/")}|${frame.iteratorId}`] = {
    nodeId: frame.iteratorId,
    framePath: frame.parentPath,
    output: {
      currentItemIndex: frame.index,
      currentItem: frame.items[frame.index] ?? null,
      hasProcessedAllItems: false,
    },
  };
  state.queue.push(
    ...frame.bodyNodeIds.map((nodeId) => ({
      nodeId,
      framePath: path,
      visitKey: `${path.join("/")}|${nodeId}`,
    })),
  );
}
export function settleFrames(state: WorkflowV2RunState) {
  for (let index = state.frames.length - 1; index >= 0; index--) {
    const frame = state.frames[index];
    if (frame === undefined) continue;
    const prefix = [...frame.parentPath, `${frame.id}:${frame.index}`];
    if (state.queue.some((token) => pathPrefix(token.framePath, prefix))) return;
    for (const [key, row] of Object.entries(state.outputs))
      if (pathPrefix(row.framePath, prefix)) delete state.outputs[key];
    if (++frame.index < frame.items.length) {
      startIteration(state, frame);
      return;
    }
    state.outputs[`${frame.parentPath.join("/")}|${frame.iteratorId}`] = {
      nodeId: frame.iteratorId,
      framePath: frame.parentPath,
      output: { currentItemIndex: frame.index, hasProcessedAllItems: true },
    };
    state.frames.splice(index, 1);
    state.queue.push(
      ...frame.doneNodeIds.map((nodeId) => ({
        nodeId,
        framePath: frame.parentPath,
        visitKey: `${frame.parentPath.join("/")}|${nodeId}`,
      })),
    );
  }
}
export function recoverIterationFailure(
  state: WorkflowV2RunState,
  token: WorkflowV2Token,
): boolean {
  const frame = state.frames.at(-1);
  if (frame === undefined || !frame.continueOnFailure) return false;
  const prefix = [...frame.parentPath, `${frame.id}:${frame.index}`];
  if (!pathPrefix(token.framePath, prefix)) return false;
  state.queue = state.queue.filter((queued) => !pathPrefix(queued.framePath, prefix));
  settleFrames(state);
  return true;
}
