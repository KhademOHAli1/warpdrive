import { describe, expect, it } from "vitest";
import { prepareForecastCalibration } from "./forecastEvaluation";
import {
  type AuthorizedForecastCalibrationInput,
  evaluateForecastProbabilityCalibration,
} from "./forecastProbabilityCalibration";

const evaluationAsOf = "2026-12-01T00:00:00.000000Z";
const digest = "a".repeat(64);

function at(month: number, day: number): string {
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000000Z`;
}

function id(family: string, index: number): string {
  return `${family}0000000-1111-4111-8111-${String(index).padStart(12, "0")}`;
}

type Observation = readonly [probability: string | null, won: boolean | null];

function pair(month: number, observations: readonly Observation[], offset = 0) {
  const target = {
    from: at(month, 1),
    toExclusive: at(month + 1, 1),
    timeZone: "UTC",
    calendar: "gregory" as const,
  };
  const measurement = {
    currency: "EUR",
    scopeId: "saved-pipeline-v1",
    outcomeDefinition: "first-qualified-in-period-win",
    settlementPolicy: "post-target-close-v1",
    restatementPolicy: "frozen-first-settlement-v1",
    measure: "original-currency-won-deal-value",
  };
  const snapshotId = id("3", month);
  const identities = observations.map((_, index) => ({
    dealId: id("1", offset + index),
    incarnationId: id("2", offset + index),
  }));
  return {
    forecast: {
      schemaVersion: 1,
      snapshotId,
      completeness: "complete",
      forecastDefinitionVersion: 1,
      scenario: "base",
      modelId: "pipeline-model",
      modelVersion: "version-1",
      measurement,
      target,
      predictionCutoff: at(month - 1, 15),
      savedAt: at(month - 1, 16),
      openDealCount: observations.length,
      probabilityEvidence: {
        kind: "out-of-time-model",
        trainedThrough: at(1, 1),
        frozenAt: at(1, 2),
        holdoutRef: "holdout-2026",
      },
      members: observations.map(([probability], index) => ({
        ...identities[index],
        expectedWonValue: null,
        periodWinProbability: probability,
      })),
    },
    actual: {
      schemaVersion: 1,
      manifestId: `actual-${month}`,
      forecastSnapshotId: snapshotId,
      completeness: "complete",
      measurement,
      target,
      settledThrough: at(month + 1, 2),
      observedAt: at(month + 1, 3),
      coveredDealCount: observations.length,
      members: observations.map(([, won], index) => ({
        ...identities[index],
        outcome:
          won === null
            ? { kind: "unknown" }
            : won
              ? {
                  kind: "won",
                  eventId: `win-${month}-${index}`,
                  occurredAt: at(month, 2),
                  observedAt: at(month, 3),
                  value: null,
                }
              : { kind: "no-win", witnessId: `absence-${month}-${index}` },
      })),
    },
  };
}

function frame(...periods: ReturnType<typeof pair>[]) {
  return { definitionVersion: 1, evaluationAsOf, periods };
}

function authorize(evaluation: ReturnType<typeof frame>): AuthorizedForecastCalibrationInput {
  const prepared = prepareForecastCalibration(evaluation);
  if (!prepared.ok) throw new Error(prepared.reason);
  // Synthetic receipt shapes exercise the binding; only the native issuer can prove visibility.
  const periods: AuthorizedForecastCalibrationInput["periods"] = prepared.periods.map(
    (period, index) => ({
      commit: {
        definitionVersion: 1,
        basis: "independent-native-visibility-before-target",
        creatorId: id("4", 1),
        snapshotId: period.forecastSnapshotId,
        activationId: id("5", 1),
        requestKey: id("6", index),
        currency: prepared.measurement.currency,
        writerXid: "20",
        captureSnapshot: "20:20:",
        predictionCutoff: period.predictionCutoff,
        insertedAt: period.predictionCutoff,
        requestSha256: digest,
        payloadSha256: digest,
        target: {
          ...period.target,
          fromDate: period.target.from.slice(0, 10),
          toExclusiveDate: period.target.toExclusive.slice(0, 10),
        },
        confirmedAt: period.savedAt,
        confirmationSnapshot: "21:21:",
        rowXmin: "20",
      },
      forecastManifestSha256: period.forecastManifestSha256,
      actual: {
        manifestId: period.actualManifestId,
        manifestSha256: period.actualManifestSha256,
        finalizedAt: period.actualObservedAt,
      },
    }),
  );
  return {
    evaluation,
    periods,
    holdout: {
      holdoutRef: "holdout-2026",
      plannedAt: at(1, 3),
      modelId: prepared.forecastModel.modelId,
      modelVersion: prepared.forecastModel.modelVersion,
      modelArtifactSha256: digest,
      trainedThrough: at(1, 1),
      frozenAt: at(1, 2),
      measurement: prepared.measurement,
      targets: prepared.periods.map(({ target }) => target),
    },
  } as AuthorizedForecastCalibrationInput;
}

function repeated(count: number, probability: string, won: boolean): Observation[] {
  return Array.from({ length: count }, () => [probability, won] as const);
}

describe("private forecast probability calibration", () => {
  it("reports exact Brier loss and half-open deciles with the right endpoint included", () => {
    const evaluation = frame(
      pair(3, [
        ...repeated(30, "0", false),
        ...repeated(30, "0.1", false),
        ...repeated(30, "0.9", true),
        ...repeated(30, "1", true),
      ]),
    );
    const result = evaluateForecastProbabilityCalibration(authorize(evaluation));
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result).toMatchObject({ observations: 120, positives: 60, negatives: 60 });
    expect(BigInt(result.brier.numerator) * 200n).toBe(BigInt(result.brier.denominator));
    expect(result.bins).toHaveLength(10);
    expect(result.bins[0]).toMatchObject({
      from: "0",
      to: "0.1",
      toInclusive: false,
      observations: 30,
      meanPrediction: { numerator: "0", denominator: "30000000000000" },
    });
    expect(result.bins[1]).toMatchObject({
      from: "0.1",
      to: "0.2",
      observations: 30,
      meanPrediction: { numerator: "3000000000000", denominator: "30000000000000" },
      observedWinRate: { numerator: "0", denominator: "30" },
    });
    expect(result.bins[9]).toMatchObject({
      from: "0.9",
      to: "1",
      toInclusive: true,
      observations: 60,
      meanPrediction: { numerator: "57000000000000", denominator: "60000000000000" },
      observedWinRate: { numerator: "60", denominator: "60" },
    });
  });

  it("withholds overall scores for a small or single-class sample and rates for a sparse bin", () => {
    for (const observations of [
      [
        ["0.1", false],
        ["0.9", true],
      ] satisfies Observation[],
      repeated(120, "0.1", false),
    ]) {
      expect(
        evaluateForecastProbabilityCalibration(authorize(frame(pair(3, observations)))),
      ).toMatchObject({
        state: "insufficient-sample",
        brier: null,
        bins: null,
      });
    }
    const observations: Observation[] = [
      ...repeated(49, "0.1", false),
      ["0.299999999999", false],
      ...repeated(50, "0.9", true),
    ];
    const result = evaluateForecastProbabilityCalibration(authorize(frame(pair(3, observations))));
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.bins[2]).toMatchObject({
      observations: 1,
      state: "insufficient-sample",
      meanPrediction: null,
      observedWinRate: null,
    });
    expect(result.bins[3]).toMatchObject({ observations: 0, state: "empty" });
  });

  it("binds exact forecast and actual content independently of member order", () => {
    const period = pair(3, [
      ["0.1", false],
      ["0.9", true],
    ]);
    const input = authorize(frame(period));
    period.forecast.members.reverse();
    period.actual.members.reverse();
    expect(evaluateForecastProbabilityCalibration(input).state).toBe("insufficient-sample");

    const prediction = period.forecast.members[0];
    const actual = period.actual.members[0];
    if (prediction === undefined || actual === undefined) throw new Error("Fixture is empty");
    prediction.periodWinProbability = "0.8";
    expect(evaluateForecastProbabilityCalibration(input)).toEqual({
      state: "unavailable",
      reason: "unqualified-evidence",
    });
    prediction.periodWinProbability = "0.9";
    actual.outcome = { kind: "no-win", witnessId: "replacement" };
    expect(evaluateForecastProbabilityCalibration(input)).toEqual({
      state: "unavailable",
      reason: "unqualified-evidence",
    });
  });

  it("rejects late commit confirmation, late settlement custody and a reselected holdout", () => {
    const input = authorize(
      frame(
        pair(3, [
          ["0.1", false],
          ["0.9", true],
        ]),
      ),
    );
    const [first] = input.periods;
    if (first === undefined) throw new Error("Fixture is empty");
    const cases: AuthorizedForecastCalibrationInput[] = [
      { ...input, periods: [{ ...first, commit: { ...first.commit, confirmedAt: at(3, 1) } }] },
      { ...input, periods: [{ ...first, actual: { ...first.actual, finalizedAt: at(12, 2) } }] },
      { ...input, holdout: { ...input.holdout, plannedAt: at(2, 16) } },
      { ...input, holdout: { ...input.holdout, frozenAt: at(2, 15) } },
      {
        ...input,
        holdout: {
          ...input.holdout,
          measurement: { ...input.holdout.measurement, scopeId: "different-scope" },
        },
      },
      { ...input, holdout: { ...input.holdout, targets: [] } },
    ];
    for (const variant of cases) {
      expect(evaluateForecastProbabilityCalibration(variant)).toEqual({
        state: "unavailable",
        reason: "unqualified-evidence",
      });
    }
  });

  it("rejects repeated deals across non-overlapping target periods", () => {
    const first = pair(3, [["0.1", false]]);
    const second = pair(4, [["0.9", true]]);
    expect(evaluateForecastProbabilityCalibration(authorize(frame(second, first)))).toEqual({
      state: "unavailable",
      reason: "repeated-member",
    });
  });

  it("withholds all calibration on missing probabilities, unknown labels or a what-if scenario", () => {
    const manual = pair(3, [
      ["0.1", false],
      ["0.9", true],
    ]);
    manual.forecast.scenario = "upside";
    for (const period of [pair(3, [[null, false]]), pair(3, [["0.1", null]]), manual]) {
      expect(evaluateForecastProbabilityCalibration(authorize(frame(period)))).toEqual({
        state: "unavailable",
        reason: "ineligible-probabilities",
      });
    }
  });

  it("requires complete actual settlement through the target's exclusive end", () => {
    const period = pair(3, [["0.1", false]]);
    const input = authorize(frame(period));
    period.actual.settledThrough = at(3, 31);
    expect(evaluateForecastProbabilityCalibration(input)).toEqual({
      state: "unavailable",
      reason: "invalid-evaluation",
    });
  });
});
