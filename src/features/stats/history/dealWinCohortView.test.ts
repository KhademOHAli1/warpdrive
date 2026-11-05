import { assert, expect, test } from "vitest";
import type { ObservedDealWinCohorts } from "./dealCohortRepository";
import { dealWinCohortHorizon, dealWinCohortView } from "./dealWinCohortView";
import { type CohortSubject, computeEqualAgeCohorts } from "./equalAgeCohorts";

const entry: CohortSubject = {
  subjectId: "private-deal-incarnation",
  bucketId: "2026-08-23",
  entryBasis: "observed-deal-insert",
  entryEventId: "private-entry-event",
  enteredAt: "2026-08-29T12:00:00Z",
  outcome: {
    kind: "event",
    basis: "qualified-win",
    eventId: "private-win-event",
    at: "2026-09-06T12:00:00Z",
  },
};
const bounds = {
  requested: { fromInclusive: "2026-07-01T00:00:00Z", toExclusive: "2026-12-01T00:00:00Z" },
  activatedAt: "2026-08-29T00:00:00Z",
  observedAt: "2026-11-05T16:00:00Z",
};
const horizon = dealWinCohortHorizon("30-days");

function report(subjects: CohortSubject[]): ObservedDealWinCohorts {
  const result = computeEqualAgeCohorts({
    source: {
      definitionId: "private-collector-definition",
      entryBasis: "observed-deal-insert",
      outcomeBasis: "qualified-win",
      completeness: "complete",
    },
    calendar: "persian",
    timeZone: "Asia/Tehran",
    observationCutoff: bounds.observedAt,
    horizon,
    subjects,
  });
  assert(result.state === "available");
  return {
    state: "available",
    baseline: "excluded",
    population: "current-authorized-live-deals",
    effectiveOwnerScope: "me",
    bucketMembership: "entries-within-covered-interval",
    coverage: {
      ...bounds,
      state: "partial",
      covered: {
        fromInclusive: bounds.activatedAt,
        to: bounds.observedAt,
        upperBound: "inclusive",
      },
    },
    result,
  };
}

test("publishes only the coverage, age horizon and counts needed to interpret cohort rates", () => {
  const safe = dealWinCohortView(report([entry]), "30-days");
  expect(safe).toEqual({
    state: "available",
    definition: "observed-deal-entry-to-win-v1",
    population: "current-authorized-live-deals",
    effectiveOwnerScope: "me",
    calendar: "persian",
    timeZone: "Asia/Tehran",
    observationCutoff: bounds.observedAt,
    horizonDays: 30,
    covered: {
      state: "partial",
      fromInclusive: bounds.activatedAt,
      to: bounds.observedAt,
      upperBound: "inclusive",
    },
    rows: [
      {
        calendarMonthStart: "2026-08-23",
        entered: 1,
        mature: 1,
        immature: 0,
        confirmedWins: 1,
        unknownOutcomes: 0,
        rate: { state: "available", wins: 1, mature: 1 },
      },
    ],
  });
  expect(JSON.stringify(safe)).not.toContain("private-");
});

test("keeps mature unknown and not-yet-mature populations separate without publishing a rate", () => {
  const safe = dealWinCohortView(
    report([
      entry,
      {
        ...entry,
        subjectId: "private-unknown",
        entryEventId: "private-unknown-entry",
        outcome: { kind: "unknown" },
      },
      {
        ...entry,
        subjectId: "private-immature",
        bucketId: "2026-10-23",
        entryEventId: "private-late-entry",
        enteredAt: "2026-10-28T12:00:00Z",
        outcome: { kind: "unknown" },
      },
    ]),
    "30-days",
  );
  assert(safe.state === "available");
  expect(safe.rows).toMatchObject([
    {
      entered: 2,
      mature: 2,
      confirmedWins: 1,
      unknownOutcomes: 1,
      rate: { state: "unavailable", reason: "mature-outcome-unknown" },
    },
    { entered: 1, immature: 1, rate: { state: "unavailable", reason: "no-mature-deals" } },
  ]);
});

test("hides evidence and reason details for restricted, damaged and over-limit populations", () => {
  for (const reason of [
    "not-authorized",
    "history-invalid",
    "history-limit",
    "history-permission-limited",
  ] as const) {
    expect(dealWinCohortView({ state: "unavailable", reason }, "30-days")).toEqual({
      state: "unavailable",
    });
  }
  expect(
    dealWinCohortView(
      { state: "unavailable", reason: "period-outside-capture", coverage: bounds },
      "30-days",
    ),
  ).toEqual({ state: "period-not-covered" });
  expect(dealWinCohortView(report([entry]), "60-days")).toEqual({ state: "unavailable" });
});
