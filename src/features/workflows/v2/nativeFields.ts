import type { CustomFieldType } from "@/constants/customFieldTypes";
import type { Db } from "@/db/client";
import { listDefs } from "@/features/custom-fields/defsRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { nativeBuiltinFields } from "./nativeBuiltinFields";
import { withNativeChoices } from "./nativeChoices";

export const NATIVE_OBJECT_NAMES = ["deal", "lead", "person", "organization", "activity"] as const;
export type NativeObjectName = (typeof NATIVE_OBJECT_NAMES)[number];
export const NATIVE_FILTER_OPERATORS = [
  "eq",
  "ne",
  "contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is_empty",
  "is_not_empty",
] as const;
export type NativeFilterOperator = (typeof NATIVE_FILTER_OPERATORS)[number];
export interface NativeFieldMetadata {
  key: string;
  label: string;
  valueType: "string" | "number" | "boolean" | "object" | "array";
  format?: string;
  required: boolean;
  readable: boolean;
  createable: boolean;
  updateable: boolean;
  upsertIdentity?: boolean;
  filterOperators: NativeFilterOperator[];
  options?: { id: string; label: string }[];
  referenceObject?: NativeObjectName | "user" | "pipeline" | "stage" | "activityType";
}

export function nativeObjectName(value: unknown): value is NativeObjectName {
  return typeof value === "string" && NATIVE_OBJECT_NAMES.some((name) => name === value);
}

export function nativeOperators(
  type: NativeFieldMetadata["valueType"],
  format?: string,
  reference?: NativeFieldMetadata["referenceObject"],
): NativeFilterOperator[] {
  if (nativeReferenceGate(reference) !== undefined) return ["eq", "in"];
  const base: NativeFilterOperator[] = ["eq", "ne", "in", "is_empty", "is_not_empty"];
  if (type === "number" || format === "date" || format === "datetime")
    return [...base, "gt", "gte", "lt", "lte"];
  if (type === "string") return [...base, "contains", "starts_with"];
  return type === "array"
    ? ["eq", "ne", "contains", "is_empty", "is_not_empty"]
    : ["eq", "ne", "is_empty", "is_not_empty"];
}

export function nativeReferenceGate(
  reference: NativeFieldMetadata["referenceObject"],
): "deal" | "lead" | "person" | "organization" | "user" | undefined {
  return reference === "deal" ||
    reference === "lead" ||
    reference === "person" ||
    reference === "organization" ||
    reference === "user"
    ? reference
    : undefined;
}

function customType(type: CustomFieldType): NativeFieldMetadata["valueType"] {
  if (type === "numeric" || type === "monetary") return "number";
  if (type === "multi_option") return "array";
  if (type === "address" || type === "date_range" || type === "time_range") return "object";
  return "string";
}

// Active definitions only. Values and credentials never enter the metadata projection.
export async function nativeFieldCatalog(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  signal: AbortSignal,
  options: { includeChoices?: boolean } = {},
): Promise<NativeFieldMetadata[]> {
  signal.throwIfAborted();
  if (!actor.isActive) return [];
  const defs = await listDefs(db, objectName, {}, signal);
  const fields = [
    ...nativeBuiltinFields(objectName),
    ...defs.map((def): NativeFieldMetadata => {
      const valueType = customType(def.type);
      const referenceObject =
        def.type === "org"
          ? "organization"
          : def.type === "person" || def.type === "user"
            ? def.type
            : undefined;
      return {
        key: `customFields.${def.key}`,
        label: def.name,
        valueType,
        format: def.type,
        required: def.isRequired || (objectName !== "activity" && def.isImportant),
        readable: true,
        createable: true,
        updateable: true,
        filterOperators: nativeOperators(valueType, def.type, referenceObject),
        referenceObject,
        upsertIdentity:
          objectName !== "activity" && (valueType === "string" || valueType === "number"),
        ...(def.type === "single_option" || def.type === "multi_option"
          ? {
              options: def.options
                .filter((option) => option.archived !== true)
                .map(({ id, label }) => ({ id, label })),
            }
          : {}),
      };
    }),
  ];
  return options.includeChoices === true ? withNativeChoices(db, actor, fields, signal) : fields;
}
