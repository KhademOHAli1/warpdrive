import { err, ok, type Result } from "@/types/result";
import {
  type ConditionPredicateEntry,
  conditionOperandEntry,
  findConditionPredicate,
  type GroupedConditionConfig,
  type LegacyConditionConfig,
  type LegacyPredicateOperator,
  type ParsedConditionConfig,
  type PredicateOperator,
  parseConditionConfig,
} from "./conditionExpression";
import { conditionRecord } from "./conditionExpressionBudget";
import type { ConfigurationIssue, ConfigurationMetadata } from "./configurationTypes";
import {
  conditionTargetForRole,
  describeMappingTarget,
  inspectMapping,
  mappingOutputForReference,
  sameMappingReference,
} from "./mappingCatalog";
import { literalMappingContract } from "./mappingCompatibility";
import { type MappingResolution, resolveMapping } from "./mappingResolution";
import type { MappingInspection, MappingTarget, MappingValueContract } from "./mappingTypes";
import type { RunOutputs } from "./runTypes";
import {
  bindingSchema,
  draftBindingSchema,
  type ReferenceBinding,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";

export interface ConditionContext {
  definition: WorkflowDefinition;
  nodeId: string;
  metadata?: ConfigurationMetadata;
}
export interface ConditionOperandPlan {
  raw: unknown;
  target: MappingTarget;
  inspection: MappingInspection;
  literalContract?: MappingValueContract;
}
export interface ConditionPredicatePlan {
  id: string;
  path: readonly string[];
  operator: PredicateOperator | "greaterThan";
  left: ConditionOperandPlan;
  right?: ConditionOperandPlan;
  issues: ConfigurationIssue[];
}
export type PreparedConditionConfig =
  | { kind: "legacy"; config: LegacyConditionConfig; predicates: ConditionPredicatePlan[] }
  | { kind: "grouped"; config: GroupedConditionConfig; predicates: ConditionPredicatePlan[] };
export type ConditionMappingSelectionResult =
  | { ok: true; definition: WorkflowDefinition; changed: boolean }
  | { ok: false; issue: ConfigurationIssue };
function issue(
  nodeId: string,
  path: readonly string[],
  code: ConfigurationIssue["code"],
): ConfigurationIssue {
  return { nodeId, path, code };
}
function conditionNode(definition: WorkflowDefinition, nodeId: string): WorkflowNode | undefined {
  const nodes = definition.nodes.filter((node) => node.id === nodeId && node.type === "condition");
  return nodes.length === 1 ? nodes[0] : undefined;
}
function bindingContract(
  raw: unknown,
  definition?: WorkflowDefinition,
): MappingValueContract | undefined {
  const parsed = draftBindingSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  if (parsed.data.kind === "value") return literalMappingContract(parsed.data);
  return definition === undefined
    ? undefined
    : mappingOutputForReference(definition, parsed.data)?.contract;
}
function operandLiteralContract(
  raw: unknown,
  target: MappingTarget,
  inspection: MappingInspection,
): MappingValueContract | undefined {
  const parsed = draftBindingSchema.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== "value") return undefined;
  const declared = literalMappingContract(parsed.data);
  if (inspection.issues.length > 0) return declared;
  if (target.literalContext === "decimal" || target.contract.kind === "entity")
    return { ...target.contract };
  return declared;
}
function operandTarget(
  parsed: ParsedConditionConfig,
  entry: ConditionPredicateEntry,
  side: "left" | "right",
  operator: PredicateOperator | "greaterThan",
  context: ConditionContext | undefined,
): Result<MappingTarget, ConfigurationIssue[]> {
  const nodeId = context?.nodeId ?? "condition";
  const path = [...entry.path, side];
  if (parsed.kind === "legacy" && context !== undefined) {
    const target = describeMappingTarget(context.definition, nodeId, path, context.metadata);
    return target.state === "ready" ? ok(target.target) : err(target.issues);
  }
  return ok(
    conditionTargetForRole(
      nodeId,
      path,
      side,
      operator,
      bindingContract(entry.predicate.left, context?.definition),
    ),
  );
}
function operandPlan(
  parsed: ParsedConditionConfig,
  entry: ConditionPredicateEntry,
  side: "left" | "right",
  operator: PredicateOperator | "greaterThan",
  context: ConditionContext | undefined,
): Result<ConditionOperandPlan, ConfigurationIssue[]> {
  const target = operandTarget(parsed, entry, side, operator, context);
  if (!target.ok) return target;
  const raw = entry.predicate[side];
  const inspection = inspectMapping(
    context?.definition,
    context?.nodeId ?? "condition",
    target.value,
    raw,
    context?.metadata,
  );
  return ok({
    raw,
    target: target.value,
    inspection,
    literalContract: operandLiteralContract(raw, target.value, inspection),
  });
}
function rowOperator(
  parsed: ParsedConditionConfig,
  entry: ConditionPredicateEntry,
): LegacyPredicateOperator | PredicateOperator | undefined {
  return parsed.kind === "legacy" ? parsed.config.operator : entry.predicate.operator;
}
function needsRight(
  operator: PredicateOperator | "greaterThan",
  entry: ConditionPredicateEntry,
): boolean {
  return (
    (operator !== "exists" && operator !== "isEmpty") || Object.hasOwn(entry.predicate, "right")
  );
}
function buildPlan(
  parsed: ParsedConditionConfig,
  entry: ConditionPredicateEntry,
  context?: ConditionContext,
): Result<ConditionPredicatePlan, ConfigurationIssue[]> {
  const nodeId = context?.nodeId ?? "condition";
  const operator = rowOperator(parsed, entry);
  if (entry.id === undefined || operator === undefined)
    return err([issue(nodeId, entry.path, "required")]);
  const left = operandPlan(parsed, entry, "left", operator, context);
  if (!left.ok) return left;
  let right: ConditionOperandPlan | undefined;
  if (needsRight(operator, entry)) {
    const result = operandPlan(parsed, entry, "right", operator, context);
    if (!result.ok) return result;
    right = result.value;
  }
  return ok({
    id: entry.id,
    path: [...entry.path],
    operator,
    left: left.value,
    right,
    issues: [...left.value.inspection.issues, ...(right?.inspection.issues ?? [])],
  });
}
export function describeConditionPredicate(
  definition: WorkflowDefinition,
  nodeId: string,
  predicateId: string,
  metadata?: ConfigurationMetadata,
): Result<ConditionPredicatePlan, ConfigurationIssue[]> {
  const node = conditionNode(definition, nodeId);
  if (node === undefined) return err([issue(nodeId, [], "invalid_value")]);
  const parsed = parseConditionConfig(node.config, "draft");
  if (!parsed.ok) return err(parsed.error.map((entry) => ({ ...entry, nodeId })));
  const entry = findConditionPredicate(parsed.value, predicateId);
  if (entry === undefined) return err([issue(nodeId, [], "invalid_value")]);
  return buildPlan(parsed.value, entry, { definition, nodeId, metadata });
}
export function prepareConditionConfig(
  raw: unknown,
  context?: ConditionContext,
): Result<PreparedConditionConfig, ConfigurationIssue[]> {
  const nodeId = context?.nodeId ?? "condition";
  const parsed = parseConditionConfig(raw, "execute");
  if (!parsed.ok) return err(parsed.error.map((entry) => ({ ...entry, nodeId })));
  // Keep the old flat evaluator's descriptor-free/reference and greaterThan policy.
  if (parsed.value.kind === "legacy")
    return ok({
      kind: "legacy",
      config: parsed.value.config as LegacyConditionConfig,
      predicates: [],
    });
  if (context !== undefined && conditionNode(context.definition, nodeId) === undefined)
    return err([issue(nodeId, [], "invalid_value")]);
  const predicates: ConditionPredicatePlan[] = [];
  const issues: ConfigurationIssue[] = [];
  for (const entry of parsed.value.entries) {
    const plan = buildPlan(parsed.value, entry, context);
    if (!plan.ok) issues.push(...plan.error);
    else {
      predicates.push(plan.value);
      issues.push(...plan.value.issues);
    }
  }
  return issues.length > 0
    ? err(issues)
    : ok({ kind: "grouped", config: parsed.value.config as GroupedConditionConfig, predicates });
}
export function resolveConditionOperand(
  plan: ConditionOperandPlan,
  outputs: RunOutputs,
): MappingResolution {
  if (plan.inspection.compatibility === "incompatible" || plan.inspection.issues.length > 0)
    return { state: "invalid", code: "binding-invalid" };
  const resolved = resolveMapping(plan.raw, outputs, plan.inspection.source);
  if (resolved.state !== "value" || plan.literalContract === undefined) return resolved;
  return { ...resolved, contract: { ...plan.literalContract } };
}
function replaceOperand(
  config: WorkflowNode["config"],
  path: readonly string[],
  binding: ReferenceBinding,
): boolean {
  let current: unknown = config;
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (conditionRecord(current) && Object.hasOwn(current, segment))
      current = current[segment];
    else return false;
  }
  const side = path.at(-1);
  if (!conditionRecord(current) || (side !== "left" && side !== "right")) return false;
  current[side] = binding;
  return true;
}
export function applyConditionMappingSelection(
  definition: WorkflowDefinition,
  nodeId: string,
  selection: { path: readonly string[]; expectedPredicateId: string; binding: unknown },
  metadata: ConfigurationMetadata | undefined,
  editable: boolean,
): ConditionMappingSelectionResult {
  const denied: ConditionMappingSelectionResult = {
    ok: false,
    issue: issue(nodeId, [], "reference_unavailable"),
  };
  if (!editable || metadata?.status === "denied") return denied;
  const node = conditionNode(definition, nodeId);
  if (node === undefined) return denied;
  const parsed = parseConditionConfig(node.config, "draft");
  if (!parsed.ok) return denied;
  const located = conditionOperandEntry(parsed.value, selection.path);
  if (located === undefined || located.entry.id !== selection.expectedPredicateId) return denied;
  const binding = bindingSchema.options[1].safeParse(selection.binding);
  if (!binding.success) return denied;
  const plan = describeConditionPredicate(
    definition,
    nodeId,
    selection.expectedPredicateId,
    metadata,
  );
  if (!plan.ok) return denied;
  const target = operandTarget(parsed.value, located.entry, located.operand, plan.value.operator, {
    definition,
    nodeId,
    metadata,
  });
  if (!target.ok) return denied;
  const inspected = inspectMapping(definition, nodeId, target.value, binding.data, metadata);
  if (inspected.availability !== "available" || inspected.compatibility === "incompatible")
    return denied;
  if (sameMappingReference(located.entry.predicate[located.operand], binding.data))
    return { ok: true, definition, changed: false };
  const copy = structuredClone(definition);
  const changed = conditionNode(copy, nodeId);
  if (changed === undefined || !replaceOperand(changed.config, target.value.path, binding.data))
    return denied;
  return { ok: true, definition: copy, changed: true };
}
