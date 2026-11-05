import { describe, expect, test } from "vitest";
import {
  ANALYTICS_METRIC_DICTIONARY_VERSION,
  DEAL_RECORD_METRIC_DICTIONARY,
  DEAL_RECORD_METRICS,
  DEAL_REPORT_POLICY,
  EXISTING_REPORT_METRIC_DICTIONARY,
  GOALS_ANALYTICS_BOUNDARY,
  getDealRecordMetricDefinition,
} from "./metricDictionary";

describe("analytics metric contract", () => {
  test("gives every record population a versioned, serializable explanation", () => {
    expect(ANALYTICS_METRIC_DICTIONARY_VERSION).toBe(1);
    expect(new Set(DEAL_RECORD_METRICS).size).toBe(DEAL_RECORD_METRICS.length);
    for (const metric of DEAL_RECORD_METRICS) {
      const definition = getDealRecordMetricDefinition(metric);
      expect(definition.id).toBe(metric);
      expect(definition.formula.length).toBeGreaterThan(0);
      expect(definition.numerator.length).toBeGreaterThan(0);
      expect(definition.eligibleRecords.length).toBeGreaterThan(0);
      expect(definition.units.length).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    }
  });

  test("keeps current inventory independent from period outcomes and created cohorts", () => {
    expect(DEAL_RECORD_METRIC_DICTIONARY.open).toMatchObject({
      basis: "current-inventory",
      dateColumn: null,
      dateWindowApplied: false,
      currentStatus: ["open"],
    });
    expect(DEAL_RECORD_METRIC_DICTIONARY.added).toMatchObject({
      basis: "created-date-cohort",
      dateColumn: "created_at",
      currentStatus: ["open", "won", "lost"],
    });
    expect(DEAL_RECORD_METRIC_DICTIONARY.won.dateColumn).toBe("won_time");
    expect(DEAL_RECORD_METRIC_DICTIONARY.lost.dateColumn).toBe("lost_time");
  });

  test("defines win-rate numerator and denominator without open deals", () => {
    const closed = DEAL_RECORD_METRIC_DICTIONARY.closed;
    expect(closed.currentStatus).toEqual(["won", "lost"]);
    expect(closed.dateColumn).toBe("won_time-or-lost_time");
    expect(closed.denominator).toContain("open deals are excluded");
    expect(closed.zeroOrMissing).toContain("unavailable rate (null)");
  });

  test("does not use all wins as the deal-size or valid-cycle sample", () => {
    const values = DEAL_RECORD_METRIC_DICTIONARY.wonValue;
    const cycles = DEAL_RECORD_METRIC_DICTIONARY.wonCycle;
    expect(values.valueRequired).toBe(true);
    expect(values.nonnegativeWonCycleRequired).toBe(false);
    expect(values.eligibleRecords).toContain("zero remains eligible");
    expect(cycles.valueRequired).toBe(false);
    expect(cycles.nonnegativeWonCycleRequired).toBe(true);
    expect(cycles.eligibleRecords).toContain("won_time >= created_at");
    expect(cycles.eligibleRecords).toContain("Null deal value remains eligible");
    expect(cycles.zeroOrMissing).toContain("not survival analysis");
  });

  test("retains current-state, access, currency and explicit-timezone policies", () => {
    expect(DEAL_REPORT_POLICY.restatement).toContain("Reopenings");
    expect(DEAL_REPORT_POLICY.restatement).toContain("not immutable event history");
    expect(DEAL_REPORT_POLICY.ownerBasis).toContain("Current deal owner");
    expect(DEAL_REPORT_POLICY.visibility).toContain("every read");
    expect(DEAL_REPORT_POLICY.currency).toContain("before counting or summing");
    expect(DEAL_REPORT_POLICY.currency).toContain("no FX conversion");
    expect(DEAL_REPORT_POLICY.timeZone).toContain("viewer's time zone on the server");
    expect(DEAL_REPORT_POLICY.timeZone).toContain("without a time zone use UTC");
    expect(DEAL_REPORT_POLICY.calendar).toContain("Gregorian months");
    expect(DEAL_REPORT_POLICY.legacyTimeZone).toContain("not assumed equivalent");
  });

  test("does not describe legacy inference or mixed open ages as qualified stage evidence", () => {
    expect(EXISTING_REPORT_METRIC_DICTIONARY.funnelReached.limitation).toContain(
      "inferred, not proof of observed entry",
    );
    expect(EXISTING_REPORT_METRIC_DICTIONARY.funnelConversion.limitation).toContain(
      "without a business-stage mapping",
    );
    expect(EXISTING_REPORT_METRIC_DICTIONARY.legacyStageDuration.limitation).toContain(
      "open age and completed duration are mixed",
    );
    expect(EXISTING_REPORT_METRIC_DICTIONARY.scheduledActivities.limitation).toContain(
      "not a completion rate",
    );
  });

  test("keeps Goals authoring external and missing targets explicit", () => {
    expect(GOALS_ANALYTICS_BOUNDARY.authoringOwner).toBe("Settings → Goals");
    expect(GOALS_ANALYTICS_BOUNDARY.analyticsRole).toContain("read-only adapter");
    expect(GOALS_ANALYTICS_BOUNDARY.scope).toContain("own dates");
    expect(GOALS_ANALYTICS_BOUNDARY.missing).toContain("not replaced with invented targets");
  });
});
