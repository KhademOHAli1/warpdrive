import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const ATTRIBUTION_DEFINITION = "descriptive-touch-credit-v1";
export const ATTRIBUTION_CREDIT_SCALE = 1_000_000;
const MAX_TOUCHES = 1_000;
const DAY_NS = 86_400_000_000_000n;
const MAX_WINDOW_NS = 366n * DAY_NS;
const MAX_DECAY_TIERS = 30n;

const identifier = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim() === value);
const instant = z.string().max(35).datetime({ offset: true });
const positiveNanoseconds = z.string().regex(/^[1-9][0-9]{0,17}$/);
const subject = z.strictObject({
  identityDefinition: identifier,
  kind: z.enum(["person", "account"]),
  id: identifier,
});
const channel = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("captured"),
    channelId: identifier,
    campaignId: identifier.optional(),
  }),
  z.strictObject({ kind: z.literal("direct") }),
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({ kind: z.literal("uncaptured") }),
]);
const touch = z.strictObject({
  subject,
  interactionId: identifier,
  sourceRevisionId: identifier,
  at: instant,
  channel,
});
const request = z.strictObject({
  source: z.strictObject({
    definitionId: identifier,
    snapshotId: identifier,
    coverage: z.enum(["complete", "partial", "unavailable"]),
    observedFrom: instant,
    observedThrough: instant,
  }),
  conversion: z.strictObject({
    id: identifier,
    basis: z.enum(["qualified-purchase", "qualified-win"]),
    subject,
    at: instant,
  }),
  lookbackNanoseconds: positiveNanoseconds,
  halfLifeNanoseconds: positiveNanoseconds,
  touches: z.array(touch).max(MAX_TOUCHES),
});

export type AttributionRequest = z.input<typeof request>;
type Touch = z.output<typeof touch>;
type SourceChannel = z.output<typeof channel> | { kind: "no-observed-touch" };
export type AttributionModel = "first-touch" | "last-touch" | "linear" | "half-life-buckets";
interface Credit {
  interactionId: string | null;
  sourceRevisionId: string | null;
  channel: SourceChannel;
  creditParts: number;
}
export type AttributionResult =
  | {
      state: "unavailable";
      reason: "invalid-evidence" | "incomplete-window" | "duplicate-interaction";
    }
  | {
      state: "available";
      definition: typeof ATTRIBUTION_DEFINITION;
      interpretation: "descriptive-credit-not-incremental-effect";
      source: z.output<typeof request>["source"];
      conversionId: string;
      conversionBasis: AttributionRequest["conversion"]["basis"];
      identityKind: AttributionRequest["conversion"]["subject"]["kind"];
      identityDefinition: string;
      window: { fromInclusive: string; toExclusive: string };
      halfLifeNanoseconds: string;
      creditScale: typeof ATTRIBUTION_CREDIT_SCALE;
      touchesInWindow: number;
      models: Record<AttributionModel, Credit[]>;
    };

interface TimedTouch {
  source: Touch;
  at: bigint;
}
const stableOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function epoch(value: string): bigint | null {
  try {
    return Temporal.Instant.from(value).epochNanoseconds;
  } catch {
    return null;
  }
}

function sameSubject(left: Touch["subject"], right: Touch["subject"]): boolean {
  return (
    left.identityDefinition === right.identityDefinition &&
    left.kind === right.kind &&
    left.id === right.id
  );
}

function scopedTouches(
  input: z.output<typeof request>,
  window: { from: bigint; to: bigint },
): TimedTouch[] | Extract<AttributionResult, { state: "unavailable" }> {
  const seen = new Set<string>();
  const result: TimedTouch[] = [];
  for (const source of input.touches) {
    if (!sameSubject(source.subject, input.conversion.subject)) {
      return { state: "unavailable", reason: "invalid-evidence" };
    }
    if (seen.has(source.interactionId))
      return { state: "unavailable", reason: "duplicate-interaction" };
    seen.add(source.interactionId);
    const at = epoch(source.at);
    if (at === null) return { state: "unavailable", reason: "invalid-evidence" };
    if (at >= window.from && at < window.to) result.push({ source, at });
  }
  return result.sort((a, b) =>
    a.at === b.at
      ? stableOrder(a.source.interactionId, b.source.interactionId)
      : a.at < b.at
        ? -1
        : 1,
  );
}

