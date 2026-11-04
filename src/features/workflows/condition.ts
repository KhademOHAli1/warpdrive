import { ERROR_IDS } from "@/constants/errorIds";
import { err } from "@/types/result";
import { compareMappingValues } from "./mappingComparison";
import { conditionConfigSchema } from "./registry";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";

interface ConditionContext {
  definition: WorkflowDefinition;
  nodeId: string;
}
export function evaluateCondition(raw: unknown, outputs: RunOutputs, context?: ConditionContext) {
  const parsed = conditionConfigSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const { left, operator, right } = parsed.data;
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
