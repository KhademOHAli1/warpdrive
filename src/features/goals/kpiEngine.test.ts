import { describe, expect, it } from "vitest";
import { assessKpi, evaluateKpiRecords, type KpiRecord, kpiPeriodBounds } from "./kpiEngine";
import type { KpiDefinitionInput, KpiMeasurement } from "./kpiModel";

const bounds = { start: "2026-11-01", end: "2026-11-30" };
const definition: KpiDefinitionInput = {
  name: "Won value",
  description: "",
  source: "deals",
  calculation: "sum",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  valueField: "value",
  filters: { status: "won" },
};
const record = (id: string, value: string | null, status: "won" | "lost" = "won"): KpiRecord => ({
  id,
  label: id,
  href: null,
  value,
  statuses: [status, "closed"],
  currency: "EUR",
});
const measure = (value: string): KpiMeasurement => ({
  ...evaluateKpiRecords(definition, [record("1", value)], bounds, { on: "2026-11-05" }),
  value,
});

describe("KPI evaluation", () => {
  it("keeps a zero ceiling unassessed when an eligible event has no measurement date", () => {
    const unknown = { ...record("unknown-loss", null, "lost"), missingMeasurementDate: true };
    const result = evaluateKpiRecords(
      { ...definition, calculation: "count", unit: "count", filters: { status: "lost" } },
      [unknown],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result).toMatchObject({
      state: "incomplete",
      value: "0",
      recordCount: 0,
      excludedCount: 1,
    });
    expect(result.issues).toContain("missing_measurement_dates");
    expect(result.contributors[0]).toMatchObject({
      included: false,
      reason: "missing_measurement_date",
      observedOn: null,
    });
    expect(assessKpi({ kind: "at_most", target: "0" }, result, "none", "2026-11-05").standing).toBe(
      "unavailable",
    );
  });
  it("retains exact four-place money arithmetic beyond floating point precision", () => {
    const result = evaluateKpiRecords(
      definition,
      [record("1", "99999999999999.9999"), record("2", "0.0001")],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result.value).toBe("100000000000000");
  });
  it("marks missing values incomplete and exposes excluded records", () => {
    const result = evaluateKpiRecords(
      definition,
      [record("1", "20"), record("2", null), record("3", "5", "lost")],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result.state).toBe("incomplete");
    expect(result.value).toBe("20");
    expect(result.excludedCount).toBe(2);
    expect(result.contributors[1]?.reason).toBe("missing_value");
  });
  it("does not combine currencies", () => {
    const result = evaluateKpiRecords(
      definition,
      [record("1", "20"), { ...record("2", "50"), currency: "USD" }],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result.value).toBe("20");
    expect(result.contributors[1]?.reason).toBe("different_currency");
  });
  it("distinguishes an empty count from an undefined ratio", () => {
    const ratio = {
      ...definition,
      calculation: "percentage" as const,
      unit: "percent" as const,
      filters: {},
      numeratorStatus: "won" as const,
      denominatorStatus: "closed" as const,
    };
    expect(evaluateKpiRecords(ratio, [], bounds, { on: "2026-11-05" })).toMatchObject({
      state: "unavailable",
      value: null,
      denominator: 0,
    });
    expect(
      evaluateKpiRecords({ ...definition, calculation: "count", unit: "count" }, [], bounds, {
        on: "2026-11-05",
      }),
    ).toMatchObject({ state: "available", value: "0" });
  });
  it("uses closed deals as the denominator, including losses", () => {
    const result = evaluateKpiRecords(
      {
        ...definition,
        calculation: "percentage",
        unit: "percent",
        filters: {},
        numeratorStatus: "won",
        denominatorStatus: "closed",
      },
      [record("1", "20"), record("2", "5", "lost")],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result).toMatchObject({ value: "50", numerator: 1, denominator: 2 });
  });
  it("calculates disjoint ratio populations independently while keeping their union traceable", () => {
    const result = evaluateKpiRecords(
      {
        ...definition,
        calculation: "ratio",
        unit: "custom",
        customUnit: "wins per loss",
        filters: {},
        numeratorStatus: "won",
        denominatorStatus: "lost",
      },
      [
        record("win1", "10"),
        record("win2", "30"),
        record("loss", "5", "lost"),
        { id: "open", label: "open", value: "8", href: null, statuses: ["open"] },
      ],
      bounds,
      { on: "2026-11-05" },
    );
    expect(result).toMatchObject({
      state: "available",
      value: "2",
      numerator: 2,
      denominator: 1,
      recordCount: 3,
      excludedCount: 1,
    });
    expect(result.contributors[0]).toMatchObject({
      included: true,
      numeratorMember: true,
      denominatorMember: false,
      value: "1",
    });
    expect(result.contributors[2]).toMatchObject({
      included: true,
      numeratorMember: false,
      denominatorMember: true,
      value: "1",
    });
    expect(result.contributors[3]).toMatchObject({
      included: false,
      reason: "outside_ratio_population",
    });
  });
  it("calculates median and marks bounded scans incomplete", () => {
    const result = evaluateKpiRecords(
      { ...definition, calculation: "median" },
      [record("1", "100"), record("2", "10"), record("3", "20"), record("4", "30")],
      bounds,
      { on: "2026-11-05", truncated: true },
    );
    expect(result.value).toBe("25");
    expect(result.state).toBe("incomplete");
  });
  it("shows manual staleness and sample size without inventing freshness", () => {
    const result = evaluateKpiRecords(
      { ...definition, source: "manual", calculation: "average", dateField: "measured" },
      [{ ...record("1", "90"), measuredOn: "2026-11-01", sampleSize: 2 }],
      bounds,
      { on: "2026-11-12" },
    );
    expect(result).toMatchObject({ state: "stale", sampleSize: 2, value: "90" });
  });
});
describe("KPI success conditions", () => {
  it("compares supported precise decimal targets without floating-point rounding", () => {
    expect(
      assessKpi(
        { kind: "at_least", target: "99999999999999.0002" },
        measure("99999999999999.0001"),
        "none",
        "2026-11-05",
      ).standing,
    ).toBe("not_met");
  });
  it("does not reward excess losses", () => {
    expect(
      assessKpi({ kind: "at_most", target: "5" }, measure("10"), "none", "2026-11-05"),
    ).toMatchObject({ standing: "not_met", attainment: 0.5, pace: null });
  });
  it("supports zero guardrails without division by zero", () => {
    expect(
      assessKpi({ kind: "at_most", target: "0" }, measure("0"), "none", "2026-11-05"),
    ).toMatchObject({ standing: "met", attainment: 1 });
    expect(
      assessKpi({ kind: "at_most", target: "0" }, measure("1"), "none", "2026-11-05"),
    ).toMatchObject({ standing: "not_met", attainment: 0 });
  });
  it("judges ranges, baseline improvements and one-off deadlines", () => {
    expect(
      assessKpi(
        { kind: "range", target: "60", upperTarget: "80" },
        measure("70"),
        "none",
        "2026-11-05",
      ).standing,
    ).toBe("met");
    expect(
      assessKpi(
        { kind: "improve", target: "5", baseline: "20", direction: "decrease" },
        measure("14"),
        "none",
        "2026-11-05",
      ).standing,
    ).toBe("met");
    expect(
      assessKpi({ kind: "deadline", target: "100" }, measure("70"), "none", "2026-11-05").standing,
    ).toBe("in_progress");
  });
  it("does not award a definitive status to incomplete data", () => {
    expect(
      assessKpi(
        { kind: "at_least", target: "1" },
        { ...measure("5"), state: "incomplete" },
        "linear",
        "2026-11-05",
      ),
    ).toMatchObject({ standing: "unavailable", attainment: null, pace: null });
  });
});
describe("KPI periods", () => {
  it("supports rolling windows clipped at activation", () => {
    expect(
      kpiPeriodBounds(
        { kind: "rolling", interval: "monthly", startsOn: "2026-11-01", rollingDays: 7 },
        "2026-11-05",
      ),
    ).toEqual({ start: "2026-11-01", end: "2026-11-05" });
  });
  it("uses fiscal quarter boundaries and clips one-off periods", () => {
    expect(
      kpiPeriodBounds(
        { kind: "calendar", interval: "quarterly", startsOn: "2026-01-01", fiscalStartMonth: 2 },
        "2026-11-05",
      ),
    ).toEqual({ start: "2026-11-01", end: "2027-01-31" });
    expect(
      kpiPeriodBounds(
        { kind: "one_off", interval: "monthly", startsOn: "2026-11-01", endsOn: "2026-11-15" },
        "2026-11-16",
      ),
    ).toBeNull();
  });
});
