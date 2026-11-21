import { z } from "zod";
import type { AssetCategory, AssetField, AssetValue } from "./contracts";

const isoDate = z.iso.date();
const webLink = z.url({ protocol: /^https?$/u, hostname: z.regexes.domain });

export function assetKey(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export function uniqueAssetKeys(values: string[]): boolean {
  return new Set(values.map(assetKey)).size === values.length;
}

export function validAssetValue(field: AssetField, value: AssetValue): boolean {
  if (value === null) return !field.required;
  switch (field.type) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return isoDate.safeParse(value).success;
    case "choice":
      return typeof value === "string" && field.options.includes(value);
    case "link":
      return webLink.safeParse(value).success;
  }
}

export function validAssetFields(fields: AssetField[]): boolean {
  if (!uniqueAssetKeys(fields.map(({ label }) => label))) return false;
  if (new Set(fields.map(({ id }) => id)).size !== fields.length) return false;
  return fields.every((field) => {
    const validOptions =
      field.type === "choice"
        ? field.options.length > 0 && uniqueAssetKeys(field.options)
        : field.options.length === 0;
    return (
      validOptions && (field.defaultValue === null || validAssetValue(field, field.defaultValue))
    );
  });
}

export function resolveAssetValues(
  category: AssetCategory | null,
  values: Record<string, AssetValue>,
): Record<string, AssetValue> | null {
  const fields = category?.fields ?? [];
  const knownFields = new Set(fields.map(({ id }) => id));
  if (Object.keys(values).some((key) => !knownFields.has(key))) return null;
  const resolved: Record<string, AssetValue> = {};
  for (const field of fields) {
    const supplied = Object.hasOwn(values, field.id);
    const value = supplied ? (values[field.id] ?? null) : field.defaultValue;
    if (!validAssetValue(field, value)) return null;
    if (supplied || value !== null) resolved[field.id] = value;
  }
  return resolved;
}
