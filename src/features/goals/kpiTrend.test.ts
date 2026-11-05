import { describe, expect, it } from "vitest";
import type { KpiRecord } from "./kpiEngine";
import type { KpiDefinitionInput } from "./kpiModel";
import { kpiTrend } from "./kpiTrend";

const bounds = { start: "2026-11-01", end: "2026-11-30" };
const definition: KpiDefinitionInput = {
  name: "Won deal value",
  description: "",
  source: "deals",
  calculation: "sum",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  valueField: "value",
  filters: { status: "won" },
};

function record(id: string, observedOn?: string, value = "10"): KpiRecord {
  return {
    id,
    label: id,
    href: null,
    value,
    currency: "EUR",
    statuses: ["won", "closed"],
    observedOn,
  };
}

describe("cumulative KPI trends", () => {
  it("preserves exact money and the same status and currency exclusions as the result", () => {
    const result = kpiTrend(
      definition,
      [
        record("first", "2026-11-01", "0.1001"),
        record("second", "2026-11-03", "0.2002"),
        { ...record("lost", "2026-11-02", "100"), statuses: ["lost", "closed"] },
        { ...record("usd", "2026-11-02", "100"), currency: "USD" },
      ],
      bounds,
      "2026-11-03",
    );
    expect(result).toEqual([
      { day: "2026-11-01", value: "0.1001" },
      { day: "2026-11-02", value: "0.1001" },
      { day: "2026-11-03", value: "0.3003" },
    ]);
  });

  it("does not backfill unknown dates or include records outside the elapsed period", () => {
    const result = kpiTrend(
      definition,
      [
        record("unknown"),
        record("invalid", "2026-11-31"),
        record("previous", "2026-10-31"),
        record("future", "2026-11-04"),
        record("today", "2026-11-03", "7"),
      ],
      bounds,
      "2026-11-03",
    );
    expect(result.map((point) => point.value)).toEqual(["0", "0", "7"]);
    expect(result.at(-1)?.day).toBe("2026-11-03");
  });

  it("uses measurement dates for manual observations and averages cumulatively", () => {
    const result = kpiTrend(
      { ...definition, source: "manual", calculation: "average", dateField: "measured" },
      [
        { ...record("one", undefined, "2"), measuredOn: "2026-11-02" },
        { ...record("two", undefined, "4"), measuredOn: "2026-11-03" },
      ],
      bounds,
      "2026-11-03",
    );
    expect(result.map((point) => point.value)).toEqual([null, "2", "3"]);
  });

  it("retains unavailable ratio gaps rather than showing zero before a denominator exists", () => {
    const result = kpiTrend(
      {
        ...definition,
        calculation: "percentage",
        unit: "percent",
        filters: {},
        numeratorStatus: "won",
        denominatorStatus: "closed",
      },
      [
        record("won", "2026-11-02"),
        { ...record("lost", "2026-11-03"), statuses: ["lost", "closed"] },
      ],
      bounds,
      "2026-11-03",
    );
    expect(result.map((point) => point.value)).toEqual([null, "100", "50"]);
  });

  it("shows an empty count as zero and respects a completed period's end", () => {
    const result = kpiTrend(
      { ...definition, calculation: "count", unit: "count" },
      [],
      { start: "2026-11-01", end: "2026-11-02" },
      "2026-11-10",
    );
    expect(result).toEqual([
      { day: "2026-11-01", value: "0" },
      { day: "2026-11-02", value: "0" },
    ]);
  });

  it("bounds long trends to 60 unique ordered dates and includes both elapsed endpoints", () => {
    const result = kpiTrend(
      definition,
      [],
      { start: "2026-01-01", end: "2026-12-31" },
      "2026-11-05",
    );
    expect(result).toHaveLength(60);
    expect(result[0]?.day).toBe("2026-01-01");
    expect(result.at(-1)?.day).toBe("2026-11-05");
    expect(new Set(result.map((point) => point.day)).size).toBe(60);
    expect(result.map((point) => point.day)).toEqual(result.map((point) => point.day).sort());
  });

  it("has no points before activation or for an invalid interval", () => {
    expect(kpiTrend(definition, [], bounds, "2026-10-31")).toEqual([]);
    expect(
      kpiTrend(definition, [], { start: "2026-11-03", end: "2026-11-01" }, "2026-11-05"),
    ).toEqual([]);
    expect(kpiTrend(definition, [], bounds, "invalid")).toEqual([]);
  });
});
