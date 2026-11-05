import { createHash } from "node:crypto";
import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";
import { PERIOD_FORECAST_DEFINITION_VERSION, PERIOD_FORECAST_SCENARIOS } from "./periodForecast";

export const FORECAST_EVALUATION_DEFINITION_VERSION = 1;
export const MAX_FORECAST_EVALUATION_PERIODS = 64;
export const MAX_FORECAST_EVALUATION_MEMBERS = 10_000;

const MAX_MEMBERS_PER_PERIOD = 5_000;
const VALUE_PLACES = 22;
const instant = z.string().datetime({ precision: 6 });
const ref = z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/u);
const memberCount = z.number().int().min(0).max(MAX_MEMBERS_PER_PERIOD);
const rawMembers = z.custom<readonly unknown[]>(Array.isArray);
const target = z.strictObject({
  from: instant,
  toExclusive: instant,
  calendar: z.enum(["gregory", "persian"]),
  timeZone: z.string().min(1).max(100).refine(isTimeZone),
});
const measurement = z.strictObject({
  scopeId: ref,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .pipe(currencyCode),
  outcomeDefinition: ref,
  settlementPolicy: ref,
  restatementPolicy: ref,
  measure: z.literal("original-currency-won-deal-value"),
});
const identity = {
  dealId: z.guid().transform((id) => id.toLowerCase()),
  incarnationId: z.guid().transform((id) => id.toLowerCase()),
};
const prediction = z.strictObject({
  ...identity,
  // PeriodForecast v1 values can carry up to 22 fractional places and a 10x size scenario.
  expectedWonValue: z
    .string()
    .regex(/^-?\d{1,15}(?:\.\d{1,22})?$/u)
    .nullable(),
  periodWinProbability: z
    .string()
    .regex(/^(?:0(?:\.\d{1,12})?|1(?:\.0{1,12})?)$/u)
    .nullable(),
});
const outcome = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("won"),
    eventId: ref,
    occurredAt: instant,
    observedAt: instant,
    value: z
      .string()
      .regex(/^-?\d{1,14}(?:\.\d{1,4})?$/u)
      .nullable(),
  }),
  z.strictObject({ kind: z.literal("no-win"), witnessId: ref }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
const actualMember = z.strictObject({ ...identity, outcome });

const modelEvidence = z.strictObject({
  kind: z.literal("out-of-time-model"),
  trainedThrough: instant,
  frozenAt: instant,
  holdoutRef: ref,
});

const forecast = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: ref,
  completeness: z.enum(["complete", "incomplete"]),
  forecastDefinitionVersion: z.literal(PERIOD_FORECAST_DEFINITION_VERSION),
  scenario: z.enum(PERIOD_FORECAST_SCENARIOS),
  modelId: ref,
  modelVersion: ref,
  measurement,
  target,
  predictionCutoff: instant,
  savedAt: instant,
  openDealCount: memberCount,
  probabilityEvidence: modelEvidence.nullable(),
  members: rawMembers,
});

const actual = z.strictObject({
  schemaVersion: z.literal(1),
  manifestId: ref,
  forecastSnapshotId: ref,
  completeness: z.enum(["complete", "incomplete"]),
  measurement,
  target,
  settledThrough: instant,
  observedAt: instant,
  coveredDealCount: memberCount,
  members: rawMembers,
});

const pairSchema = z.strictObject({ forecast, actual });
const frameSchema = z.strictObject({
  definitionVersion: z.literal(FORECAST_EVALUATION_DEFINITION_VERSION),
  evaluationAsOf: instant,
  periods: rawMembers,
});
type Pair = z.output<typeof pairSchema>;
type Outcome = z.output<typeof outcome>;

interface PeriodCoverage {
  members: number;
  knownForecastValues: number;
  knownActualValues: number;
  knownProbabilities: number;
  knownOutcomes: number;
  wins: number;
}

interface PeriodMoney {
  forecast: string;
  actual: string;
  signedError: string;
  absoluteError: string;
}

interface EvaluatedPeriod {
  forecastSnapshotId: string;
  actualManifestId: string;
  target: Pair["forecast"]["target"];
  predictionCutoff: string;
  actualObservedAt: string;
  settledThrough: string;
  coverage: PeriodCoverage;
  money: PeriodMoney | null;
  moneyStatus: "scored" | "empty-roster" | "missing-value-evidence";
}

interface MeanAmount {
  numerator: string;
  denominator: number;
}

interface AccuracyMetrics {
  signedErrorTotal: string;
  absoluteErrorTotal: string;
  meanBias: MeanAmount;
  meanAbsoluteError: MeanAmount;
  weightedAbsoluteError: { numerator: string; denominator: string } | null;
  zeroForecastPeriods: number;
  zeroActualPeriods: number;
  bothZeroPeriods: number;
}

