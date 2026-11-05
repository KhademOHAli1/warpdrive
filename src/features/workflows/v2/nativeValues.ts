import type { NativeFieldMetadata } from "./nativeFields";
import type { NativeJson } from "./nativeFilters";

export function compatibleNativeValue(
  value: NativeJson | undefined,
  field: NativeFieldMetadata,
): NativeJson {
  if (value === null || value === undefined) return null;
  if (field.valueType === "array") return Array.isArray(value) ? value : null;
  if (field.valueType === "object")
    return typeof value === "object" && !Array.isArray(value) ? value : null;
  if (typeof value !== field.valueType) return null;
  if (field.format === "datetime" && typeof value === "string") {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
  }
  return value;
}
