import { ERROR_IDS } from "@/constants/errorIds";
import { err } from "@/types/result";
import { evaluateGroupedCondition } from "./conditionEvaluation";
import type { LegacyConditionConfig } from "./conditionExpression";
import { type ConditionContext, prepareConditionConfig } from "./conditionMapping";
import { compareMappingValues } from "./mappingComparison";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";

function evaluateLegacyCondition(
  config: LegacyConditionConfig,
  outputs: RunOutputs,
  context?: ConditionContext,
) {
  const { left, operator, right } = config;
  const lhs = resolveRunBinding(
    left,
    outputs,
    context === undefined ? undefined : { ...context, path: ["left"] },
  );
  if (lhs.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (lhs.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  if (operator === "exists") return compareMappingValues(operator, lhs);
  if (operator === "greaterThan") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (right === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  const rhs = resolveRunBinding(
    right,
    outputs,
    context === undefined ? undefined : { ...context, path: ["right"] },
  );
  return compareMappingValues(operator, lhs, rhs);
}

export function evaluateCondition(raw: unknown, outputs: RunOutputs, context?: ConditionContext) {
  const prepared = prepareConditionConfig(raw, context);
  if (!prepared.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  return prepared.value.kind === "legacy"
    ? evaluateLegacyCondition(prepared.value.config, outputs, context)
    : evaluateGroupedCondition(prepared.value, outputs);
}