type CalibrationInputs =
  | { state: "eligible-inputs"; observations: number; positives: number; negatives: number }
  | {
      state: "ineligible";
      reason:
        | "not-base-forecast"
        | "missing-model-evidence"
        | "missing-probabilities-or-labels"
        | "single-class";
      observations: number;
      positives: number;
      negatives: number;
    };

type FailureReason =
  | "invalid-input"
  | "bounded-limit"
  | "incomplete-manifest"
  | "measurement-mismatch"
  | "forecast-cutoff-invalid"
  | "actuals-unsettled"
  | "actual-evidence-outside-fence"
  | "model-evidence-after-cutoff"
  | "duplicate-manifest"
  | "overlapping-periods"
  | "roster-mismatch";

type Failure = { ok: false; reason: FailureReason };

export type ForecastEvaluation =
  | Failure
  | {
      ok: true;
      definitionVersion: typeof FORECAST_EVALUATION_DEFINITION_VERSION;
      basis: "settled-saved-open-cohort";
      evaluationAsOf: string;
      measurement: Pair["forecast"]["measurement"];
      forecastModel: Pick<
        Pair["forecast"],
        "forecastDefinitionVersion" | "modelId" | "modelVersion" | "scenario"
      >;
      periods: EvaluatedPeriod[];
      coverage: {
        totalPeriods: number;
        scoredPeriods: number;
        emptyPeriods: number;
        missingValuePeriods: number;
      };
      metrics: AccuracyMetrics | null;
      calibration: CalibrationInputs;
    };

function fail(reason: FailureReason): Failure {
  return { ok: false, reason };
}

function units(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(VALUE_PLACES, "0"));
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function moneyText(value: bigint): string {
  const digits = absolute(value)
    .toString()
    .padStart(VALUE_PLACES + 1, "0");
  const whole = digits.slice(0, -VALUE_PLACES);
  const fraction = digits.slice(-VALUE_PLACES).replace(/0+$/u, "").padEnd(4, "0");
  return `${(value < 0n ? "-" : "") + whole}.${fraction}`;
}

function checkPair(pair: Pair, evaluationAsOf: string): Failure | null {
  const { forecast: saved, actual: settled } = pair;
  if (saved.completeness !== "complete" || settled.completeness !== "complete")
    return fail("incomplete-manifest");
  if (
    settled.forecastSnapshotId !== saved.snapshotId ||
    JSON.stringify(settled.measurement) !== JSON.stringify(saved.measurement) ||
    JSON.stringify(settled.target) !== JSON.stringify(saved.target)
  )
    return fail("measurement-mismatch");
  if (saved.target.from >= saved.target.toExclusive) return fail("invalid-input");
  if (saved.predictionCutoff > saved.savedAt || saved.savedAt >= saved.target.from)
    return fail("forecast-cutoff-invalid");
  if (
    settled.settledThrough < saved.target.toExclusive ||
    settled.observedAt < settled.settledThrough ||
    settled.observedAt > evaluationAsOf
  )
    return fail("actuals-unsettled");
  const proof = saved.probabilityEvidence;
  if (
    proof !== null &&
    (proof.trainedThrough > proof.frozenAt || proof.frozenAt > saved.predictionCutoff)
  )
    return fail("model-evidence-after-cutoff");
  return null;
}

function checkOutcome(outcome: Outcome, pair: Pair): Failure | null {
  if (outcome.kind !== "won") return null;
  const { from, toExclusive } = pair.forecast.target;
  if (
    outcome.occurredAt < from ||
    outcome.occurredAt >= toExclusive ||
    outcome.observedAt < outcome.occurredAt ||
    outcome.observedAt > pair.actual.observedAt
  )
    return fail("actual-evidence-outside-fence");
  return null;
}

type Member = z.output<typeof prediction>;
type IndexedActuals = { ok: true; members: Map<string, Outcome> } | Failure;

function indexActuals(pair: Pair): IndexedActuals {
  const members = new Map<string, Outcome>();
  const eventIds = new Set<string>();
  for (const raw of pair.actual.members) {
    const parsed = actualMember.safeParse(raw);
    if (!parsed.success) return fail("invalid-input");
    const { dealId, incarnationId, outcome } = parsed.data;
    const key = JSON.stringify([dealId, incarnationId]);
    if (members.has(key)) return fail("roster-mismatch");
    if (outcome.kind === "won") {
      if (eventIds.has(outcome.eventId)) return fail("roster-mismatch");
      eventIds.add(outcome.eventId);
    }
    const invalid = checkOutcome(outcome, pair);
    if (invalid !== null) return invalid;
    members.set(key, outcome);
  }
  return { ok: true, members };
}

