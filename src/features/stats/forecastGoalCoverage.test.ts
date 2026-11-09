import { describe, expect, test } from "vitest";
import type { KpiGoalResult } from "@/features/goals/kpiModel";
import { type ForecastGoalContext, projectForecastGoalCoverage } from "./forecastGoalCoverage";

const userId = "01000000-0000-4000-8000-000000000001";
const pipelineId = "02000000-0000-4000-8000-000000000001";
const teamId = "03000000-0000-4000-8000-000000000001";
const definitionId = "04000000-0000-4000-8000-000000000001";
const assignmentId = "05000000-0000-4000-8000-000000000001";
const cutoff = "2026-05-15T10:30:00.000001Z";
const availableScenario = {
  expectedWonCount: { knownTotal: "1", knownDealCount: 2, missingDealCount: 0 },
  expectedWonValue: { knownTotal: "0.0000", knownDealCount: 2, missingDealCount: 0 },
  missingWinProbabilityCount: 0,
  missingTimingProbabilityCount: 0,
} as const;
const context: ForecastGoalContext = {
  viewerId: userId,
  pipelineId,
  ownerScope: { kind: "me" },
  transactionSnapshot: "12:13:",
  forecast: {
    state: "available",
    basis: "explicit-manual-what-if",
    rosterBasis: "captured-current-open-deals",
    policyVersion: 1,
    calculationVersion: 1,
    currency: "EUR",
    cutoffObservedAt: cutoff,
    target: {
      from: "2026-05-31T22:00:00.000000Z",
      toExclusive: "2026-06-30T22:00:00.000000Z",
      timeZone: "Europe/Berlin",
      calendar: "gregory",
    },
    targetDates: { from: "2026-06-01", to: "2026-06-30" },
    scope: { pipeline: "selected", owner: "me" },
    assumptions: {
      conservative: { pWin: "0.5", pCloseInPeriodGivenWin: "1", sizeMultiplier: "0" },
      base: { pWin: "0.5", pCloseInPeriodGivenWin: "1" },
      upside: { pWin: null, pCloseInPeriodGivenWin: "1" },
    },
    openDealCount: 2,
    recordedOpenValue: { knownTotal: "80.2468", knownDealCount: 2, missingDealCount: 0 },
    scenarios: {
      conservative: availableScenario,
      base: {
        ...availableScenario,
        expectedWonValue: {
          knownTotal: "40.1234567890123456789012",
          knownDealCount: 2,
          missingDealCount: 0,
        },
      },
      upside: {
        ...availableScenario,
        expectedWonCount: { knownTotal: null, knownDealCount: 0, missingDealCount: 2 },
        expectedWonValue: { knownTotal: null, knownDealCount: 0, missingDealCount: 2 },
        missingWinProbabilityCount: 2,
      },
    },
  },
};

