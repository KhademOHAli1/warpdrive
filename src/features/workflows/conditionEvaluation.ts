import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { ConditionGroup } from "./conditionExpression";
import {
  type ConditionPredicatePlan,
  type PreparedConditionConfig,
  resolveConditionOperand,
} from "./conditionMapping";
import { compareMappingValues } from "./mappingComparison";
import type { MappingResolution } from "./mappingResolution";
import type { RunOutputs } from "./runTypes";

type Evaluated = Result<{ result: boolean }, string>;
type PresentValue = Exclude<MappingResolution, { state: "missing" | "invalid" }>;

function emptyText(left: PresentValue): Evaluated {
  if (left.state === "null") return ok({ result: false });
  if (left.contract.kind !== "text" || typeof left.value !== "string")
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok({ result: left.value.length === 0 });
}

function evaluatePredicate(plan: ConditionPredicatePlan, outputs: RunOutputs): Evaluated {
  const left = resolveConditionOperand(plan.left, outputs);
  if (left.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (left.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  const operator = plan.operator;
  if (operator === "isEmpty") return emptyText(left);
  if (operator === "exists") return compareMappingValues(operator, left);
  if (operator === "greaterThan") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (plan.right === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  return compareMappingValues(operator, left, resolveConditionOperand(plan.right, outputs));
}

function evaluateChild(
  child: ConditionGroup["children"][number],
  plans: ReadonlyMap<string, ConditionPredicatePlan>,
  outputs: RunOutputs,
): Result<boolean, string> {
  if (child.kind === "group") return evaluateGroup(child, plans, outputs);
  const plan = plans.get(child.id);
  if (plan === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  const evaluated = evaluatePredicate(plan, outputs);
  return evaluated.ok ? ok(evaluated.value.result) : evaluated;
}

function evaluateGroup(
  group: ConditionGroup,
  plans: ReadonlyMap<string, ConditionPredicatePlan>,
  outputs: RunOutputs,
): Result<boolean, string> {
  if (group.children.length === 0) return err(ERROR_IDS.WORKFLOW_INVALID);
  for (const child of group.children) {
    const evaluated = evaluateChild(child, plans, outputs);
    if (!evaluated.ok) return evaluated;
    if (group.operator === "and" && !evaluated.value) return ok(false);
    if (group.operator === "or" && evaluated.value) return ok(true);
  }
  return ok(group.operator === "and");
}

// Preparation validates every static row before this bounded traversal can skip
// runtime operands. Only actual completed outputs are resolved; no values are fetched.
export function evaluateGroupedCondition(
  prepared: Extract<PreparedConditionConfig, { kind: "grouped" }>,
  outputs: RunOutputs,
): Evaluated {
  const plans = new Map<string, ConditionPredicatePlan>(
    prepared.predicates.map((plan) => [plan.id, plan]),
  );
  const evaluated = evaluateGroup(prepared.config.expression, plans, outputs);
  return evaluated.ok ? ok({ result: evaluated.value }) : evaluated;
}
