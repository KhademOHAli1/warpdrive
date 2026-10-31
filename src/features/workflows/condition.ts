import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { conditionConfigSchema } from "./registry";
import { bindingValue } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { Binding } from "./schemas";

function resolve(binding: Binding, outputs: RunOutputs) {
  const value = bindingValue(binding, outputs);
  if (value === undefined) return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (value !== null && typeof value === "object") return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok(value);
}
export function evaluateCondition(raw: unknown, outputs: RunOutputs) {
  const parsed = conditionConfigSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const { left, operator, right } = parsed.data;
  const lhs = resolve(left, outputs);
  if (!lhs.ok) return lhs;
  if (operator === "exists") return ok({ result: lhs.value !== null });
  if (operator === "greaterThan") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (right === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  const rhs = resolve(right, outputs);
  if (!rhs.ok) return rhs;
  if (operator === "equals") return ok({ result: lhs.value === rhs.value });
  if (operator === "notEquals") return ok({ result: lhs.value !== rhs.value });
  if (typeof lhs.value !== "string" || typeof rhs.value !== "string")
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok({ result: lhs.value.includes(rhs.value) });
}
