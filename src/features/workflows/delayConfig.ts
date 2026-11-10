import { Temporal } from "@js-temporal/polyfill";
import { configurationLimits } from "./configurationLimits";
import { isExactMappingDecimal } from "./mappingCompatibility";
import { isMappingInstant, scalarLiteralTypes } from "./mappingLiteralIntent";

export const delayDurationUnits = ["days", "hours", "minutes", "seconds"] as const;
export type DelayDurationUnit = (typeof delayDurationUnits)[number];
const unitMilliseconds: Record<DelayDurationUnit, number> = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
};
export const maxDelayMilliseconds = configurationLimits.waitMax * unitMilliseconds.minutes;
export const maxDelayDays = maxDelayMilliseconds / unitMilliseconds.days;

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

function boundedBinding(raw: unknown): boolean {
  if (!record(raw)) return false;
  return raw.kind === "reference" || Object.hasOwn(raw, "nodeId") || Object.hasOwn(raw, "path")
    ? referenceDraft(raw)
    : literalDraft(raw);
}

export function delayDurationSettings(raw: unknown): Record<string, unknown> | undefined {
  return record(raw) && keysAllowed(raw, delayDurationUnits) ? raw : undefined;
}

// This shallow guard runs before recursive definition JSON parsing. An instant
// tag must never admit rich, cyclic or deeply nested scalar payloads. Reviewed
// incomplete and wrong-known-intent drafts remain inert and byte-preserving.
export function boundedDelayConfig(raw: unknown): boolean {
  if (!record(raw)) return true;
  if (Object.hasOwn(raw, "delayType")) {
    if (raw.delayType === "SCHEDULED_DATE")
      return (
        keysAllowed(raw, ["delayType", "scheduledDateTime"]) &&
        (!Object.hasOwn(raw, "scheduledDateTime") || boundedBinding(raw.scheduledDateTime))
      );
    if (raw.delayType !== "DURATION" || !keysAllowed(raw, ["delayType", "duration"])) return false;
    if (!Object.hasOwn(raw, "duration")) return true;
    const duration = delayDurationSettings(raw.duration);
    return duration !== undefined && Object.values(duration).every(boundedBinding);
  }
  return !Object.hasOwn(raw, "until") || (keysAllowed(raw, ["until"]) && boundedBinding(raw.until));
}

export function delayDurationAmount(raw: unknown): number | null {
  if (raw === "") return 0;
  const value = isExactMappingDecimal(raw) ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function delayDurationMilliseconds(parts: Partial<Record<DelayDurationUnit, unknown>>) {
  let total = 0;
  for (const unit of delayDurationUnits) {
    if (!Object.hasOwn(parts, unit)) continue;
    const amount = delayDurationAmount(parts[unit]);
    if (amount === null) return null;
    total += amount * unitMilliseconds[unit];
  }
  return Number.isFinite(total) && total >= 0 && total <= maxDelayMilliseconds
    ? Math.trunc(total)
    : null;
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
