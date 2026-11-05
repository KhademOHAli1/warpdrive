import type { WorkFieldDefinition } from "./contracts";

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
type FieldValue = string | number | boolean | null | undefined;

function validFieldValue(field: WorkFieldDefinition, value: FieldValue): boolean {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === ""))
    return !field.required;
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.length <= 1000;
    case "long_text":
      return typeof value === "string" && value.length <= 10000;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return typeof value === "string" && validDate(value);
    case "select":
      return typeof value === "string" && field.options.includes(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

export function validateWorkValues(
  fields: WorkFieldDefinition[],
  values: Record<string, string | number | boolean | null>,
): { ok: true } | { ok: false; error: "invalid_input" } {
  const invalid = { ok: false, error: "invalid_input" } as const;
  if (Object.keys(values).some((key) => !fields.some((field) => field.key === key))) return invalid;
  for (const field of fields) {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    if (!validFieldValue(field, value)) return invalid;
  }
  return { ok: true };
}
