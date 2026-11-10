import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { evaluateGroupedCondition } from "./conditionEvaluation";
import {
  type ConditionContext,
  type PreparedConditionConfig,
  prepareConditionConfig,
} from "./conditionMapping";
import type { ConfigurationIssue } from "./configurationTypes";
import { branchPath, parseIfElseConfig } from "./ifElseConfig";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export type { BranchPort } from "./ifElseBudget";
export {
  boundedIfElseConfig,
  branchPort,
  branchPortSchema,
  ifElseBranchLimit,
  ifElsePorts,
} from "./ifElseBudget";
export type { IfElseBranch, IfElseConfig } from "./ifElseConfig";
export { newIfElseBranch, newIfElseConfig, parseIfElseConfig } from "./ifElseConfig";

type NodeConfig = WorkflowNode["config"];

export type PreparedIfElseConfig = {
  branches: { id: string; predicate: Extract<PreparedConditionConfig, { kind: "grouped" }> }[];
  fallbackId: string;
};

export function projectIfElsePredicate(
  definition: WorkflowDefinition,
  nodeId: string,
  predicate: NodeConfig,
): WorkflowDefinition {
  // The condition editor and evaluator see one branch at a time, with the
  // same node ID, predecessors and reference scope as the real If/Else node.
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === nodeId ? { ...node, type: "condition", config: predicate } : node,
    ),
  };
}

export function prepareIfElseConfig(
  raw: unknown,
  context?: ConditionContext,
): Result<PreparedIfElseConfig, ConfigurationIssue[]> {
  const nodeId = context?.nodeId ?? "if_else";
  const parsed = parseIfElseConfig(raw, "execute");
  if (!parsed.ok) return err(parsed.error.map((issue) => ({ ...issue, nodeId })));
  const branches: PreparedIfElseConfig["branches"] = [];
  const issues: ConfigurationIssue[] = [];
  for (const [index, branch] of parsed.value.branches.entries()) {
    const predicateContext =
      context === undefined
        ? undefined
        : {
            ...context,
            definition: projectIfElsePredicate(
              context.definition,
              context.nodeId,
              branch.predicate,
            ),
          };
    const prepared = prepareConditionConfig(branch.predicate, predicateContext);
    if (!prepared.ok)
      issues.push(
        ...prepared.error.map((issue) => ({
          ...issue,
          nodeId,
          path: [...branchPath(index), ...issue.path],
        })),
      );
    else if (prepared.value.kind === "grouped")
      branches.push({ id: branch.id, predicate: prepared.value });
    else issues.push({ nodeId, path: branchPath(index), code: "invalid_value" });
  }
  return issues.length > 0 ? err(issues) : ok({ branches, fallbackId: parsed.value.fallbackId });
}

export function evaluatePreparedIfElse(
  prepared: PreparedIfElseConfig,
  outputs: RunOutputs,
): Result<{ matchingBranchId: string }, string> {
  for (const branch of prepared.branches) {
    const evaluated = evaluateGroupedCondition(branch.predicate, outputs);
    if (!evaluated.ok) return evaluated;
    if (evaluated.value.result) return ok({ matchingBranchId: branch.id });
  }
  return ok({ matchingBranchId: prepared.fallbackId });
}

export function evaluateIfElse(raw: unknown, outputs: RunOutputs, context?: ConditionContext) {
  const prepared = prepareIfElseConfig(raw, context);
  return prepared.ok
    ? evaluatePreparedIfElse(prepared.value, outputs)
    : err(ERROR_IDS.WORKFLOW_INVALID);
}
