import { Temporal } from "@js-temporal/polyfill";
import { isMappingInstant, scalarLiteralTypes } from "./mappingLiteralIntent";

function record(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function keysAllowed(raw: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(raw).every((key) => typeof key === "string" && allowed.includes(key));
}

function scalar(raw: unknown): boolean {
  if (raw === null || typeof raw === "boolean") return true;
  if (typeof raw === "string") return raw.length <= 50_000;
  return typeof raw === "number" && Number.isFinite(raw);
}

function literalDraft(raw: Record<string, unknown>): boolean {
  return (
    keysAllowed(raw, ["kind", "value", "literalType"]) &&
    (!Object.hasOwn(raw, "kind") || raw.kind === "value") &&
    (!Object.hasOwn(raw, "value") || scalar(raw.value)) &&
    (!Object.hasOwn(raw, "literalType") ||
      scalarLiteralTypes.some((type) => type === raw.literalType))
  );
}

function referenceDraft(raw: Record<string, unknown>): boolean {
  if (!keysAllowed(raw, ["kind", "nodeId", "path"])) return false;
  if (Object.hasOwn(raw, "kind") && raw.kind !== "reference") return false;
  if (
    Object.hasOwn(raw, "nodeId") &&
    (typeof raw.nodeId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.nodeId))
  )
    return false;
  if (!Object.hasOwn(raw, "path")) return true;
  return (
    Array.isArray(raw.path) &&
    raw.path.length <= 8 &&
    raw.path.every(
      (part: unknown) =>
        typeof part === "string" &&
        part.length > 0 &&
        part.length <= 80 &&
        !["__proto__", "prototype", "constructor"].includes(part),
    )
  );
}

// This shallow guard runs before recursive definition JSON parsing. An instant
// tag must never admit rich, cyclic or deeply nested scalar payloads. Reviewed
// incomplete and wrong-known-intent drafts remain inert and byte-preserving.
export function boundedDelayConfig(raw: unknown): boolean {
  if (!record(raw) || !Object.hasOwn(raw, "until")) return true;
  if (!keysAllowed(raw, ["until"]) || !record(raw.until)) return false;
  const binding = raw.until;
  return binding.kind === "reference" ||
    Object.hasOwn(binding, "nodeId") ||
    Object.hasOwn(binding, "path")
    ? referenceDraft(binding)
    : literalDraft(binding);
}

// Waits use native Date deadlines, while WF020 comparisons keep their existing
// nanosecond precision. Require exact milliseconds without normalizing the wire.
export function delayUntilDate(raw: unknown): Date | null {
  if (!isMappingInstant(raw)) return null;
  try {
    const instant = Temporal.Instant.from(raw);
    if (instant.epochNanoseconds % 1_000_000n !== 0n) return null;
    const date = new Date(Number(instant.epochNanoseconds / 1_000_000n));
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}
