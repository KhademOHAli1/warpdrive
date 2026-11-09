import { describe, expect, it } from "vitest";
import { evaluateSavedForecasts, MAX_FORECAST_EVALUATION_PERIODS } from "./forecastEvaluation";

const dealId = "11111111-1111-4111-8111-111111111111";
const incarnationId = "22222222-2222-4222-8222-222222222222";
const evaluationAsOf = "2026-12-01T00:00:00.000000Z";

type ActualValue = string | null | { kind: "no-win" } | { kind: "unknown" };

function at(month: number, day: number): string {
  return (
    "2026-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0") +
    "T00:00:00.000000Z"
  );
}

function pair(
  month: number,
  expected: string | null,
  realized: ActualValue,
  probabilityEvidence = false,
) {
  const target = {
    from: at(month, 1),
    toExclusive: at(month + 1, 1),
    timeZone: "UTC",
    calendar: "gregory",
  };
  const measurement = {
    currency: "EUR",
    scopeId: "saved-open-pipeline-v1",
    outcomeDefinition: "first-qualified-in-period-won",
    settlementPolicy: "post-target-close-v1",
    restatementPolicy: "frozen-first-settlement-v1",
    measure: "original-currency-won-deal-value",
  };
  const snapshotId = `forecast-${String(month)}`;
  const actualOutcome =
    realized === null || typeof realized === "string"
      ? {
          kind: "won",
          eventId: `win-${String(month)}`,
          occurredAt: at(month, 2),
          observedAt: at(month, 3),
          value: realized,
        }
      : realized.kind === "no-win"
        ? { kind: "no-win", witnessId: `closed-cut-${String(month)}` }
        : realized;
  return {
    forecast: {
      schemaVersion: 1,
      snapshotId,
      completeness: "complete",
      forecastDefinitionVersion: 1,
      scenario: "base",
      modelId: "forecast-model",
      modelVersion: "version-1",
      measurement,
      target,
      predictionCutoff: at(month - 1, 15),
      savedAt: at(month - 1, 16),
      openDealCount: 1,
      probabilityEvidence: probabilityEvidence
        ? {
            kind: "out-of-time-model",
            trainedThrough: at(1, 1),
            frozenAt: at(1, 2),
            holdoutRef: "holdout-2026",
          }
        : null,
      members: [
        { dealId, incarnationId, expectedWonValue: expected, periodWinProbability: "0.5" },
      ] as const,
    },
    actual: {
      schemaVersion: 1,
      manifestId: `settled-${String(month)}`,
      forecastSnapshotId: snapshotId,
      completeness: "complete",
      measurement,
      target,
      settledThrough: at(month + 1, 2),
      observedAt: at(month + 1, 3),
      coveredDealCount: 1,
      members: [{ dealId, incarnationId, outcome: actualOutcome }] as const,
    },
  };
}

function evaluate(...periods: unknown[]) {
  return evaluateSavedForecasts({ definitionVersion: 1, evaluationAsOf, periods });
}

