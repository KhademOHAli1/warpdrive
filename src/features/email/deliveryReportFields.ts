import { err, ok, type Result } from "@/types/result";
import {
  type DeliveryReportFailure,
  type DeliveryReportField,
  type DeliveryReportTypedValue,
  DELIVERY_REPORT_LIMITS as LIMITS,
} from "./deliveryReportTypes";

const encoder = new TextEncoder();
const ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/u;
export const MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  "reporting-mta",
  "original-envelope-id",
  "dsn-gateway",
  "received-from-mta",
  "arrival-date",
]);
export const RECIPIENT_FIELDS: ReadonlySet<string> = new Set([
  "original-recipient",
  "final-recipient",
  "action",
  "status",
  "remote-mta",
  "diagnostic-code",
  "localized-diagnostic",
  "last-attempt-date",
  "final-log-id",
  "will-retry-until",
]);

export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

export function trimFws(value: string): string {
  let start = 0;
  let end = value.length;
  while (value[start] === " " || value[start] === "\t") start += 1;
  while (end > start && (value[end - 1] === " " || value[end - 1] === "\t")) end -= 1;
  return value.slice(start, end);
}

export function fieldValue(fields: DeliveryReportField[], name: string): string | null {
  return fields.find((field) => field.name === name)?.value ?? null;
}

function appendField(
  fields: DeliveryReportField[],
  line: string,
): Result<void, DeliveryReportFailure> {
  if (byteLength(line) > LIMITS.lineBytes) return err({ code: "limit_exceeded" });
  if (/^[ \t]/u.test(line)) {
    const previous = fields.at(-1);
    if (previous === undefined) return err({ code: "malformed_field" });
    previous.value += ` ${line.replace(/^[ \t]+/u, "")}`;
    return byteLength(previous.value) > LIMITS.fieldBytes
      ? err({ code: "limit_exceeded" })
      : ok(undefined);
  }
  const colon = line.indexOf(":");
  const name = line.slice(0, colon);
  if (colon < 1 || name.length > 64 || !ATOM.test(name)) return err({ code: "malformed_field" });
  fields.push({ name: name.toLowerCase(), value: trimFws(line.slice(colon + 1)) });
  return fields.length > LIMITS.fieldsPerBlock ? err({ code: "limit_exceeded" }) : ok(undefined);
}

function validateScope(
  fields: DeliveryReportField[],
  scope: "message" | "recipient",
): Result<DeliveryReportField[], DeliveryReportFailure> {
  const own = scope === "message" ? MESSAGE_FIELDS : RECIPIENT_FIELDS;
  const other = scope === "message" ? RECIPIENT_FIELDS : MESSAGE_FIELDS;
  const seen = new Set<string>();
  for (const field of fields) {
    if (other.has(field.name)) return err({ code: "malformed_field" });
    if (!own.has(field.name) || field.name === "localized-diagnostic") continue;
    if (seen.has(field.name)) return err({ code: "duplicate_field" });
    seen.add(field.name);
  }
  return ok(fields);
}

export function readReportFields(
  block: string,
  scope: "message" | "recipient",
): Result<DeliveryReportField[], DeliveryReportFailure> {
  const fields: DeliveryReportField[] = [];
  for (const line of block.split("\r\n")) {
    const result = appendField(fields, line);
    if (!result.ok) return result;
  }
  return validateScope(fields, scope);
}

type CommentState = { depth: number; escaped: boolean; output: string };
function semanticCharacter(
  state: CommentState,
  character: string,
): Result<void, DeliveryReportFailure> {
  if (state.escaped) {
    if (state.depth === 0) state.output += character;
    state.escaped = false;
    return ok(undefined);
  }
  if (character === "\\") {
    state.escaped = true;
    if (state.depth === 0) state.output += character;
    return ok(undefined);
  }
  if (character === "(") {
    if (state.depth === 0) state.output += " ";
    state.depth += 1;
    return state.depth > LIMITS.commentDepth ? err({ code: "limit_exceeded" }) : ok(undefined);
  }
  if (character === ")") {
    if (state.depth === 0) return err({ code: "malformed_field" });
    state.depth -= 1;
    return ok(undefined);
  }
  if (state.depth === 0) state.output += character;
  return ok(undefined);
}

