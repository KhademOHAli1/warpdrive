import { z } from "zod";
import { buildCustomFieldsSchema, valueSchemaFor } from "@/features/custom-fields/validate";
import type { CustomFieldDef } from "@/types/customFields";
import { conditionOperandEntry, parseConditionConfig } from "./conditionExpression";
import { customFieldBindingSchema, customLiteralKeysAllowed } from "./configurationBindings";
import { getConfigurationSpec } from "./configurationSpec";
import type {
  ConfigurationFieldSpec,
  ConfigurationIssue,
  ConfigurationIssueCode,
  ConfigurationMetadata,
} from "./configurationTypes";
import { mappingPathNodes } from "./mappingAvailability";
import {
  customMappingContract,
  isExactMappingDecimal,
  literalMappingContract,
  mappingCompatibility,
} from "./mappingCompatibility";
import { validateLiteralIntent } from "./mappingLiteralIntent";
import { isMappingFieldKey } from "./mappingOutputs";
import type {
  MappingAvailability,
  MappingCatalog,
  MappingInspection,
  MappingOutput,
  MappingTarget,
  MappingTargetResult,
  MappingValueContract,
} from "./mappingTypes";
import { actionRegistry } from "./registry";
import {
  bindingSchema,
  type DraftValueBinding,
  draftBindingSchema,
  type ReferenceBinding,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";

function issue(
  nodeId: string,
  path: readonly string[],
  code: ConfigurationIssueCode,
): ConfigurationIssue {
  return { nodeId, path, code };
}

function knownVersion(value: unknown): boolean {
  return value === 1;
}

function qualifiedSource(node: WorkflowNode): boolean {
  if (!knownVersion(node.version) || !actionRegistry[node.type].configuration.supported)
    return false;
  return node.type !== "record.read" || node.config.entity === "deal";
}

function outputsFor(node: WorkflowNode): MappingOutput[] {
  if (!qualifiedSource(node)) return [];
  const needsConfiguration = !actionRegistry[node.type].config.safeParse(node.config).success;
  return Object.entries(actionRegistry[node.type].outputContracts).flatMap(([field, contract]) =>
    isMappingFieldKey(field)
      ? [
          {
            nodeId: node.id,
            path: [field],
            field,
            contract: structuredClone(contract),
            ...(needsConfiguration ? { needsConfiguration: true as const } : {}),
          },
        ]
      : [],
  );
}

export function mappingOutputForReference(
  definition: WorkflowDefinition,
  reference: ReferenceBinding,
): MappingOutput | undefined {
  if (!bindingSchema.options[1].safeParse(reference).success) return undefined;
  const nodes = definition.nodes.filter((node) => node.id === reference.nodeId);
  if (nodes.length !== 1) return undefined;
  const node = nodes[0];
  return node === undefined
    ? undefined
    : outputsFor(node).find((output) => output.path.join(".") === reference.path.join("."));
}

function catalog(
  definition: WorkflowDefinition,
  nodeId: string,
  metadata: ConfigurationMetadata | undefined,
  includeCurrent: boolean,
): MappingCatalog {
  if (metadata?.status === "denied") return { state: "denied", outputs: [] };
  const path = mappingPathNodes(definition, nodeId, includeCurrent);
  return {
    state: "ready",
    outputs: path.nodes.flatMap(outputsFor),
    ...(path.issue === undefined ? {} : { pathIssue: path.issue }),
  };
}

export function describeMappingOutputs(
  definition: WorkflowDefinition,
  nodeId: string,
  metadata?: ConfigurationMetadata,
): MappingCatalog {
  return catalog(definition, nodeId, metadata, false);
}

export function describeMappingOutputsAfter(
  definition: WorkflowDefinition,
  nodeId: string,
): MappingCatalog {
  return catalog(definition, nodeId, undefined, true);
}

export function legacyMappingTarget(
  nodeId: string,
  kind: "text" | "scalar" | "deal",
  options: { nullable?: boolean; required?: boolean } = {},
): MappingTarget {
  const nullable = options.nullable === true;
  return {
    nodeId,
    path: [],
    required: options.required === true,
    mode: "binding",
    contract: kind === "deal" ? { kind: "entity", entity: "deal", nullable } : { kind, nullable },
  };
}

function unavailableTarget(
  nodeId: string,
  path: readonly string[],
  reason: MappingAvailability,
  code: ConfigurationIssueCode,
): MappingTargetResult {
  return { state: "unavailable", reason, issues: [issue(nodeId, path, code)] };
}

function customDefinition(
  metadata: ConfigurationMetadata | undefined,
  id: string,
): CustomFieldDef | undefined {
  return metadata?.defs?.find(
    (def) => def.id === id && def.targetEntity === "activity" && def.archivedAt === null,
  );
}

function customTarget(
  node: WorkflowNode,
  path: readonly string[],
  metadata?: ConfigurationMetadata,
): MappingTargetResult {
  const id = path[1];
  if (node.type !== "activity.create" || path.length !== 2 || id === undefined)
    return unavailableTarget(node.id, path, "unknown-output", "unknown_setting");
  if (metadata?.status !== "complete")
    return unavailableTarget(node.id, path, "metadata-incomplete", "metadata_incomplete");
  const def = customDefinition(metadata, id);
  if (def === undefined) return unavailableTarget(node.id, path, "unknown-output", "unknown_field");
  return {
    state: "ready",
    target: {
      nodeId: node.id,
      path: [...path],
      contract: customMappingContract(def.type, def.id),
      required: def.isRequired,
      mode: "binding",
      customFieldId: def.id,
    },
  };
}

function conditionRightContract(definition: WorkflowDefinition, node: WorkflowNode) {
  const left = draftBindingSchema.safeParse(node.config.left);
  if (!left.success) return undefined;
  if (left.data.kind === "reference")
    return mappingOutputForReference(definition, left.data)?.contract;
  return literalMappingContract(left.data);
}

function targetForField(node: WorkflowNode, field: ConfigurationFieldSpec): MappingTarget {
  const kind =
    field.valueType === "deal" ? "deal" : field.valueType === "scalar" ? "scalar" : "text";
  const target = legacyMappingTarget(node.id, kind, {
    nullable: field.nullable,
    required: field.required,
  });
  target.path = [...field.path];
  if (field.requiredWhen !== undefined)
    target.required = node.config[field.requiredWhen.field] !== field.requiredWhen.not;
  if (field.control === "duration") {
    target.contract = { kind: "number", nullable: false };
    target.mode = "literal-only";
  }
  return target;
}

function builtinTarget(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  path: readonly string[],
): MappingTargetResult {
  if (path.length !== 1)
    return unavailableTarget(node.id, path, "unknown-output", "unknown_setting");
  const spec = getConfigurationSpec(node.type, node.version);
  const field = spec?.fields.find((entry) => entry.path.length === 1 && entry.path[0] === path[0]);
  if (field === undefined)
    return unavailableTarget(node.id, path, "unknown-output", "unknown_setting");
  if (field.control !== "binding" && field.control !== "duration")
    return unavailableTarget(node.id, path, "unknown-output", "unknown_setting");
  if (field.readOnly === true)
    return unavailableTarget(node.id, path, "unsupported-source", "unsupported_setting");
  const target = targetForField(node, field);
  if (node.type === "condition" && path[0] === "right") {
    const left = conditionRightContract(definition, node);
    if (left?.kind === "date" || left?.kind === "instant")
      target.contract = { kind: left.kind, nullable: true };
  }
  return { state: "ready", target };
}

export function describeMappingTarget(
  definition: WorkflowDefinition,
  nodeId: string,
  path: readonly string[],
  metadata?: ConfigurationMetadata,
): MappingTargetResult {
  const nodes = definition.nodes.filter((node) => node.id === nodeId);
  const node = nodes[0];
  if (nodes.length !== 1 || node === undefined)
    return unavailableTarget(nodeId, path, "source-missing", "reference_missing");
  if (node.type === "condition" && path[0] === "expression")
    return groupedConditionTarget(definition, node, path);
  return path[0] === "customFields"
    ? customTarget(node, path, metadata)
    : builtinTarget(definition, node, path);
}

function conditionLeftContract(
  definition: WorkflowDefinition,
  raw: unknown,
): MappingValueContract | undefined {
  const parsed = draftBindingSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data.kind === "reference"
    ? mappingOutputForReference(definition, parsed.data)?.contract
    : literalMappingContract(parsed.data);
}

function groupedRightTarget(
  target: MappingTarget,
  left: MappingValueContract | undefined,
  operator: unknown,
): MappingTarget {
  if (operator === "exists" || operator === "isEmpty") return { ...target, required: false };
  if (operator === "contains")
    return {
      ...target,
      contract: { kind: "text", nullable: false },
      acceptedKinds: ["text", "decimal"],
      ...(left?.kind === "decimal" ? { literalContext: "decimal-fragment" as const } : {}),
    };
  if (left === undefined || left.kind === "scalar") return target;
  return {
    ...target,
    contract: { ...left, nullable: true },
    acceptedKinds: [left.kind],
    ...(left.kind === "decimal" ? { literalContext: "decimal" as const } : {}),
  };
}

export function conditionTargetForRole(
  nodeId: string,
  path: readonly string[],
  operand: "left" | "right",
  operator: unknown,
  left: MappingValueContract | undefined,
): MappingTarget {
  let target: MappingTarget = {
    ...legacyMappingTarget(nodeId, "scalar", { required: true, nullable: true }),
    path: [...path],
  };
  if (operand === "right") return groupedRightTarget(target, left, operator);
  if (operator === "contains")
    target = {
      ...target,
      contract: { kind: "scalar", nullable: false },
      acceptedKinds: ["text", "decimal"],
    };
  if (operator === "isEmpty") target = { ...target, acceptedKinds: ["text"] };
  return target;
}

function groupedConditionTarget(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  path: readonly string[],
): MappingTargetResult {
  const parsed = parseConditionConfig(node.config, "draft");
  if (!parsed.ok || parsed.value.kind !== "grouped")
    return unavailableTarget(node.id, path, "unknown-output", "invalid_value");
  const located = conditionOperandEntry(parsed.value, path);
  if (located === undefined)
    return unavailableTarget(node.id, path, "unknown-output", "unknown_setting");
  const predicate = located.entry.predicate;
  return {
    state: "ready",
    target: conditionTargetForRole(
      node.id,
      path,
      located.operand,
      predicate.operator,
      conditionLeftContract(definition, predicate.left),
    ),
  };
}

function failedInspection(
  nodeId: string,
  target: MappingTarget | undefined,
  availability: MappingAvailability,
  code: ConfigurationIssueCode,
  source?: MappingOutput,
): MappingInspection {
  return {
    availability,
    compatibility: "incompatible",
    source,
    target,
    issues: [issue(nodeId, target?.path ?? [], code)],
    runtimeChecks: [],
  };
}

function missingSource(
  definition: WorkflowDefinition,
  nodeId: string,
  target: MappingTarget,
  reference: ReferenceBinding,
): MappingInspection {
  const nodes = definition.nodes.filter((node) => node.id === reference.nodeId);
  if (nodes.length === 0)
    return failedInspection(nodeId, target, "source-missing", "reference_missing");
  const source = nodes[0];
  const unsupported = nodes.length === 1 && source !== undefined && !qualifiedSource(source);
  return failedInspection(
    nodeId,
    target,
    unsupported ? "unsupported-source" : "unknown-output",
    unsupported ? "unsupported_setting" : "reference_missing",
  );
}

function referenceInspection(
  definition: WorkflowDefinition,
  nodeId: string,
  target: MappingTarget,
  reference: ReferenceBinding,
  metadata?: ConfigurationMetadata,
): MappingInspection {
  const source = mappingOutputForReference(definition, reference);
  if (source === undefined) return missingSource(definition, nodeId, target, reference);
  const available = describeMappingOutputs(definition, nodeId, metadata);
  if (available.state === "denied")
    return failedInspection(nodeId, target, "metadata-incomplete", "reference_unavailable");
  const present = available.outputs.some(
    (output) => output.nodeId === source.nodeId && output.path.join(".") === source.path.join("."),
  );
  if (!present)
    return failedInspection(
      nodeId,
      target,
      available.pathIssue ?? "not-upstream",
      "reference_missing",
      source,
    );
  if (target.mode === "literal-only")
    return failedInspection(nodeId, target, "available", "unsupported_setting", source);
  const compatibility = mappingCompatibility(source.contract, target);
  return {
    availability: "available",
    compatibility,
    source,
    target,
    issues:
      compatibility === "incompatible"
        ? [issue(nodeId, target.path, "reference_incompatible")]
        : [],
    runtimeChecks: compatibility === "incompatible" ? [] : [target.path],
  };
}

function customLiteralIssues(
  nodeId: string,
  target: MappingTarget,
  raw: unknown,
  metadata?: ConfigurationMetadata,
): ConfigurationIssue[] {
  const def =
    target.customFieldId === undefined
      ? undefined
      : customDefinition(metadata, target.customFieldId);
  const parsed = customFieldBindingSchema.safeParse(raw);
  if (def === undefined || !parsed.success || parsed.data.kind !== "value")
    return [issue(nodeId, target.path, "invalid_value")];
  if (!customLiteralKeysAllowed(def.type, parsed.data.value))
    return [issue(nodeId, target.path, "invalid_value")];
  if (!valueSchemaFor(def).safeParse(parsed.data.value).success)
    return [issue(nodeId, target.path, "invalid_value")];
  return buildCustomFieldsSchema([def]).safeParse({ [def.key]: parsed.data.value }).success
    ? []
    : [issue(nodeId, target.path, "required")];
}

function stringConstraint(
  value: string,
  field: ConfigurationFieldSpec,
  required: boolean,
): ConfigurationIssueCode | null {
  const constraints = field.constraints;
  if (constraints === undefined) return null;
  if (required && constraints.trim === true && value.trim() === "") return "required";
  if (constraints.maxLength !== undefined && value.length > constraints.maxLength)
    return "too_long";
  return null;
}

function numberConstraint(
  value: number,
  field: ConfigurationFieldSpec,
): ConfigurationIssueCode | null {
  const constraints = field.constraints;
  if (constraints === undefined) return null;
  if (constraints.integer === true && !Number.isInteger(value)) return "out_of_range";
  if (constraints.min !== undefined && value < constraints.min) return "out_of_range";
  if (constraints.max !== undefined && value > constraints.max) return "out_of_range";
  return null;
}

function literalConstraints(
  definition: WorkflowDefinition | undefined,
  target: MappingTarget,
  literal: DraftValueBinding,
): ConfigurationIssue[] {
  if (definition === undefined) return [];
  const node = definition.nodes.find((entry) => entry.id === target.nodeId);
  if (node === undefined) return [];
  const field = getConfigurationSpec(node.type, node.version)?.fields.find(
    (entry) => entry.path.join(".") === target.path.join("."),
  );
  if (field === undefined) return [];
  let code: ConfigurationIssueCode | null = null;
  if (typeof literal.value === "string")
    code = stringConstraint(literal.value, field, target.required);
  else if (typeof literal.value === "number") code = numberConstraint(literal.value, field);
  return code === null ? [] : [issue(node.id, target.path, code)];
}

function scalarLiteralIssues(
  definition: WorkflowDefinition | undefined,
  nodeId: string,
  target: MappingTarget,
  literal: DraftValueBinding,
): ConfigurationIssue[] {
  const invalid = validateLiteralIntent(literal);
  if (invalid !== null) return [issue(nodeId, target.path, invalid)];
  if (literal.value === null)
    return target.contract.nullable ? [] : [issue(nodeId, target.path, "invalid_type")];
  if (target.literalContext === "decimal")
    return literal.literalType === undefined && isExactMappingDecimal(literal.value)
      ? []
      : [issue(nodeId, target.path, "invalid_value")];
  if (target.contract.kind === "entity")
    return z.string().uuid().safeParse(literal.value).success && literal.literalType === undefined
      ? []
      : [issue(nodeId, target.path, "invalid_value")];
  if (mappingCompatibility(literalMappingContract(literal), target) === "incompatible")
    return [issue(nodeId, target.path, "invalid_type")];
  return literalConstraints(definition, target, literal);
}

function literalInspection(
  definition: WorkflowDefinition | undefined,
  nodeId: string,
  target: MappingTarget,
  raw: unknown,
  metadata?: ConfigurationMetadata,
): MappingInspection {
  let issues: ConfigurationIssue[];
  if (target.customFieldId !== undefined)
    issues = customLiteralIssues(nodeId, target, raw, metadata);
  else {
    const parsed = draftBindingSchema.safeParse(raw);
    issues =
      parsed.success && parsed.data.kind === "value"
        ? scalarLiteralIssues(definition, nodeId, target, parsed.data)
        : [issue(nodeId, target.path, "invalid_value")];
  }
  const identityCheck = target.contract.kind === "entity" && issues.length === 0;
  return {
    availability: "available",
    compatibility: issues.length === 0 ? "compatible" : "incompatible",
    target,
    issues,
    runtimeChecks: identityCheck ? [target.path] : [],
  };
}

export function inspectMapping(
  definition: WorkflowDefinition | undefined,
  nodeId: string,
  target: MappingTarget | undefined,
  raw: unknown,
  metadata?: ConfigurationMetadata,
): MappingInspection {
  if (target === undefined)
    return failedInspection(nodeId, target, "metadata-incomplete", "metadata_incomplete");
  if (target.customFieldId !== undefined && metadata?.status !== "complete")
    return failedInspection(nodeId, target, "metadata-incomplete", "metadata_incomplete");
  if (raw === undefined) {
    const issues = target.required ? [issue(nodeId, target.path, "required")] : [];
    return {
      availability: "available",
      compatibility: issues.length === 0 ? "compatible" : "incompatible",
      target,
      issues,
      runtimeChecks: [],
    };
  }
  const parsed = bindingSchema.options[1].safeParse(raw);
  if (parsed.success) {
    if (definition === undefined)
      return failedInspection(nodeId, target, "metadata-incomplete", "reference_unavailable");
    return referenceInspection(definition, nodeId, target, parsed.data, metadata);
  }
  return literalInspection(definition, nodeId, target, raw, metadata);
}

function applyReference(
  definition: WorkflowDefinition,
  nodeId: string,
  path: readonly string[],
  binding: ReferenceBinding,
): WorkflowDefinition | undefined {
  const copy = structuredClone(definition);
  const node = copy.nodes.find((entry) => entry.id === nodeId);
  const key = path[0];
  if (node === undefined || key === undefined) return undefined;
  if (key !== "customFields") {
    node.config[key] = binding;
    return copy;
  }
  const id = path[1];
  if (id === undefined) return undefined;
  const previous = node.config.customFields;
  const settings =
    previous !== null && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  node.config.customFields = { ...settings, [id]: binding };
  return copy;
}

export function sameMappingReference(left: unknown, right: unknown): boolean {
  const first = bindingSchema.options[1].safeParse(left);
  const second = bindingSchema.options[1].safeParse(right);
  if (!first.success || !second.success) return false;
  return (
    first.data.nodeId === second.data.nodeId &&
    first.data.path.length === second.data.path.length &&
    first.data.path.every((part, index) => part === second.data.path[index])
  );
}

function currentBinding(
  definition: WorkflowDefinition,
  nodeId: string,
  path: readonly string[],
): unknown {
  const node = definition.nodes.find((entry) => entry.id === nodeId);
  const key = path[0];
  if (node === undefined || key === undefined) return undefined;
  if (key !== "customFields") return node.config[key];
  const settings = node.config.customFields;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings))
    return undefined;
  const id = path[1];
  return id === undefined ? undefined : settings[id];
}

export function applyMappingSelection(
  definition: WorkflowDefinition,
  nodeId: string,
  target: MappingTarget,
  rawReference: unknown,
  metadata: ConfigurationMetadata | undefined,
  editable: boolean,
) {
  const denied = { ok: false as const, issue: issue(nodeId, target.path, "reference_unavailable") };
  if (target.path[0] === "expression") return denied;
  if (!editable) return denied;
  const current = describeMappingTarget(definition, nodeId, target.path, metadata);
  const binding = bindingSchema.options[1].safeParse(rawReference);
  if (current.state !== "ready" || !binding.success) return denied;
  if (
    inspectMapping(definition, nodeId, current.target, binding.data, metadata).compatibility ===
    "incompatible"
  )
    return denied;
  if (sameMappingReference(currentBinding(definition, nodeId, current.target.path), binding.data))
    return { ok: true as const, definition, changed: false };
  const copy = applyReference(definition, nodeId, current.target.path, binding.data);
  if (copy === undefined) return denied;
  return { ok: true as const, definition: copy, changed: true };
}
