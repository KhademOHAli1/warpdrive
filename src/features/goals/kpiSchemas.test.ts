import { describe, expect, it } from "vitest";
import { kpiConditionInput, kpiDefinitionInput, kpiGoalInput, kpiPeriodInput } from "./kpiSchemas";

const def = {
  name: "Win rate",
  description: "",
  source: "deals",
  calculation: "percentage",
  unit: "percent",
  dateField: "closed",
  filters: {},
  numeratorStatus: "won",
  denominatorStatus: "closed",
};
describe("KPI boundaries", () => {
  it("rejects an inverted range at the supported four-place precision", () => {
    expect(
      kpiConditionInput.safeParse({
        kind: "range",
        target: "99999999999999.9999",
        upperTarget: "99999999999999.9998",
      }).success,
    ).toBe(false);
    expect(
      kpiConditionInput.safeParse({
        kind: "range",
        target: "-99999999999999.9998",
        upperTarget: "-99999999999999.9999",
      }).success,
    ).toBe(false);
    expect(
      kpiConditionInput.safeParse({
        kind: "range",
        target: "99999999999999.9998",
        upperTarget: "99999999999999.9999",
      }).success,
    ).toBe(true);
  });
  it("accepts trustworthy CRM ratios and rejects numerator-only filters", () => {
    expect(kpiDefinitionInput.safeParse(def).success).toBe(true);
    expect(kpiDefinitionInput.safeParse({ ...def, filters: { status: "won" } }).success).toBe(
      false,
    );
  });
  it("rejects sources and fields that do not exist", () => {
    expect(kpiDefinitionInput.safeParse({ ...def, source: "projects" }).success).toBe(false);
    expect(
      kpiDefinitionInput.safeParse({ ...def, source: "activities", numeratorStatus: "won" })
        .success,
    ).toBe(false);
    expect(
      kpiDefinitionInput.safeParse({ ...def, calculation: "sum", valueField: "profit" }).success,
    ).toBe(false);
  });
  it("requires manual observation periods and provenance-compatible aggregates", () => {
    expect(
      kpiDefinitionInput.safeParse({
        ...def,
        source: "manual",
        dateField: "measured",
        calculation: "average",
      }).success,
    ).toBe(true);
    expect(kpiDefinitionInput.safeParse({ ...def, source: "manual" }).success).toBe(false);
  });
  it("accepts zero maximums and rejects linear pacing for them", () => {
    const goal = {
      definitionId: "00000000-0000-4000-8000-000000000001",
      scope: "company",
      scopeId: null,
      condition: { kind: "at_most", target: "0" },
      period: { kind: "calendar", interval: "monthly", startsOn: "2026-11-01" },
      pacing: "none",
    };
    expect(kpiGoalInput.safeParse(goal).success).toBe(true);
    expect(kpiGoalInput.safeParse({ ...goal, pacing: "linear" }).success).toBe(false);
  });
  it("requires one-off deadline and rolling-window bounds", () => {
    expect(
      kpiPeriodInput.safeParse({ kind: "one_off", interval: "monthly", startsOn: "2026-11-01" })
        .success,
    ).toBe(false);
    expect(
      kpiPeriodInput.safeParse({
        kind: "rolling",
        interval: "monthly",
        startsOn: "2026-11-01",
        rollingDays: 0,
      }).success,
    ).toBe(false);
  });
});
