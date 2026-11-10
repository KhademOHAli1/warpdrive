import { prepareConditionConfig } from "./conditionMapping";
import { customFieldBindingSchema } from "./configurationBindings";
import { conditionContainsMismatch, temporalConditionMismatch } from "./configurationReference";
import { delayDurationSettings, delayDurationUnits } from "./delayConfig";
import { prepareIfElseConfig } from "./ifElse";
import { mappingPathNodes } from "./mappingAvailability";
import {
  describeMappingOutputs,
  describeMappingTarget,
  inspectMapping,
  mappingOutputForReference,
} from "./mappingCatalog";
import { actionRegistry } from "./registry";
import {
  type Binding,
  bindingSchema,
  type DefinitionIssue,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";
import { workflowHttpRequestConfig } from "./workflowHttpRequestContract";
import { iteratorSourceIsUpstream } from "./workflowIteratorConfiguration";
import { workflowManualLaunchScope } from "./workflowManualLaunchContract";
import { recordSearchBindingEntries, recordSearchDraftConfig } from "./workflowRecordQueryContract";

interface NodeBinding {
  field: string;
  binding: Binding;
  path?: readonly string[];
}

function parsedBindings(raw: unknown, parent?: string): NodeBinding[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([field, value]) => {
    const parsed = bindingSchema.safeParse(value);
    if (!parsed.success) return [];
    return parent === undefined
      ? [{ field, binding: parsed.data }]
      : [{ field: `${parent}.${field}`, path: [parent, field], binding: parsed.data }];
  });
}

function delayBindings(node: WorkflowNode): NodeBinding[] {
  const duration = delayDurationSettings(node.config.duration);
  return delayDurationUnits.flatMap((unit) => {
    const parsed = bindingSchema.options[1].safeParse(duration?.[unit]);
    return parsed.success
      ? [{ field: `duration.${unit}`, path: ["duration", unit], binding: parsed.data }]
      : [];
  });
}

function searchBindings(node: WorkflowNode): NodeBinding[] {
  const parsed = recordSearchDraftConfig.safeParse(node.config);
  if (!parsed.success) return [];
  return recordSearchBindingEntries(parsed.data).flatMap(({ path, value }) => {
    const binding = bindingSchema.safeParse(value);
    return binding.success ? [{ field: path.join("."), binding: binding.data, path }] : [];
  });
}

function customBindings(node: WorkflowNode): NodeBinding[] {
  const custom = node.config.customFields;
  if (custom === null || typeof custom !== "object" || Array.isArray(custom)) return [];
  return Object.entries(custom).flatMap(([id, value]) => {
    const parsed = customFieldBindingSchema.safeParse(value);
    return parsed.success && parsed.data.kind === "reference"
      ? [{ field: `customFields.${id}`, binding: parsed.data }]
      : [];
  });
}

function httpBindings(node: WorkflowNode): NodeBinding[] {
  const parsed = workflowHttpRequestConfig.safeParse(node.config);
  if (!parsed.success) return [];
  const { url, headers, body } = parsed.data;
  const make = (path: string[], binding: Binding): NodeBinding => ({
    path,
    field: path.join("."),
    binding,
  });
  const inputs = [
    make(["url"], url),
    ...(headers ?? []).map(({ value }, i) => make(["headers", String(i), "value"], value)),
  ];
  if (body?.kind === "text") inputs.push(make(["body", "value"], body.value));
  if (body?.kind === "json")
    inputs.push(
      ...body.fields.map(({ value }, i) => make(["body", "fields", String(i), "value"], value)),
    );
  return inputs;
}

function nodeBindings(node: WorkflowNode): NodeBinding[] {
  if (node.type === "http.request") return httpBindings(node);
  if (node.type === "record.search") return searchBindings(node);
  const nested =
    node.type === "delay" && node.config.delayType === "DURATION"
      ? delayBindings(node)
      : node.type === "record.create" ||
          node.type === "record.update" ||
          node.type === "record.upsert"
        ? parsedBindings(node.config.fields, "fields")
        : [];
  return [...parsedBindings(node.config), ...nested, ...customBindings(node)];
}