function rosterSizeMatches({ forecast: saved, actual: settled }: Pair): boolean {
  return (
    saved.openDealCount === saved.members.length &&
    settled.coveredDealCount === settled.members.length &&
    saved.openDealCount === settled.coveredDealCount
  );
}

interface Scored {
  forecastUnits: bigint;
  actualUnits: bigint;
}

interface PeriodResult {
  ok: true;
  report: EvaluatedPeriod;
  score: Scored | null;
  paired: { observations: number; positives: number };
  modelEvidence: boolean;
}

function realizedUnits(outcome: Outcome): bigint | null {
  if (outcome.kind === "unknown") return null;
  if (outcome.kind === "no-win") return 0n;
  return outcome.value === null ? null : units(outcome.value);
}

function addEvidence(
  coverage: PeriodCoverage,
  totals: Scored,
  paired: PeriodResult["paired"],
  prediction: Member,
  outcome: Outcome,
) {
  if (prediction.expectedWonValue !== null) {
    coverage.knownForecastValues += 1;
    totals.forecastUnits += units(prediction.expectedWonValue);
  }
  const actualValue = realizedUnits(outcome);
  if (actualValue !== null) {
    coverage.knownActualValues += 1;
    totals.actualUnits += actualValue;
  }
  if (prediction.periodWinProbability !== null) coverage.knownProbabilities += 1;
  if (outcome.kind === "unknown") return;
  coverage.knownOutcomes += 1;
  if (outcome.kind === "won") coverage.wins += 1;
  if (prediction.periodWinProbability === null) return;
  paired.observations += 1;
  if (outcome.kind === "won") paired.positives += 1;
}

function periodMoney({ forecastUnits, actualUnits }: Scored): PeriodMoney {
  const error = forecastUnits - actualUnits;
  return {
    forecast: moneyText(forecastUnits),
    actual: moneyText(actualUnits),
    signedError: moneyText(error),
    absoluteError: moneyText(absolute(error)),
  };
}

function evaluatePeriod(
  pair: Pair,
  observe?: (member: Member, actual: Outcome) => void,
): PeriodResult | Failure {
  if (!rosterSizeMatches(pair)) return fail("roster-mismatch");
  const indexed = indexActuals(pair);
  if (!indexed.ok) return indexed;
  const coverage: PeriodCoverage = {
    members: pair.forecast.openDealCount,
    knownForecastValues: 0,
    knownActualValues: 0,
    knownProbabilities: 0,
    knownOutcomes: 0,
    wins: 0,
  };
  const totals: Scored = { forecastUnits: 0n, actualUnits: 0n };
  const paired = { observations: 0, positives: 0 };
  const dealIds = new Set<string>();
  const incarnationIds = new Set<string>();
  for (const raw of pair.forecast.members) {
    const parsed = prediction.safeParse(raw);
    if (!parsed.success) return fail("invalid-input");
    const member = parsed.data;
    const actual = indexed.members.get(JSON.stringify([member.dealId, member.incarnationId]));
    if (
      actual === undefined ||
      dealIds.has(member.dealId) ||
      incarnationIds.has(member.incarnationId)
    )
      return fail("roster-mismatch");
    dealIds.add(member.dealId);
    incarnationIds.add(member.incarnationId);
    addEvidence(coverage, totals, paired, member, actual);
    observe?.(member, actual);
  }

  const covered =
    coverage.knownForecastValues === coverage.members &&
    coverage.knownActualValues === coverage.members;
  const moneyStatus =
    coverage.members === 0 ? "empty-roster" : covered ? "scored" : "missing-value-evidence";
  const score = moneyStatus === "scored" ? totals : null;
  return {
    ok: true,
    report: {
      forecastSnapshotId: pair.forecast.snapshotId,
      actualManifestId: pair.actual.manifestId,
      target: pair.forecast.target,
      predictionCutoff: pair.forecast.predictionCutoff,
      actualObservedAt: pair.actual.observedAt,
      settledThrough: pair.actual.settledThrough,
      coverage,
      money: score === null ? null : periodMoney(score),
      moneyStatus,
    },
    score,
    paired,
    modelEvidence: pair.forecast.probabilityEvidence !== null,
  };
}

