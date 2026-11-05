import { ok } from "@/types/result";
import { evaluateCondition } from "./condition";
import type { ConditionContext } from "./conditionMapping";
import type { RunOutputs } from "./runTypes";

export function evaluateFilter(raw: unknown, outputs: RunOutputs, context?: ConditionContext) {
  const evaluated = evaluateCondition(raw, outputs, context);
  return evaluated.ok ? ok({ matchesFilter: evaluated.value.result }) : evaluated;
}
