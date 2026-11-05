import type { BlockJson } from "@/features/blocks/contracts";

const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
export function isBlockJson(
  value: unknown,
  depth = 0,
  budget = { left: 10000 },
): value is BlockJson {
  if (depth > 12 || --budget.left < 0) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isBlockJson(item, depth + 1, budget));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(
    ([key, item]) => !unsafeKeys.has(key) && isBlockJson(item, depth + 1, budget),
  );
}
function object(value: BlockJson | undefined): Record<string, BlockJson> | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}
function integer(value: BlockJson | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}
const supported = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "description",
  "title",
]);
function validLimits(spec: Record<string, BlockJson>): boolean {
  const enumeration = spec.enum;
  if (
    enumeration !== undefined &&
    (!Array.isArray(enumeration) ||
      enumeration.length < 1 ||
      enumeration.length > 100 ||
      !enumeration.every((value) => value === null || typeof value !== "object"))
  )
    return false;
  return ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].every(
    (key) => spec[key] === undefined || typeof spec[key] === "number",
  );
}
export function validResponseSchema(schema: BlockJson, depth = 0): boolean {
  const spec = object(schema);
  if (spec === null || depth > 8 || Object.keys(spec).some((key) => !supported.has(key)))
    return false;
  const { type } = spec;
  if (
    typeof type !== "string" ||
    !["object", "array", "string", "number", "integer", "boolean", "null"].includes(type) ||
    !validLimits(spec)
  )
    return false;
  if (type === "array")
    return spec.items === undefined || validResponseSchema(spec.items, depth + 1);
  return type !== "object" || validObjectSchema(spec, depth);
}
function validObjectSchema(spec: Record<string, BlockJson>, depth: number): boolean {
  const properties = spec.properties === undefined ? {} : object(spec.properties);
  if (
    properties === null ||
    Object.keys(properties).length > 100 ||
    Object.keys(properties).some((key) => unsafeKeys.has(key))
  )
    return false;
  if (!Object.values(properties).every((value) => validResponseSchema(value, depth + 1)))
    return false;
  if (spec.additionalProperties !== undefined && typeof spec.additionalProperties !== "boolean")
    return false;
  return (
    spec.required === undefined ||
    (Array.isArray(spec.required) &&
      spec.required.every((key) => typeof key === "string" && Object.hasOwn(properties, key)))
  );
}
function matchesObject(spec: Record<string, BlockJson>, value: BlockJson, depth: number): boolean {
  const record = object(value);
  const properties = spec.properties === undefined ? {} : object(spec.properties);
  if (record === null || properties === null) return false;
  if (
    Array.isArray(spec.required) &&
    spec.required.some((key) => typeof key !== "string" || !Object.hasOwn(record, key))
  )
    return false;
  if (
    spec.additionalProperties === false &&
    Object.keys(record).some((key) => !Object.hasOwn(properties, key))
  )
    return false;
  return Object.entries(properties).every(
    ([key, child]) =>
      !Object.hasOwn(record, key) || matchesResponseSchema(child, record[key] ?? null, depth + 1),
  );
}
export function matchesResponseSchema(schema: BlockJson, value: BlockJson, depth = 0): boolean {
  if (!validResponseSchema(schema) || depth > 8) return false;
  const spec = object(schema);
  if (spec === null || typeof spec.type !== "string") return false;
  if (Array.isArray(spec.enum) && !spec.enum.some((option) => option === value)) return false;
  switch (spec.type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return (
        typeof value === "string" &&
        value.length >= integer(spec.minLength, 0) &&
        value.length <= integer(spec.maxLength, 500000)
      );
    case "number":
    case "integer":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (spec.type !== "integer" || Number.isInteger(value)) &&
        (typeof spec.minimum !== "number" || value >= spec.minimum) &&
        (typeof spec.maximum !== "number" || value <= spec.maximum)
      );
    case "array":
      return (
        Array.isArray(value) &&
        value.length >= integer(spec.minItems, 0) &&
        value.length <= integer(spec.maxItems, 1000) &&
        (spec.items === undefined ||
          value.every((item) => matchesResponseSchema(spec.items ?? null, item, depth + 1)))
      );
    case "object":
      return matchesObject(spec, value, depth);
    default:
      return false;
  }
}
export const emptyObjectSchema: BlockJson = {
  type: "object",
  properties: {},
  additionalProperties: true,
};