describe("immutable saved forecast evaluation", () => {
  it("uses exact signed bias and unweighted period MAE with both over- and underprediction", () => {
    const result = evaluate(
      pair(4, "0", { kind: "no-win" }),
      pair(3, "29.8750", "50.0000"),
      pair(2, "100.1250", "80.0000"),
    );
    expect(result).toMatchObject({
      ok: true,
      measurement: { currency: "EUR" },
      coverage: { totalPeriods: 3, scoredPeriods: 3, emptyPeriods: 0, missingValuePeriods: 0 },
      metrics: {
        signedErrorTotal: "0.0000",
        absoluteErrorTotal: "40.2500",
        meanBias: { numerator: "0.0000", denominator: 3 },
        meanAbsoluteError: { numerator: "40.2500", denominator: 3 },
        weightedAbsoluteError: { numerator: "40.2500", denominator: "130.0000" },
        zeroForecastPeriods: 1,
        zeroActualPeriods: 1,
        bothZeroPeriods: 1,
      },
      periods: [
        { forecastSnapshotId: "forecast-2", money: { signedError: "20.1250" } },
        { forecastSnapshotId: "forecast-3", money: { signedError: "-20.1250" } },
        { forecastSnapshotId: "forecast-4", money: { signedError: "0.0000" } },
      ],
      calibration: { state: "ineligible", reason: "missing-model-evidence" },
    });
  });

  it("keeps all 22 decimal places and leaves weighted error undefined for zero actuals", () => {
    const tiny = "0.0000000000000000000001";
    expect(evaluate(pair(2, tiny, { kind: "no-win" }))).toMatchObject({
      ok: true,
      metrics: {
        meanAbsoluteError: { numerator: tiny, denominator: 1 },
        meanBias: { numerator: tiny, denominator: 1 },
        weightedAbsoluteError: null,
        zeroActualPeriods: 1,
      },
    });
    expect(evaluate(pair(2, "0", "1.2500"))).toMatchObject({
      ok: true,
      metrics: { signedErrorTotal: "-1.2500", zeroForecastPeriods: 1, zeroActualPeriods: 0 },
    });
  });

  it("does not infer zero from unknown actuals or absent forecast value", () => {
    expect(
      evaluate(pair(2, "20", { kind: "unknown" }, true), pair(3, null, "18", true)),
    ).toMatchObject({
      ok: true,
      coverage: { totalPeriods: 2, scoredPeriods: 0, missingValuePeriods: 2 },
      periods: [
        { moneyStatus: "missing-value-evidence", money: null, coverage: { knownActualValues: 0 } },
        {
          moneyStatus: "missing-value-evidence",
          money: null,
          coverage: { knownForecastValues: 0 },
        },
      ],
      metrics: null,
      calibration: { state: "ineligible", reason: "missing-probabilities-or-labels" },
    });
  });

  it("allows probability eligibility with both labels even when a win's amount is unknown", () => {
    expect(
      evaluate(pair(2, "20", null, true), pair(3, "0", { kind: "no-win" }, true)),
    ).toMatchObject({
      ok: true,
      coverage: { scoredPeriods: 1, missingValuePeriods: 1 },
      calibration: { state: "eligible-inputs", observations: 2, positives: 1, negatives: 1 },
    });
    expect(evaluate(pair(2, "20", "10", true))).toMatchObject({
      ok: true,
      calibration: { state: "ineligible", reason: "single-class", observations: 1 },
    });
    const whatIf = pair(2, "20", "10", true);
    expect(
      evaluate({ ...whatIf, forecast: { ...whatIf.forecast, scenario: "upside" } }),
    ).toMatchObject({
      ok: true,
      coverage: { scoredPeriods: 1 },
      calibration: { state: "ineligible", reason: "not-base-forecast" },
    });
  });

  it("rejects forecasts saved at the target start, immature actuals and a future outcome witness", () => {
    const original = pair(2, "20", "10", true);
    expect(
      evaluate({ ...original, forecast: { ...original.forecast, savedAt: at(2, 1) } }),
    ).toEqual({ ok: false, reason: "forecast-cutoff-invalid" });
    expect(
      evaluate({ ...original, actual: { ...original.actual, settledThrough: at(2, 28) } }),
    ).toEqual({ ok: false, reason: "actuals-unsettled" });
    expect(
      evaluate({
        ...original,
        actual: {
          ...original.actual,
          members: [
            {
              dealId,
              incarnationId,
              outcome: {
                kind: "won",
                eventId: "late-win",
                occurredAt: at(2, 3),
                observedAt: at(3, 4),
                value: "10",
              },
            },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: "actual-evidence-outside-fence" });
    expect(
      evaluate({
        ...original,
        forecast: {
          ...original.forecast,
          probabilityEvidence: {
            kind: "out-of-time-model",
            trainedThrough: at(1, 1),
            frozenAt: at(1, 16),
            holdoutRef: "late-model",
          },
        },
      }),
    ).toEqual({ ok: false, reason: "model-evidence-after-cutoff" });
  });

  it("admits the last in-period microsecond and rejects a win at the exclusive end", () => {
    const original = pair(2, "20", "10");
    const winAt = (occurredAt: string) => ({
      ...original,
      actual: {
        ...original.actual,
        members: [
          {
            dealId,
            incarnationId,
            outcome: {
              kind: "won",
              eventId: "end-win",
              occurredAt,
              observedAt: at(3, 1),
              value: "10",
            },
          },
        ],
      },
    });
    expect(evaluate(winAt("2026-02-28T23:59:59.999999Z"))).toMatchObject({
      ok: true,
      coverage: { scoredPeriods: 1 },
    });
    expect(evaluate(winAt(at(3, 1)))).toEqual({
      ok: false,
      reason: "actual-evidence-outside-fence",
    });
  });

  it("fails closed on incomplete custody, mixed definitions, reused manifests and changed roster", () => {
    const original = pair(2, "20", "10");
    expect(
      evaluate({ ...original, actual: { ...original.actual, completeness: "incomplete" } }),
    ).toEqual({ ok: false, reason: "incomplete-manifest" });
    expect(
      evaluate({
        ...original,
        actual: {
          ...original.actual,
          measurement: { ...original.actual.measurement, currency: "USD" },
        },
      }),
    ).toEqual({ ok: false, reason: "measurement-mismatch" });
    expect(evaluate(original, original)).toEqual({ ok: false, reason: "duplicate-manifest" });
    expect(
      evaluate({
        ...original,
        actual: {
          ...original.actual,
          members: [
            {
              ...original.actual.members[0],
              incarnationId: "33333333-3333-4333-8333-333333333333",
            },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: "roster-mismatch" });
    expect(
      evaluate(...Array.from({ length: MAX_FORECAST_EVALUATION_PERIODS + 1 }, () => original)),
    ).toEqual({ ok: false, reason: "bounded-limit" });
  });
});
