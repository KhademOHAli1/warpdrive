import type { OwnerScope } from "@/types/stats";
import type { ObservedDealWinCohorts } from "./dealCohortRepository";

export const DEAL_WIN_COHORT_HORIZONS = ["30-days", "60-days", "90-days"] as const;
export type DealWinCohortHorizon = (typeof DEAL_WIN_COHORT_HORIZONS)[number];

export const DEAL_WIN_COHORT_HORIZON_DAYS = {
  "30-days": 30,
  "60-days": 60,
  "90-days": 90,
} as const;
const DAY_NS = 86_400_000_000_000n;

export function dealWinCohortHorizon(id: DealWinCohortHorizon) {
  return { id, elapsedNanoseconds: (BigInt(DEAL_WIN_COHORT_HORIZON_DAYS[id]) * DAY_NS).toString() };
}

interface DealWinCohortRow {
  calendarMonthStart: string;
  entered: number;
  mature: number;
  immature: number;
  confirmedWins: number;
  unknownOutcomes: number;
  rate:
    | { state: "available"; wins: number; mature: number }
    | { state: "unavailable"; reason: "no-mature-deals" | "mature-outcome-unknown" };
}

export type DealWinCohortView =
  | { state: "unavailable" }
  | { state: "coverage-not-started" }
  | { state: "period-not-covered" }
  | {
      state: "available";
      definition: "observed-deal-entry-to-win-v1";
      population: "current-authorized-live-deals";
      effectiveOwnerScope: OwnerScope["kind"];
      calendar: "gregory" | "persian";
      timeZone: string;
      observationCutoff: string;
      horizonDays: number;
      covered: {
        state: "complete" | "partial";
        fromInclusive: string;
        to: string;
        upperBound: "inclusive" | "exclusive";
      };
      rows: DealWinCohortRow[];
    };

/**
 * Private-to-view projection. The repository applies the live scope before producing the
 * input. Deliberately omit subject/event IDs, internal reasons, source cut identity, native
 * witnesses and the detailed history. A partial covered interval can include a partial month.
 */
export function dealWinCohortView(
  report: ObservedDealWinCohorts,
  horizon: DealWinCohortHorizon,
): DealWinCohortView {
  if (report.state === "missing") return { state: "coverage-not-started" };
  if (report.state === "unavailable") {
    return report.reason === "period-outside-capture"
      ? { state: "period-not-covered" }
      : { state: "unavailable" };
  }
  const result = report.result;
  const expected = dealWinCohortHorizon(horizon);
  if (
    result.entryBasis !== "observed-deal-insert" ||
    result.outcomeBasis !== "qualified-win" ||
    result.horizon.id !== expected.id ||
    result.horizon.elapsedNanoseconds !== expected.elapsedNanoseconds
  )
    return { state: "unavailable" };
  const covered = report.coverage.covered;
  return {
    state: "available",
    definition: "observed-deal-entry-to-win-v1",
    population: "current-authorized-live-deals",
    effectiveOwnerScope: report.effectiveOwnerScope,
    calendar: result.calendar,
    timeZone: result.timeZone,
    observationCutoff: result.observationCutoff,
    horizonDays: DEAL_WIN_COHORT_HORIZON_DAYS[horizon],
    covered: {
      state: report.coverage.state,
      fromInclusive: covered.fromInclusive,
      to: covered.to,
      upperBound: covered.upperBound,
    },
    rows: result.cohorts.map((row) => ({
      calendarMonthStart: row.bucketId,
      entered: row.entryCount,
      mature: row.denominator,
      immature: row.notYetMatureCount,
      confirmedWins: row.numerator,
      unknownOutcomes: row.matureUnknownCount,
      rate:
        row.comparison.state === "available"
          ? { state: "available", wins: row.numerator, mature: row.denominator }
          : {
              state: "unavailable",
              reason:
                row.comparison.reason === "no-mature-subjects"
                  ? "no-mature-deals"
                  : "mature-outcome-unknown",
            },
    })),
  };
}