function structuralReferenceIssue(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  binding: Extract<Binding, { kind: "reference" }>,
): string | null {
  const path = mappingPathNodes(definition, node.id);
  if (!path.nodes.some((entry) => entry.id === binding.nodeId)) return "unavailable_reference";
  const source = definition.nodes.find((entry) => entry.id === binding.nodeId);
  if (source === undefined) return "unavailable_reference";
  if (source.type === "trigger.manual" && workflowManualLaunchScope(source.config) !== "deal")
    return "unknown_output";
  if (source.type === "iterator") {
    const outputs = describeMappingOutputs(definition, node.id).outputs;
    return outputs.some(
      (output) => output.nodeId === source.id && output.path.join(".") === binding.path.join("."),
    )
      ? null
      : "unknown_output";
  }
  if (
    source.type === "human.form" ||
    source.type === "http.request" ||
    source.type === "trigger.webhook"
  )
    return mappingOutputForReference(definition, binding) === undefined ? "unknown_output" : null;
  const key = binding.path.join(".");
  return Object.hasOwn(actionRegistry[source.type].outputs, key) ? null : "unknown_output";
}

function bindingIssue(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  field: string,
  binding: Binding,
  path: readonly string[] = [field],
): string | null {
  if (binding.kind === "reference") {
    const structural = structuralReferenceIssue(definition, node, binding);
    if (structural !== null) return structural;
    // Unsupported nominal handlers remain the separate NOT_READY gate. They are
    // never offered by the catalog or interpreted as qualified runtime values.
    if (mappingOutputForReference(definition, binding) === undefined) return null;
  }
  if (field.startsWith("customFields.")) return null; // Complete metadata owns target validation.
  const target = describeMappingTarget(definition, node.id, path);
  if (target.state !== "ready") return null;
  const inspected = inspectMapping(definition, node.id, target.target, binding);
  return inspected.compatibility === "incompatible" ? "type_mismatch" : null;
}

function groupedReferenceIssues(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): DefinitionIssue[] | null {
  if (node.type === "ifElse") {
    const checked = prepareIfElseConfig(node.config, { definition, nodeId: node.id });
    return checked.ok
      ? []
      : checked.error.map((issue) => ({
          code: issue.code,
          nodeId: node.id,
          field: issue.path.join("."),
          path: issue.path,
        }));
  }
  if (
    (node.type !== "condition" && node.type !== "filter") ||
    (!Object.hasOwn(node.config, "expression") && !Object.hasOwn(node.config, "defaultPort"))
  )
    return null;
  const prepared = prepareConditionConfig(node.config, { definition, nodeId: node.id });
  if (prepared.ok) return [];
  return prepared.error
    .filter((issue) => issue.code !== "unsupported_setting")
    .map((issue) => ({
      code: issue.code,
      nodeId: node.id,
      field: issue.path.join("."),
      path: issue.path,
    }));
}

function iteratorReferenceIssues(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): DefinitionIssue[] {
  const source = bindingSchema.options[1].safeParse(node.config.items);
  if (!source.success || iteratorSourceIsUpstream(definition, node, source.data.nodeId)) return [];
  return [{ code: "unavailable_reference", nodeId: node.id, field: "items", path: ["items"] }];
}

function inspectNodeReferences(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): DefinitionIssue[] {
  if (node.type === "iterator") return iteratorReferenceIssues(definition, node);
  const grouped = groupedReferenceIssues(definition, node);
  if (grouped !== null) return grouped;
  const issues: DefinitionIssue[] = [];
  for (const { field, binding, path } of nodeBindings(node)) {
    const code = bindingIssue(definition, node, field, binding, path);
    if (code !== null)
      issues.push({ code, nodeId: node.id, field, ...(path === undefined ? {} : { path }) });
  }
  if (temporalConditionMismatch(definition, node) || conditionContainsMismatch(definition, node))
    issues.push({ code: "type_mismatch", nodeId: node.id, field: "right" });
  return issues;
}

export function inspectReferences(definition: WorkflowDefinition): DefinitionIssue[] {
  return definition.nodes.flatMap((node) => inspectNodeReferences(definition, node));
}
