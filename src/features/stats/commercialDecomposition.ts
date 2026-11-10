import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";

const MAX_SEGMENTS = 64;
const MAX_ENTRANTS = 1_000_000;
const reference = z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/);
const instant = z.iso.datetime({ precision: 6 });
const count = z.number().int().min(0).max(MAX_ENTRANTS);
const wonValue = z.string().regex(/^-?(?:0|[1-9][0-9]{0,19})\.[0-9]{4}$/);
const definition = z.strictObject({
  scope: reference,
  cohortRule: reference,
  segmentation: reference,
  timeZone: z.string().max(100).refine(isTimeZone),
  calendar: z.enum(["gregory", "persian"]),
  horizonDays: z.number().int().min(1).max(365),
  currency: currencyCode,
});
const segment = z.strictObject({
  key: reference,
  eligible: count,
  wins: count,
  knownWonValues: count,
  wonValue,
});
const period = z.strictObject({
  definition,
  completeness: z.enum(["complete", "incomplete"]),
  from: instant,
  toExclusive: instant,
  settledThrough: instant,
  expectedSegmentCount: z.number().int().min(0).max(MAX_SEGMENTS),
  eligible: count,
  wins: count,
  wonValue,
  segments: z.custom<readonly unknown[]>(Array.isArray),
});
const request = z.strictObject({ baseline: period, comparison: period });
type Period = z.output<typeof period>;

interface Amount {
  numerator: bigint;
  denominator: bigint;
}
interface ExactAmount {
  numerator: string;
  denominator: string;
}
interface Segment {
  eligible: bigint;
  wins: bigint;
  value: bigint;
}
interface ReconciledPeriod {
  segments: Map<string, Segment>;
  eligible: bigint;
  value: bigint;
}
type FailureReason =
  | "invalid-request"
  | "noncomparable-periods"
  | "unsettled-period"
  | "incomplete-population"
  | "inconsistent-segments";

export type CommercialDecomposition =
  | { state: "unavailable"; reason: FailureReason }
  | {
      state: "available";
      definition: "equal-age-won-value-ordered-bridge-v1";
      amountUnit: "one-ten-thousandth-of-currency-major-unit";
      order: readonly ["volume", "segment-mix", "conversion", "size"];
      currency: string;
      baselineWonValue: ExactAmount;
      comparisonWonValue: ExactAmount;
      change: ExactAmount;
      support: "complete" | "partial" | "none";
      commonSegments: number;
      unsupportedSegments: number;
      effects: {
        volume: ExactAmount;
        segmentMix: ExactAmount;
        conversion: ExactAmount;
        size: ExactAmount;
        unsupportedChange: ExactAmount;
      };
    };

const zero: Amount = { numerator: 0n, denominator: 1n };

