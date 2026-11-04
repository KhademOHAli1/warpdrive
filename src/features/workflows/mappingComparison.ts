import { Temporal } from "@js-temporal/polyfill";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { validateLiteralIntent } from "./mappingLiteralIntent";
import type { MappingResolution } from "./mappingResolution";

type Operator = "equals" | "notEquals" | "contains" | "exists";
type Value = Extract<MappingResolution, { state: "value" }>;

function isTemporal(value: Value) {
  return value.contract.kind === "date" || value.contract.kind === "instant";
}

function temporalEquality(left: Value, right: Value): Result<boolean, string> {
  const kind = left.contract.kind;
  if ((kind !== "date" && kind !== "instant") || kind !== right.contract.kind)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (
    validateLiteralIntent({ kind: "value", value: left.value, literalType: kind }) !== null ||
    validateLiteralIntent({ kind: "value", value: right.value, literalType: kind }) !== null ||
    typeof left.value !== "string" ||
    typeof right.value !== "string"
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (kind === "date") return ok(left.value === right.value);
  return ok(Temporal.Instant.compare(left.value, right.value) === 0);
}

function compareValues(
  operator: Exclude<Operator, "exists">,
  left: Value,
  right: Value,
): Result<{ result: boolean }, string> {
  if (operator === "contains") {
    if (
      isTemporal(left) ||
      isTemporal(right) ||
      typeof left.value !== "string" ||
      typeof right.value !== "string"
    )
      return err(ERROR_IDS.WORKFLOW_INVALID);
    return ok({ result: left.value.includes(right.value) });
  }
  const equality =
    isTemporal(left) || isTemporal(right)
      ? temporalEquality(left, right)
      : ok(left.value === right.value);
  if (!equality.ok) return equality;
  return ok({ result: operator === "equals" ? equality.value : !equality.value });
}

export function compareMappingValues(
  operator: Operator,
  left: MappingResolution,
  right?: MappingResolution,
): Result<{ result: boolean }, string> {
  if (left.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (left.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  if (operator === "exists") return ok({ result: left.state !== "null" });
  if (right === undefined || right.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  if (right.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (left.state === "null" || right.state === "null") {
    if (operator === "contains") return err(ERROR_IDS.WORKFLOW_INVALID);
    const equal = left.state === right.state;
    return ok({ result: operator === "equals" ? equal : !equal });
  }
  return compareValues(operator, left, right);
}