function weights(model: AttributionModel, touches: TimedTouch[], cutoff: bigint, halfLife: bigint) {
  return touches.map(({ at }, i) => {
    if (model === "first-touch") return i === 0 ? 1n : 0n;
    if (model === "last-touch") return i === touches.length - 1 ? 1n : 0n;
    if (model === "linear") return 1n;
    // Each complete elapsed half-life halves the integer weight. The public definition
    // explicitly uses discrete age buckets, so it is independent of float/ICU rounding.
    return 1n << (MAX_DECAY_TIERS - (cutoff - at) / halfLife);
  });
}

function allocate(touches: TimedTouch[], w: bigint[]): Credit[] {
  if (touches.length === 0)
    return [
      {
        interactionId: null,
        sourceRevisionId: null,
        channel: { kind: "no-observed-touch" },
        creditParts: ATTRIBUTION_CREDIT_SCALE,
      },
    ];

  const total = w.reduce((sum, next) => sum + next, 0n);
  const scale = BigInt(ATTRIBUTION_CREDIT_SCALE);
  const rows = touches.map(({ source }, i) => {
    const scaled = (w[i] ?? 0n) * scale;
    return {
      interactionId: source.interactionId,
      sourceRevisionId: source.sourceRevisionId,
      channel: source.channel,
      creditParts: Number(scaled / total),
      remainder: scaled % total,
    };
  });
  const remainder = ATTRIBUTION_CREDIT_SCALE - rows.reduce((sum, row) => sum + row.creditParts, 0);
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? stableOrder(a.interactionId, b.interactionId)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of ranked.slice(0, remainder)) row.creditParts += 1;
  return rows
    .filter((row) => row.creditParts > 0)
    .map(({ interactionId, sourceRevisionId, channel, creditParts }) => ({
      interactionId,
      sourceRevisionId,
      channel,
      creditParts,
    }));
}

// Private single-conversion kernel. The caller must provide one authorized deduplicated
// conversion and prove complete corrected touchpoint selection for its identity/window.
// No source ID equivalence or permission is inferred here.
export function compareAttributionModels(payload: AttributionRequest): AttributionResult {
  const parsed = request.safeParse(payload);
  if (!parsed.success) return { state: "unavailable", reason: "invalid-evidence" };
  const input = parsed.data;
  const cutoff = epoch(input.conversion.at);
  const coveredFrom = epoch(input.source.observedFrom);
  const coveredThrough = epoch(input.source.observedThrough);
  const lookback = BigInt(input.lookbackNanoseconds);
  const halfLife = BigInt(input.halfLifeNanoseconds);
  if (
    cutoff === null ||
    coveredFrom === null ||
    coveredThrough === null ||
    coveredFrom > coveredThrough ||
    lookback > MAX_WINDOW_NS ||
    halfLife > lookback ||
    lookback / halfLife > MAX_DECAY_TIERS
  )
    return { state: "unavailable", reason: "invalid-evidence" };
  const from = cutoff - lookback;
  if (input.source.coverage !== "complete" || coveredFrom > from || coveredThrough < cutoff)
    return { state: "unavailable", reason: "incomplete-window" };
  const touches = scopedTouches(input, { from, to: cutoff });
  if (!Array.isArray(touches)) return touches;
  const credits = (model: AttributionModel) =>
    allocate(touches, weights(model, touches, cutoff, halfLife));
  return {
    state: "available",
    definition: ATTRIBUTION_DEFINITION,
    interpretation: "descriptive-credit-not-incremental-effect",
    source: input.source,
    conversionId: input.conversion.id,
    conversionBasis: input.conversion.basis,
    identityKind: input.conversion.subject.kind,
    identityDefinition: input.conversion.subject.identityDefinition,
    window: {
      fromInclusive: Temporal.Instant.fromEpochNanoseconds(from).toString(),
      toExclusive: Temporal.Instant.fromEpochNanoseconds(cutoff).toString(),
    },
    halfLifeNanoseconds: input.halfLifeNanoseconds,
    creditScale: ATTRIBUTION_CREDIT_SCALE,
    touchesInWindow: touches.length,
    models: {
      "first-touch": credits("first-touch"),
      "last-touch": credits("last-touch"),
      linear: credits("linear"),
      "half-life-buckets": credits("half-life-buckets"),
    },
  };
}