const result: KpiGoalResult = {
  goal: {
    id: assignmentId,
    definitionId,
    scope: "user",
    scopeId: userId,
    condition: { kind: "at_least", target: "100.1234" },
    period: { kind: "calendar", interval: "monthly", startsOn: "2026-01-01" },
    pacing: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  definition: {
    id: definitionId,
    familyId: definitionId,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    name: "Booked won value",
    description: "",
    source: "deals",
    calculation: "sum",
    unit: "money",
    currency: "EUR",
    dateField: "closed",
    filters: { pipelineId, status: "won" },
    valueField: "value",
  },
  measurement: {
    state: "available",
    value: "0",
    recordCount: 0,
    excludedCount: 0,
    missingMeasurementDateCount: 0,
    numerator: null,
    denominator: null,
    sampleSize: 0,
    contributors: [],
    contributorsTruncated: false,
    issues: ["viewer_visible_records", "current_record_state", "date_field_required"],
    evaluatedAt: "2026-05-15T10:30:00.002Z",
    period: { start: "2026-06-01", end: "2026-06-30" },
  },
  assessment: { standing: "in_progress", attainment: 0, pace: null },
};

describe("forecast goal coverage", () => {
  test("takes booked zero from a complete empty KPI and retains exact scenario coverage and gap", () => {
    expect(projectForecastGoalCoverage(context, result)).toEqual({
      state: "available",
      source: "current-pinned-won-value-kpi-v1",
      currency: "EUR",
      bookedNominalValue: "0.00",
      targetNominalValue: "100.1234",
      remainingNominalValue: "100.1234",
      coverage: {
        state: "available",
        scenarios: {
          conservative: {
            state: "available",
            numerator: "0.0000",
            denominator: "100.1234",
            remainingAfterScenario: "100.1234",
          },
          base: {
            state: "available",
            numerator: "40.1234567890123456789012",
            denominator: "100.1234",
            remainingAfterScenario: "59.9999432109876543210988",
          },
          upside: { state: "unavailable", reason: "incomplete-forecast" },
        },
      },
    });
  });

  test.each(["0", "-1.25"])(
    "keeps target %s and booked zero without a coverage ratio",
    (target) => {
      expect(
        projectForecastGoalCoverage(context, {
          ...result,
          goal: { ...result.goal, condition: { kind: "at_least", target } },
        }),
      ).toMatchObject({
        state: "available",
        targetNominalValue: target,
        bookedNominalValue: "0.00",
        remainingNominalValue: "0.00",
        coverage: { state: "unavailable", reason: "no-positive-remaining-target" },
      });
    },
  );

  test("refuses a currency, pipeline, assignee or metric mismatch", () => {
    for (const definition of [
      { ...result.definition, currency: "USD" },
      { ...result.definition, filters: { ...result.definition.filters, pipelineId: null } },
    ]) {
      expect(projectForecastGoalCoverage(context, { ...result, definition })).toEqual({
        state: "unavailable",
        reason: "scope-mismatch",
      });
    }
    expect(
      projectForecastGoalCoverage(context, {
        ...result,
        goal: { ...result.goal, scope: "team", scopeId: teamId },
      }),
    ).toEqual({ state: "unavailable", reason: "scope-mismatch" });
    expect(
      projectForecastGoalCoverage(context, {
        ...result,
        definition: { ...result.definition, dateField: "created" },
      }),
    ).toEqual({ state: "unavailable", reason: "target-unavailable" });
    expect(
      projectForecastGoalCoverage(context, {
        ...result,
        goal: { ...result.goal, condition: { kind: "at_most", target: "100" } },
      }),
    ).toEqual({ state: "unavailable", reason: "target-unavailable" });
  });

  test("uses exactly one KPI occurrence and keeps a rolling window unavailable", () => {
    const oneOff = {
      ...result,
      goal: {
        ...result.goal,
        period: {
          kind: "one_off",
          interval: "yearly",
          startsOn: "2026-06-01",
          endsOn: "2026-06-30",
        } as const,
      },
    };
    expect(projectForecastGoalCoverage(context, oneOff)).toMatchObject({ state: "available" });
    for (const period of [
      { ...oneOff.goal.period, endsOn: "2026-06-29" },
      { ...result.goal.period, kind: "rolling", rollingDays: 30 } as const,
      { ...result.goal.period, interval: "quarterly", fiscalStartMonth: 2 } as const,
    ]) {
      expect(
        projectForecastGoalCoverage(context, { ...result, goal: { ...result.goal, period } }),
      ).toEqual({ state: "unavailable", reason: "period-mismatch" });
    }
  });

  test("does not treat partial, frozen or future-dated won facts as booked zero", () => {
    for (const measurement of [
      { ...result.measurement, state: "stale" as const },
      { ...result.measurement, state: "incomplete" as const, value: null },
      { ...result.measurement, issues: ["frozen_viewer_snapshot"] },
      { ...result.measurement, recordCount: 1 },
      { ...result.measurement, value: "12.00", recordCount: 1 },
      { ...result.measurement, period: { start: "2026-06-01", end: "2026-06-29" } },
    ]) {
      expect(projectForecastGoalCoverage(context, { ...result, measurement })).toEqual({
        state: "unavailable",
        reason: "booked-unavailable",
      });
    }
    expect(
      projectForecastGoalCoverage(
        {
          ...context,
          forecast: { ...context.forecast, cutoffObservedAt: context.forecast.target.from },
        },
        result,
      ),
    ).toEqual({ state: "unavailable", reason: "period-mismatch" });
  });
});
