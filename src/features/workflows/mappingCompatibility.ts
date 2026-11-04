import type { CustomFieldType } from "@/constants/customFieldTypes";
import type { MappingCompatibility, MappingTarget, MappingValueContract } from "./mappingTypes";
import type { DraftValueBinding } from "./schemas";

export function isExactMappingDecimal(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && /^[+-]?\d+(?:\.\d+)?$/.test(value);
}

export function customMappingContract(
  type: CustomFieldType,
  fieldId?: string,
): MappingValueContract {
  if (type === "user" || type === "person")
    return { kind: "entity", entity: type, nullable: false };
  if (type === "org") return { kind: "entity", entity: "organization", nullable: false };
  if (type === "single_option" || type === "multi_option")
    return {
      kind: type === "single_option" ? "option" : "options",
      optionFieldId: fieldId,
      nullable: false,
    };
  if (type === "numeric" || type === "monetary") return { kind: "number", nullable: false };
  if (type === "date_range" || type === "time_range")
    return { kind: type === "date_range" ? "date-range" : "time-range", nullable: false };
  if (type === "date" || type === "time" || type === "address")
    return { kind: type, nullable: false };
  return { kind: "text", nullable: false };
}

export function literalMappingContract(literal: DraftValueBinding): MappingValueContract {
  if (literal.literalType !== undefined) return { kind: literal.literalType, nullable: false };
  if (literal.value === null) return { kind: "scalar", nullable: true };
  if (typeof literal.value === "number") return { kind: "number", nullable: false };
  return { kind: typeof literal.value === "boolean" ? "boolean" : "text", nullable: false };
}

function sameKind(source: MappingValueContract, target: MappingValueContract): boolean {
  if (target.kind === "scalar")
    return ["text", "number", "boolean", "decimal", "date", "instant", "time", "entity"].includes(
      source.kind,
    );
  if (target.kind === "text") return ["text", "entity", "date", "instant"].includes(source.kind);
  if (source.kind !== target.kind) return false;
  if (target.kind === "entity")
    return target.entity !== undefined && source.entity === target.entity;
  if (target.kind === "option" || target.kind === "options")
    return target.optionFieldId !== undefined && source.optionFieldId === target.optionFieldId;
  return true;
}

export function mappingCompatibility(
  source: MappingValueContract,
  target: MappingTarget,
): MappingCompatibility {
  if (target.acceptedKinds !== undefined) {
    if (!target.acceptedKinds.includes(source.kind)) return "incompatible";
    if (target.contract.kind === "entity" && !sameKind(source, target.contract))
      return "incompatible";
  } else if (!sameKind(source, target.contract)) return "incompatible";
  return source.nullable && !target.contract.nullable ? "runtime-value-check" : "compatible";
}
