import { z } from "zod";
import { prepareForecastCalibration } from "./forecastEvaluation";
import type { PrivateForecastCommitProof } from "./history/forecastCommitQualification";

export const FORECAST_PROBABILITY_CALIBRATION_VERSION = 1;

const SCALE = 1_000_000_000_000n;
const BIN_COUNT = 10;
const BIN_WIDTH = SCALE / BigInt(BIN_COUNT);
const MIN_OBSERVATIONS = 100;
const MIN_PER_CLASS = 20;
const MIN_BIN_OBSERVATIONS = 10;
const sha256 = /^[0-9a-f]{64}$/u;
const instant = z.string().datetime({ precision: 6 });
declare const authorizedCalibration: unique symbol;

type Prepared = Extract<ReturnType<typeof prepareForecastCalibration>, { ok: true }>;
type Period = Prepared["periods"][number];

interface PeriodEvidence {
  commit: PrivateForecastCommitProof;
  forecastManifestSha256: string;
  actual: { manifestId: string; manifestSha256: string; finalizedAt: string };
}

/**
 * Future private issuer only. It must reauthorize the whole cohort, derive the forecast
 * manifest from the exact qualified immutable snapshot bytes, prove complete settled actual
 * custody, and verify frozen model, pre-cutoff features and holdout membership from source.
 * A branded value and matching dates or hashes alone do not supply that proof.
 */
export interface AuthorizedForecastCalibrationInput {
  readonly [authorizedCalibration]: true;
  readonly evaluation: unknown;
  readonly periods: readonly PeriodEvidence[];
  readonly holdout: {
    holdoutRef: string;
    plannedAt: string;
    modelId: string;
    modelVersion: string;
    modelArtifactSha256: string;
    trainedThrough: string;
    frozenAt: string;
    measurement: Prepared["measurement"];
    targets: readonly Period["target"][];
  };
}

interface ExactRatio {
  numerator: string;
  denominator: string;
}

interface Counts {
  observations: number;
  positives: number;
  negatives: number;
}

interface BinScore extends Counts {
  from: string;
  to: string;
  toInclusive: boolean;
  state: "empty" | "insufficient-sample" | "available";
  meanPrediction: ExactRatio | null;
  observedWinRate: ExactRatio | null;
}

interface ScoredFrame extends Counts {
  definitionVersion: typeof FORECAST_PROBABILITY_CALIBRATION_VERSION;
  basis: "descriptive-out-of-time-evaluation";
  evaluationAsOf: string;
  measurement: Prepared["measurement"];
  forecastModel: Prepared["forecastModel"];
  periodCount: number;
}

export type ForecastProbabilityCalibration =
  | {
      state: "unavailable";
      reason:
        | "invalid-evaluation"
        | "unqualified-evidence"
        | "ineligible-probabilities"
        | "repeated-member";
    }
  | (ScoredFrame & { state: "insufficient-sample"; brier: null; bins: null })
  | (ScoredFrame & { state: "available"; brier: ExactRatio; bins: BinScore[] });

function sameTarget(a: Period["target"], b: Period["target"]): boolean {
  return (
    a.from === b.from &&
    a.toExclusive === b.toExclusive &&
    a.timeZone === b.timeZone &&
    a.calendar === b.calendar
  );
}

function matchesNativeCommit(commit: PrivateForecastCommitProof, period: Period, currency: string) {
  return (
    commit.definitionVersion === 1 &&
    commit.basis === "independent-native-visibility-before-target" &&
    commit.snapshotId === period.forecastSnapshotId &&
    commit.currency === currency &&
    commit.predictionCutoff === period.predictionCutoff &&
    commit.confirmedAt === period.savedAt &&
    instant.safeParse(commit.insertedAt).success &&
    commit.predictionCutoff <= commit.insertedAt &&
    commit.insertedAt <= commit.confirmedAt &&
    commit.confirmedAt < period.target.from &&
    sameTarget(commit.target, period.target) &&
    sha256.test(commit.requestSha256) &&
    sha256.test(commit.payloadSha256)
  );
}

function matchesPeriod(evidence: PeriodEvidence, period: Period, frame: Prepared): boolean {
  const { actual, commit, forecastManifestSha256 } = evidence;
  return (
    forecastManifestSha256 === period.forecastManifestSha256 &&
    matchesNativeCommit(commit, period, frame.measurement.currency) &&
    actual.manifestId === period.actualManifestId &&
    actual.manifestSha256 === period.actualManifestSha256 &&
    instant.safeParse(actual.finalizedAt).success &&
    period.actualObservedAt <= actual.finalizedAt &&
    actual.finalizedAt <= frame.evaluationAsOf
  );
}

function modelMatchesPlan(
  period: Period,
  plan: AuthorizedForecastCalibrationInput["holdout"],
  target: Period["target"],
): boolean {
  const evidence = period.probabilityEvidence;
  return (
    evidence !== null &&
    evidence.holdoutRef === plan.holdoutRef &&
    evidence.frozenAt === plan.frozenAt &&
    evidence.trainedThrough === plan.trainedThrough &&
    plan.plannedAt <= period.predictionCutoff &&
    sameTarget(period.target, target)
  );
}