function ratio(numerator: bigint, denominator = 1n): Amount {
  if (numerator === 0n) return zero;
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

function add(a: Amount, b: Amount): Amount {
  return ratio(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function difference(a: Amount, b: Amount): ExactAmount {
  const result = add(a, { ...b, numerator: -b.numerator });
  return { numerator: result.numerator.toString(), denominator: result.denominator.toString() };
}

function settled(row: Period): boolean {
  const latestEntryHorizon = Temporal.Instant.from(row.toExclusive).add({
    hours: row.definition.horizonDays * 24,
  });
  return Temporal.Instant.compare(row.settledThrough, latestEntryHorizon) >= 0;
}

function reconcile(row: Period): ReconciledPeriod | null {
  if (row.segments.length !== row.expectedSegmentCount) return null;
  const segments = new Map<string, Segment>();
  let value = 0n;
  let eligible = 0n;
  let wins = 0n;
  for (const raw of row.segments) {
    const parsed = segment.safeParse(raw);
    if (!parsed.success) return null;
    const s = parsed.data;
    const units = BigInt(s.wonValue.replace(".", ""));
    if (
      segments.has(s.key) ||
      s.eligible === 0 ||
      s.wins > s.eligible ||
      s.knownWonValues !== s.wins ||
      (s.wins === 0 && units !== 0n)
    )
      return null;
    const facts = { eligible: BigInt(s.eligible), wins: BigInt(s.wins), value: units };
    segments.set(s.key, facts);
    eligible += facts.eligible;
    wins += facts.wins;
    value += units;
  }
  if (
    eligible !== BigInt(row.eligible) ||
    wins !== BigInt(row.wins) ||
    value !== BigInt(row.wonValue.replace(".", ""))
  )
    return null;
  return { segments, value, eligible };
}

function comparable(a: Period, b: Period): boolean {
  return (
    a.from < a.toExclusive &&
    b.from < b.toExclusive &&
    a.toExclusive <= b.from &&
    JSON.stringify(a.definition) === JSON.stringify(b.definition)
  );
}

function supportedBridge(baseline: ReconciledPeriod, comparison: ReconciledPeriod) {
  const bridge = { starting: zero, volume: zero, mix: zero, conversion: zero, ending: zero };
  let commonSegments = 0;
  for (const [key, start] of baseline.segments) {
    const end = comparison.segments.get(key);
    if (end === undefined || start.wins === 0n || end.wins === 0n) continue;
    commonSegments += 1;
    bridge.starting = add(bridge.starting, ratio(start.value));
    bridge.volume = add(bridge.volume, ratio(comparison.eligible * start.value, baseline.eligible));
    bridge.mix = add(bridge.mix, ratio(end.eligible * start.value, start.eligible));
    bridge.conversion = add(bridge.conversion, ratio(end.wins * start.value, start.wins));
    bridge.ending = add(bridge.ending, ratio(end.value));
  }
  const allSegments = new Set([...baseline.segments.keys(), ...comparison.segments.keys()]);
  return { bridge, commonSegments, unsupportedSegments: allSegments.size - commonSegments };
}

/**
 * Descriptive bridge for comparable, settled, equal-age entry cohorts and exact won deal
 * value. Hold other factors fixed while replacing each factor in the declared order.
 * The collector must attest complete authorized and disjoint membership, frozen segment
 * assignments and matched definitions. The kernel reconciles declared counts and amounts.
 * Segments absent or without observed win size on either side stay in the residual.
 */
export function decomposeCommercialChange(input: unknown): CommercialDecomposition {
  const parsed = request.safeParse(input);
  if (!parsed.success) return { state: "unavailable", reason: "invalid-request" };
  const { baseline, comparison } = parsed.data;
  if (!comparable(baseline, comparison))
    return { state: "unavailable", reason: "noncomparable-periods" };
  if (!settled(baseline) || !settled(comparison))
    return { state: "unavailable", reason: "unsettled-period" };
  if (baseline.completeness !== "complete" || comparison.completeness !== "complete")
    return { state: "unavailable", reason: "incomplete-population" };
  const start = reconcile(baseline);
  const end = reconcile(comparison);
  if (start === null || end === null)
    return { state: "unavailable", reason: "inconsistent-segments" };
  const { bridge, commonSegments, unsupportedSegments } = supportedBridge(start, end);
  return {
    state: "available",
    definition: "equal-age-won-value-ordered-bridge-v1",
    amountUnit: "one-ten-thousandth-of-currency-major-unit",
    order: ["volume", "segment-mix", "conversion", "size"],
    currency: baseline.definition.currency,
    baselineWonValue: difference(ratio(start.value), zero),
    comparisonWonValue: difference(ratio(end.value), zero),
    change: difference(ratio(end.value), ratio(start.value)),
    support: commonSegments === 0 ? "none" : unsupportedSegments === 0 ? "complete" : "partial",
    commonSegments,
    unsupportedSegments,
    effects: {
      volume: difference(bridge.volume, bridge.starting),
      segmentMix: difference(bridge.mix, bridge.volume),
      conversion: difference(bridge.conversion, bridge.mix),
      size: difference(bridge.ending, bridge.conversion),
      unsupportedChange: difference(
        add(ratio(end.value - start.value), bridge.starting),
        bridge.ending,
      ),
    },
  };
}
