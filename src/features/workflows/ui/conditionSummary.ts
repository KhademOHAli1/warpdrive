import type { Locale } from "@/features/i18n/registry";
import { parseConditionConfig } from "../conditionExpression";
import { rawConditionGroup } from "../conditionExpressionBudget";
import type { ConditionPredicatePlan } from "../conditionMapping";
import { describeConditionPredicate } from "../conditionMapping";
import { describeMappingOutputs } from "../mappingCatalog";
import type messages from "../messages/workflows.en.json";
import { displayNodeName } from "../nodeNames";
import {
  bindingSchema,
  type DraftValueBinding,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { type ConditionObject, conditionChildren, conditionObject } from "./conditionGroupEdits";

interface Context {
  node: WorkflowNode;
  definition?: WorkflowDefinition;
  locale: Locale;
  messages: typeof messages;
  number: (value: number) => string;
  date: (value: string) => string;
  instant: (value: string) => string;
  status: (value: "open" | "won" | "lost") => string;
}
function referenceLabel(binding: { nodeId: string; path: readonly string[] }, context: Context) {
  const fields: Readonly<Record<string, string>> = context.messages.fields;
  const field = fields[binding.path.join(".")];
  if (context.definition === undefined) return field ?? context.messages.mappedValue;
  const outputs = describeMappingOutputs(context.definition, context.node.id).outputs;
  const qualified = outputs.some(
    (output) =>
      output.nodeId === binding.nodeId &&
      output.path.length === binding.path.length &&
      output.path.every((part, index) => part === binding.path[index]),
  );
  const source = context.definition.nodes.find((node) => node.id === binding.nodeId);
  return qualified && source !== undefined
    ? (field ?? context.messages.mappedValue) + " · " + displayNodeName(source, context.locale)
    : context.messages.unavailableValue;
}
function operandIssue(plan: ConditionPredicatePlan | undefined, operand: string) {
  const path = [...(plan?.path ?? []), operand];
  return (
    plan?.issues.some((issue) => path.every((part, index) => issue.path[index] === part)) === true
  );
}
function literalValue(binding: DraftValueBinding, context: Context, status: boolean): string {
  if (binding.value === null) return context.messages.configurationNullValue;
  if (binding.value === "") return context.messages.conditionEmpty;
  if (typeof binding.value === "boolean")
    return binding.value ? context.messages.boolTrue : context.messages.boolFalse;
  if (binding.literalType === "date" && typeof binding.value === "string")
    return context.date(binding.value) || context.messages.conditionInvalid;
  if (binding.literalType === "instant" && typeof binding.value === "string")
    return context.instant(binding.value) || context.messages.conditionInvalid;
  if (status && (binding.value === "open" || binding.value === "won" || binding.value === "lost"))
    return context.status(binding.value);
  return typeof binding.value === "number" ? context.number(binding.value) : binding.value;
}
function value(raw: unknown, context: Context, invalid: boolean, status = false): string {
  if (raw === undefined) return context.messages.conditionOmitted;
  if (invalid) return context.messages.conditionInvalid;
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) return context.messages.conditionInvalid;
  return parsed.data.kind === "reference"
    ? referenceLabel(parsed.data, context)
    : literalValue(parsed.data, context, status);
}
function predicate(entry: ConditionObject, context: Context) {
  const described =
    context.definition !== undefined && typeof entry.id === "string"
      ? describeConditionPredicate(context.definition, context.node.id, entry.id)
      : undefined;
  const plan = described?.ok === true ? described.value : undefined;
  const operators = {
    equals: context.messages.equals,
    notEquals: context.messages.notEquals,
    exists: context.messages.exists,
    contains: context.messages.contains,
    isEmpty: context.messages.isEmpty,
  };
  const operator = entry.operator;
  const label =
    operator === "equals" ||
    operator === "notEquals" ||
    operator === "exists" ||
    operator === "contains" ||
    operator === "isEmpty"
      ? operators[operator]
      : context.messages.conditionInvalid;
  const left = value(entry.left, context, operandIssue(plan, "left"));
  const source = bindingSchema.safeParse(entry.left);
  const status =
    source.success &&
    source.data.kind === "reference" &&
    source.data.path.length === 1 &&
    source.data.path[0] === "status";
  return operator === "exists" || operator === "isEmpty"
    ? left + " " + label
    : left + " " + label + " " + value(entry.right, context, operandIssue(plan, "right"), status);
}
function expression(entry: ConditionObject, context: Context): string {
  if (!rawConditionGroup(entry)) return predicate(entry, context);
  const label =
    entry.operator === "and"
      ? context.messages.conditionAll
      : entry.operator === "or"
        ? context.messages.conditionAny
        : context.messages.conditionOmitted;
  const parts = conditionChildren(entry).map((child) => {
    const object = conditionObject(child);
    return object === undefined ? context.messages.conditionInvalid : expression(object, context);
  });
  return (
    label +
    ": (" +
    (parts.length === 0 ? context.messages.conditionOmitted : parts.join("; ")) +
    ")"
  );
}
export function conditionSummary(context: Context) {
  const parsed = parseConditionConfig(context.node.config, "draft");
  if (!parsed.ok) return { text: context.messages.conditionInvalid, count: 0, grouped: false };
  if (parsed.value.kind === "legacy")
    return { text: predicate(context.node.config, context), count: 1, grouped: false };
  const root = conditionObject(context.node.config.expression);
  return {
    text: root === undefined ? context.messages.conditionOmitted : expression(root, context),
    count: parsed.value.entries.length,
    grouped: true,
  };
}