function sameMeasurement(a: Prepared["measurement"], b: Prepared["measurement"]): boolean {
  return (
    a.scopeId === b.scopeId &&
    a.currency === b.currency &&
    a.outcomeDefinition === b.outcomeDefinition &&
    a.settlementPolicy === b.settlementPolicy &&
    a.restatementPolicy === b.restatementPolicy &&
    a.measure === b.measure
  );
}

function evidenceMatches(input: AuthorizedForecastCalibrationInput, frame: Prepared): boolean {
  const { holdout, periods } = input;
  if (
    periods.length !== frame.periods.length ||
    holdout.targets.length !== frame.periods.length ||
    !sha256.test(holdout.modelArtifactSha256) ||
    !instant.safeParse(holdout.plannedAt).success ||
    holdout.modelId !== frame.forecastModel.modelId ||
    holdout.modelVersion !== frame.forecastModel.modelVersion ||
    !sameMeasurement(holdout.measurement, frame.measurement)
  )
    return false;
  // The plan and custody list both follow canonical target-start order.
  return frame.periods.every((period, index) => {
    const evidence = periods[index];
    const target = holdout.targets[index];
    return (
      evidence !== undefined &&
      target !== undefined &&
      modelMatchesPlan(period, holdout, target) &&
      matchesPeriod(evidence, period, frame)
    );
  });
}

interface Bin {
  observations: number;
  positives: number;
  predictedUnits: bigint;
}

function probabilityUnits(value: string): bigint {
  // Shared manifest parsing already bounds this to [0, 1] and at most 12 fractional places.
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"));
}

function exactRatio(numerator: bigint, denominator: bigint): ExactRatio {
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

function boundary(index: number): string {
  if (index === 0) return "0";
  if (index === BIN_COUNT) return "1";
  return `0.${index}`;
}

function binScore(bin: Bin, index: number): BinScore {
  const { observations, positives, predictedUnits } = bin;
  const state =
    observations === 0
      ? "empty"
      : observations < MIN_BIN_OBSERVATIONS
        ? "insufficient-sample"
        : "available";
  const count = BigInt(observations);
  return {
    from: boundary(index),
    to: boundary(index + 1),
    toInclusive: index === BIN_COUNT - 1,
    observations,
    positives,
    negatives: observations - positives,
    state,
    meanPrediction: state === "available" ? exactRatio(predictedUnits, count * SCALE) : null,
    observedWinRate: state === "available" ? exactRatio(BigInt(positives), count) : null,
  };
}

function collectScores(frame: Prepared) {
  const dealIds = new Set<string>();
  const incarnationIds = new Set<string>();
  const bins: Bin[] = Array.from({ length: BIN_COUNT }, () => ({
    observations: 0,
    positives: 0,
    predictedUnits: 0n,
  }));
  let brierUnits = 0n;
  for (const { dealId, incarnationId, probability, won } of frame.periods.flatMap(
    ({ samples }) => samples,
  )) {
    if (dealIds.has(dealId) || incarnationIds.has(incarnationId)) {
      return { ok: false as const, reason: "repeated-member" as const };
    }
    if (probability === null || won === null) {
      return { ok: false as const, reason: "ineligible-probabilities" as const };
    }
    dealIds.add(dealId);
    incarnationIds.add(incarnationId);
    const units = probabilityUnits(probability);
    const bin = bins[Math.min(BIN_COUNT - 1, Number(units / BIN_WIDTH))];
    if (bin === undefined) return { ok: false as const, reason: "invalid-evaluation" as const };
    bin.observations += 1;
    bin.positives += Number(won);
    bin.predictedUnits += units;
    const error = units - (won ? SCALE : 0n);
    brierUnits += error * error;
  }
  return { ok: true as const, bins, brierUnits };
}

/** Computes exact descriptive calibration scores for one frozen out-of-time holdout. */
export function evaluateForecastProbabilityCalibration(
  input: AuthorizedForecastCalibrationInput,
): ForecastProbabilityCalibration {
  const frame = prepareForecastCalibration(input.evaluation);
  if (!frame.ok) return { state: "unavailable", reason: "invalid-evaluation" };
  const eligibility = frame.eligibility;
  if (eligibility.state === "ineligible" && eligibility.reason !== "single-class") {
    return { state: "unavailable", reason: "ineligible-probabilities" };
  }
  if (!evidenceMatches(input, frame))
    return { state: "unavailable", reason: "unqualified-evidence" };
  const scores = collectScores(frame);
  if (!scores.ok) return { state: "unavailable", reason: scores.reason };

  const { observations, positives, negatives } = eligibility;
  const report: ScoredFrame = {
    definitionVersion: FORECAST_PROBABILITY_CALIBRATION_VERSION,
    basis: "descriptive-out-of-time-evaluation",
    evaluationAsOf: frame.evaluationAsOf,
    measurement: frame.measurement,
    forecastModel: frame.forecastModel,
    periodCount: frame.periods.length,
    observations,
    positives,
    negatives,
  };
  if (observations < MIN_OBSERVATIONS || positives < MIN_PER_CLASS || negatives < MIN_PER_CLASS) {
    return { state: "insufficient-sample", ...report, brier: null, bins: null };
  }
  return {
    state: "available",
    ...report,
    brier: exactRatio(scores.brierUnits, BigInt(observations) * SCALE * SCALE),
    bins: scores.bins.map(binScore),
  };
}