function accuracy(scores: readonly Scored[]): AccuracyMetrics | null {
  if (scores.length === 0) return null;
  let signed = 0n;
  let unsigned = 0n;
  let absoluteActual = 0n;
  let zeroForecastPeriods = 0;
  let zeroActualPeriods = 0;
  let bothZeroPeriods = 0;
  for (const { forecastUnits, actualUnits } of scores) {
    const error = forecastUnits - actualUnits;
    signed += error;
    unsigned += absolute(error);
    absoluteActual += absolute(actualUnits);
    if (forecastUnits === 0n) zeroForecastPeriods += 1;
    if (actualUnits === 0n) zeroActualPeriods += 1;
    if (forecastUnits === 0n && actualUnits === 0n) bothZeroPeriods += 1;
  }
  return {
    signedErrorTotal: moneyText(signed),
    absoluteErrorTotal: moneyText(unsigned),
    meanBias: { numerator: moneyText(signed), denominator: scores.length },
    meanAbsoluteError: { numerator: moneyText(unsigned), denominator: scores.length },
    weightedAbsoluteError:
      absoluteActual === 0n
        ? null
        : { numerator: moneyText(unsigned), denominator: moneyText(absoluteActual) },
    zeroForecastPeriods,
    zeroActualPeriods,
    bothZeroPeriods,
  };
}

function calibration(
  periods: readonly PeriodResult[],
  scenario: Pair["forecast"]["scenario"],
): CalibrationInputs {
  const nonempty = periods.filter(({ report }) => report.coverage.members > 0);
  const observations = nonempty.reduce((total, period) => total + period.paired.observations, 0);
  const positives = nonempty.reduce((total, period) => total + period.paired.positives, 0);
  const counts = { observations, positives, negatives: observations - positives };
  if (scenario !== "base") return { state: "ineligible", reason: "not-base-forecast", ...counts };
  if (nonempty.some((period) => !period.modelEvidence))
    return { state: "ineligible", reason: "missing-model-evidence", ...counts };
  if (nonempty.some((period) => period.paired.observations !== period.report.coverage.members))
    return { state: "ineligible", reason: "missing-probabilities-or-labels", ...counts };
  if (counts.positives === 0 || counts.negatives === 0)
    return { state: "ineligible", reason: "single-class", ...counts };
  return { state: "eligible-inputs", ...counts };
}

function comparisonKey(saved: Pair["forecast"]): string {
  return JSON.stringify([
    saved.measurement,
    saved.forecastDefinitionVersion,
    saved.modelId,
    saved.modelVersion,
    saved.scenario,
    saved.target.timeZone,
    saved.target.calendar,
  ]);
}

type ParsedPairs = { ok: true; periods: Pair[] } | Failure;

function parsePairs(frame: z.output<typeof frameSchema>): ParsedPairs {
  const periods: Pair[] = [];
  let memberBudget = 0;
  for (const raw of frame.periods) {
    const parsed = pairSchema.safeParse(raw);
    if (!parsed.success) return fail("invalid-input");
    const pair = parsed.data;
    memberBudget += Math.max(pair.forecast.members.length, pair.actual.members.length);
    if (
      pair.forecast.members.length > MAX_MEMBERS_PER_PERIOD ||
      pair.actual.members.length > MAX_MEMBERS_PER_PERIOD ||
      memberBudget > MAX_FORECAST_EVALUATION_MEMBERS
    )
      return fail("bounded-limit");
    const invalid = checkPair(pair, frame.evaluationAsOf);
    if (invalid !== null) return invalid;
    periods.push(pair);
  }
  return { ok: true, periods };
}

function validateSequence(periods: Pair[], expectedKey: string): Failure | null {
  const saved = new Set<string>();
  const actual = new Set<string>();
  let previousEnd: string | null = null;
  periods.sort((a, b) => a.forecast.target.from.localeCompare(b.forecast.target.from));
  for (const pair of periods) {
    if (comparisonKey(pair.forecast) !== expectedKey) return fail("measurement-mismatch");
    if (saved.has(pair.forecast.snapshotId) || actual.has(pair.actual.manifestId))
      return fail("duplicate-manifest");
    if (previousEnd !== null && pair.forecast.target.from < previousEnd)
      return fail("overlapping-periods");
    saved.add(pair.forecast.snapshotId);
    actual.add(pair.actual.manifestId);
    previousEnd = pair.forecast.target.toExclusive;
  }
  return null;
}

function validatedFrame(input: unknown) {
  const frame = frameSchema.safeParse(input);
  if (!frame.success || frame.data.periods.length === 0) return fail("invalid-input");
  if (frame.data.periods.length > MAX_FORECAST_EVALUATION_PERIODS) return fail("bounded-limit");
  const parsed = parsePairs(frame.data);
  if (!parsed.ok) return parsed;
  const first = parsed.periods[0];
  if (first === undefined) return fail("invalid-input");
  const invalid = validateSequence(parsed.periods, comparisonKey(first.forecast));
  if (invalid !== null) return invalid;
  return {
    ok: true as const,
    evaluationAsOf: frame.data.evaluationAsOf,
    pairs: parsed.periods,
    first,
  };
}