// Semantic tokens/type prefixes only; opaque values and diagnostics are not rewritten.
export function withoutComments(value: string): Result<string, DeliveryReportFailure> {
  const state: CommentState = { depth: 0, escaped: false, output: "" };
  for (const character of value) {
    const result = semanticCharacter(state, character);
    if (!result.ok) return result;
  }
  return state.depth > 0 || state.escaped
    ? err({ code: "malformed_field" })
    : ok(trimFws(state.output));
}

function separator(value: string): number {
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) escaped = false;
    else if (character === "\\" && depth > 0) escaped = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === ";" && depth === 0) return index;
    if (depth < 0 || depth > LIMITS.commentDepth) return -1;
  }
  return -1;
}

export function typedValue(
  value: string | null,
): Result<DeliveryReportTypedValue | null, DeliveryReportFailure> {
  if (value === null) return ok(null);
  const index = separator(value);
  if (index < 1) return err({ code: "malformed_field" });
  const type = withoutComments(value.slice(0, index));
  if (!type.ok) return type;
  if (!ATOM.test(type.value)) return err({ code: "malformed_field" });
  return ok({ type: type.value.toLowerCase(), value: trimFws(value.slice(index + 1)) });
}

// RFC5646 structural syntax; no registry lookup or locale/alias canonicalization.
const GRANDFATHERED = new Set(
  "en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu sgn-be-fr sgn-be-nl sgn-ch-de art-lojban cel-gaulish no-bok no-nyn zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang".split(
    " ",
  ),
);

function variantEnd(parts: string[], start: number): number | null {
  let index = start;
  const variants = new Set<string>();
  while (/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/u.test(parts[index] ?? "")) {
    const variant = parts[index] ?? "";
    if (variants.has(variant)) return null;
    variants.add(variant);
    index += 1;
  }
  return index;
}

function extensionEnd(parts: string[], start: number): number | null {
  let index = start;
  const extensions = new Set<string>();
  while (/^[0-9a-wy-z]$/u.test(parts[index] ?? "")) {
    const extension = parts[index] ?? "";
    if (extensions.has(extension)) return null;
    extensions.add(extension);
    index += 1;
    const payloadStart = index;
    while (/^[a-z0-9]{2,8}$/u.test(parts[index] ?? "")) index += 1;
    if (index === payloadStart) return null;
  }
  return index;
}

function primaryEnd(parts: string[]): number {
  let index = 1;
  if ((parts[0]?.length ?? 0) > 3) return index;
  let extlangs = 0;
  while (extlangs < 3 && /^[a-z]{3}$/u.test(parts[index] ?? "")) {
    index += 1;
    extlangs += 1;
  }
  return index;
}

export function validLanguageTag(tag: string): boolean {
  if (tag.length > 64) return false;
  const normalized = tag.toLowerCase();
  if (GRANDFATHERED.has(normalized)) return true;
  const parts = normalized.split("-");
  if (parts.some((part) => !/^[a-z0-9]{1,8}$/u.test(part))) return false;
  if (parts[0] === "x") return parts.length > 1;
  if (!/^[a-z]{2,8}$/u.test(parts[0] ?? "")) return false;
  let index = primaryEnd(parts);
  if (/^[a-z]{4}$/u.test(parts[index] ?? "")) index += 1;
  if (/^(?:[a-z]{2}|[0-9]{3})$/u.test(parts[index] ?? "")) index += 1;
  const variants = variantEnd(parts, index);
  if (variants === null) return false;
  const extensions = extensionEnd(parts, variants);
  if (extensions === null) return false;
  index = extensions;
  if (parts[index] === "x") return index + 1 < parts.length;
  return index === parts.length;
}
