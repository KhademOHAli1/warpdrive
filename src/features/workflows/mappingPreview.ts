import { customDraftLiteralSchema } from "./configurationBindings";
import { literalMappingContract } from "./mappingCompatibility";
import type { MappingInspection, MappingPreview, MappingValueKind } from "./mappingTypes";
import { draftBindingSchema } from "./schemas";

function example(
  kind: MappingValueKind,
): Extract<MappingPreview, { state: "reference" }>["example"] {
  if (kind === "entity") return { synthetic: true, kind };
  if (kind === "number") return { synthetic: true, kind, value: 1234.5 };
  if (kind === "boolean") return { synthetic: true, kind, value: false };
  if (kind === "decimal") return { synthetic: true, kind, value: "1234.50" };
  if (kind === "date") return { synthetic: true, kind, value: "2030-03-20" };
  if (kind === "instant") return { synthetic: true, kind, value: "2030-03-20T12:00:00.000Z" };
  return { synthetic: true, kind };
}

function rawLiteral(raw: unknown): { value: unknown } | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  if (!("kind" in raw) || raw.kind !== "value" || !("value" in raw)) return undefined;
  return customDraftLiteralSchema.safeParse(raw.value).success ? { value: raw.value } : undefined;
}

function literalPreview(raw: unknown, inspection: MappingInspection): MappingPreview {
  const value = rawLiteral(raw);
  if (raw !== undefined && value === undefined)
    return { state: "unavailable", reason: "unknown-output", issues: inspection.issues };
  const parsed = draftBindingSchema.safeParse(raw);
  const literal = parsed.success && parsed.data.kind === "value" ? parsed.data : undefined;
  let intent: MappingValueKind | "null" = "scalar";
  if (inspection.target?.literalContext === "decimal") intent = "decimal";
  else if (inspection.target?.customFieldId !== undefined) intent = inspection.target.contract.kind;
  else if (literal !== undefined) intent = literalMappingContract(literal).kind;
  if (value === undefined)
    return {
      state: "literal",
      presence: "omitted",
      intent,
      valid: inspection.issues.length === 0,
      issues: inspection.issues,
    };
  return {
    state: "literal",
    presence: value.value === null ? "null" : "value",
    value: structuredClone(value.value),
    intent: value.value === null ? "null" : intent,
    valid: inspection.issues.length === 0,
    issues: inspection.issues,
  };
}

function referencePreview(
  inspection: MappingInspection,
  source: NonNullable<MappingInspection["source"]>,
): MappingPreview {
  if (inspection.compatibility === "incompatible")
    return { state: "unavailable", reason: "unknown-output", source, issues: inspection.issues };
  const detached = structuredClone(source);
  return {
    state: "reference",
    source: detached,
    possibleNull: detached.contract.nullable,
    runtimeOnly: true,
    example: example(detached.contract.kind),
    issues: inspection.issues,
  };
}

export function buildMappingPreview(raw: unknown, inspection: MappingInspection): MappingPreview {
  if (inspection.availability !== "available")
    return {
      state: "unavailable",
      reason: inspection.availability,
      source: inspection.source,
      issues: inspection.issues,
    };
  if (inspection.source !== undefined) return referencePreview(inspection, inspection.source);
  return literalPreview(raw, inspection);
}