function forecastModel(saved: Pair["forecast"]) {
  return {
    forecastDefinitionVersion: saved.forecastDefinitionVersion,
    modelId: saved.modelId,
    modelVersion: saved.modelVersion,
    scenario: saved.scenario,
  };
}

/**
 * Version 1 compares original, pre-target predictions for a frozen open-deal roster with
 * immutable settled outcome evidence for that same roster. Producers prove manifest custody,
 * current viewer authority, original cutoff, and full positive/negative outcome collection.
 * A matched label enables an input for calibration, never a fitted or qualified probability.
 */
export function evaluateSavedForecasts(input: unknown): ForecastEvaluation {
  const frame = validatedFrame(input);
  if (!frame.ok) return frame;
  const { evaluationAsOf, first } = frame;
  const evaluated: PeriodResult[] = [];
  for (const pair of frame.pairs) {
    const period = evaluatePeriod(pair);
    if (!period.ok) return period;
    evaluated.push(period);
  }
  const periods = evaluated.map(({ report }) => report);
  const scores = evaluated.flatMap(({ score }) => (score === null ? [] : [score]));
  const emptyPeriods = periods.filter(({ moneyStatus }) => moneyStatus === "empty-roster").length;
  return {
    ok: true,
    definitionVersion: FORECAST_EVALUATION_DEFINITION_VERSION,
    basis: "settled-saved-open-cohort",
    evaluationAsOf,
    measurement: first.forecast.measurement,
    forecastModel: forecastModel(first.forecast),
    periods,
    coverage: {
      totalPeriods: periods.length,
      scoredPeriods: scores.length,
      emptyPeriods,
      missingValuePeriods: periods.length - scores.length - emptyPeriods,
    },
    metrics: accuracy(scores),
    calibration: calibration(evaluated, first.forecast.scenario),
  };
}

type Matched = { member: Member; actual: Outcome };

function manifestDigest(kind: "forecast" | "actual", manifest: unknown): string {
  return createHash("sha256")
    .update(`warpdrive-forecast-calibration-manifest-v1\n${kind}\n`)
    .update(JSON.stringify(manifest))
    .digest("hex");
}

function calibrationPeriod(pair: Pair, matched: Matched[]) {
  // Identity is already unique and canonicalized by the shared roster evaluator.
  matched.sort((a, b) => (a.member.dealId < b.member.dealId ? -1 : 1));
  const saved = pair.forecast;
  const settled = pair.actual;
  return {
    forecastSnapshotId: saved.snapshotId,
    actualManifestId: settled.manifestId,
    predictionCutoff: saved.predictionCutoff,
    savedAt: saved.savedAt,
    target: saved.target,
    probabilityEvidence: saved.probabilityEvidence,
    actualObservedAt: settled.observedAt,
    forecastManifestSha256: manifestDigest("forecast", {
      ...saved,
      members: matched.map(({ member }) => member),
    }),
    actualManifestSha256: manifestDigest("actual", {
      ...settled,
      members: matched.map(({ member: { dealId, incarnationId }, actual }) => ({
        dealId,
        incarnationId,
        outcome: actual,
      })),
    }),
    samples: matched.map(({ member, actual }) => ({
      dealId: member.dealId,
      incarnationId: member.incarnationId,
      probability: member.periodWinProbability,
      won: actual.kind === "unknown" ? null : actual.kind === "won",
    })),
  };
}

/** Private custody handoff. A matching fingerprint binds data and does not grant authority. */
export function prepareForecastCalibration(input: unknown) {
  const frame = validatedFrame(input);
  if (!frame.ok) return frame;
  const periods: ReturnType<typeof calibrationPeriod>[] = [];
  const evaluated: PeriodResult[] = [];
  for (const pair of frame.pairs) {
    const matched: Matched[] = [];
    const period = evaluatePeriod(pair, (member, actual) => {
      matched.push({ member, actual });
    });
    if (!period.ok) return period;
    evaluated.push(period);
    periods.push(calibrationPeriod(pair, matched));
  }
  const saved = frame.first.forecast;
  return {
    ok: true as const,
    evaluationAsOf: frame.evaluationAsOf,
    measurement: saved.measurement,
    forecastModel: forecastModel(saved),
    eligibility: calibration(evaluated, saved.scenario),
    periods,
  };
}
