import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import type { ConfigurationMetadata } from "./configurationTypes";
import { describeMappingTarget, inspectMapping } from "./mappingCatalog";
import { type MappingResolution, resolveMapping } from "./mappingResolution";
import type { RunOutputs } from "./runTypes";
import { type Binding, bindingSchema, type WorkflowDefinition } from "./schemas";

export interface RunMappingContext {
  definition: WorkflowDefinition;
  nodeId: string;
  path: readonly string[];
  metadata?: ConfigurationMetadata;
}

export function bindingValue(binding: Binding, outputs: RunOutputs) {
  if (binding.kind === "value") return binding.value;
  if (!Object.hasOwn(outputs, binding.nodeId)) return undefined;
  const output = outputs[binding.nodeId];
  const field = binding.path.join(".");
  return output !== undefined && Object.hasOwn(output, field) ? output[field] : undefined;
}

function resolveCurrentBinding(
  raw: unknown,
  outputs: RunOutputs,
  context: RunMappingContext,
): MappingResolution {
  const target = describeMappingTarget(
    context.definition,
    context.nodeId,
    context.path,
    context.metadata,
  );
  if (target.state !== "ready") return { state: "invalid", code: "binding-invalid" };
  const inspection = inspectMapping(
    context.definition,
    context.nodeId,
    target.target,
    raw,
    context.metadata,
  );
  if (inspection.availability !== "available" || inspection.compatibility === "incompatible")
    return { state: "invalid", code: "binding-invalid" };
  return resolveMapping(raw, outputs, inspection.source);
}

// Context-free legacy callers retain own-key scalar access. Actual run adapters pass
// their pinned definition and target so a coincidentally matching string is not a type.
export function resolveRunBinding(
  raw: unknown,
  outputs: RunOutputs,
  context?: RunMappingContext,
): MappingResolution {
  if (context !== undefined) return resolveCurrentBinding(raw, outputs, context);
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) return { state: "invalid", code: "binding-invalid" };
  const binding = parsed.data;
  if (binding.kind === "value") return resolveMapping(binding, outputs);
  const value = bindingValue(binding, outputs);
  if (value === undefined) return { state: "missing", reason: "property-absent" };
  return resolveMapping({ kind: "value", value }, outputs);
}

export function stringBinding(raw: unknown, outputs: RunOutputs, context?: RunMappingContext) {
  const resolved = resolveRunBinding(raw, outputs, context);
  if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  return resolved.state === "value" && typeof resolved.value === "string"
    ? ok(resolved.value)
    : err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
}

export function uuidBinding(raw: unknown, outputs: RunOutputs, context?: RunMappingContext) {
  const result = stringBinding(raw, outputs, context);
  if (!result.ok) return result;
  return z.string().uuid().safeParse(result.value).success
    ? result
    : err(ERROR_IDS.WORKFLOW_INVALID);
}
