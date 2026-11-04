import { z } from "zod";
import { validateLiteralIntent } from "./mappingLiteralIntent";
import type { MappingOutput, MappingValueContract } from "./mappingTypes";
import type { RunOutputs } from "./runTypes";
import { type DraftValueBinding, draftBindingSchema, type ReferenceBinding } from "./schemas";

type MappingScalar = string | number | boolean;
export type MappingResolution =
  | { state: "value"; value: MappingScalar; contract: MappingValueContract }
  | { state: "null"; contract?: MappingValueContract }
  | { state: "missing"; reason: "binding-absent" | "source-absent" | "property-absent" }
  | {
      state: "invalid";
      code: "binding-invalid" | "intent-invalid" | "output-type-invalid" | "descriptor-missing";
    };

function resolveLiteral(binding: DraftValueBinding): MappingResolution {
  if (validateLiteralIntent(binding) !== null) return { state: "invalid", code: "intent-invalid" };
  if (binding.value === null) return { state: "null" };
  const kind =
    binding.literalType ??
    (typeof binding.value === "string"
      ? "text"
      : typeof binding.value === "number"
        ? "number"
        : "boolean");
  return { state: "value", value: binding.value, contract: { kind, nullable: false } };
}

function matchesSource(
  reference: ReferenceBinding,
  source: MappingOutput | undefined,
): source is MappingOutput {
  return (
    source !== undefined &&
    source.nodeId === reference.nodeId &&
    source.path.length === reference.path.length &&
    source.path.every((part, index) => part === reference.path[index])
  );
}

function temporalValue(value: string, kind: "date" | "instant") {
  return validateLiteralIntent({ kind: "value", value, literalType: kind }) === null;
}

function validStringOutput(value: string, contract: MappingValueContract) {
  switch (contract.kind) {
    case "text":
    case "scalar":
      return true;
    case "date":
    case "instant":
      return temporalValue(value, contract.kind);
    case "decimal":
      return value.trim() === value && /^[+-]?\d+(?:\.\d+)?$/.test(value);
    case "entity":
      return contract.entity !== undefined && z.string().uuid().safeParse(value).success;
    default:
      return false;
  }
}

function validOutput(value: unknown, contract: MappingValueContract): value is MappingScalar {
  if (typeof value === "string") return validStringOutput(value, contract);
  if (typeof value === "number")
    return Number.isFinite(value) && (contract.kind === "number" || contract.kind === "scalar");
  return typeof value === "boolean" && (contract.kind === "boolean" || contract.kind === "scalar");
}

function resolveReference(
  reference: ReferenceBinding,
  outputs: RunOutputs,
  source?: MappingOutput,
): MappingResolution {
  if (!matchesSource(reference, source)) return { state: "invalid", code: "descriptor-missing" };
  if (!Object.hasOwn(outputs, reference.nodeId))
    return { state: "missing", reason: "source-absent" };
  const output = outputs[reference.nodeId];
  if (output === undefined) return { state: "missing", reason: "source-absent" };
  if (output === null || typeof output !== "object" || Array.isArray(output))
    return { state: "invalid", code: "output-type-invalid" };
  const field = reference.path.join(".");
  if (!Object.hasOwn(output, field)) return { state: "missing", reason: "property-absent" };
  const value = output[field];
  if (value === null)
    return source.contract.nullable
      ? { state: "null", contract: source.contract }
      : { state: "invalid", code: "output-type-invalid" };
  return validOutput(value, source.contract)
    ? { state: "value", value, contract: source.contract }
    : { state: "invalid", code: "output-type-invalid" };
}

// A descriptor qualifies the real output type; it is not an authority token. Callers
// still inspect the reference against the actual pinned graph/current target first.
// Lookup never fetches current CRM data or repairs a historical receipt.
export function resolveMapping(
  raw: unknown,
  outputs: RunOutputs,
  source?: MappingOutput,
): MappingResolution {
  if (raw === undefined) return { state: "missing", reason: "binding-absent" };
  const parsed = draftBindingSchema.safeParse(raw);
  if (!parsed.success) return { state: "invalid", code: "binding-invalid" };
  return parsed.data.kind === "value"
    ? resolveLiteral(parsed.data)
    : resolveReference(parsed.data, outputs, source);
}
