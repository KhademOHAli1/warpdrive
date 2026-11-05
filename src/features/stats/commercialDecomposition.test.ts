import { describe, expect, test } from "vitest";
import { decomposeCommercialChange } from "./commercialDecomposition";

const definition = {
  scope: "sales-east-eur-v1",
  cohortRule: "observed-entry-to-first-win-v1",
  segmentation: "industry-at-entry-v1",
  timeZone: "Europe/Berlin",
  calendar: "gregory",
  horizonDays: 30,
  currency: "EUR",
};
const baseline = {
  from: "2026-01-01T00:00:00.000000Z",
  toExclusive: "2026-02-01T00:00:00.000000Z",
  settledThrough: "2026-03-03T00:00:00.000000Z",
};
const comparison = {
  from: "2026-02-01T00:00:00.000000Z",
  toExclusive: "2026-03-01T00:00:00.000000Z",
  settledThrough: "2026-03-31T00:00:00.000000Z",
};

function row(key: string, eligible: number, wins: number, wonValue: string) {
  return { key, eligible, wins, knownWonValues: wins, wonValue };
}

function facts(
  segments: ReturnType<typeof row>[],
  eligible: number,
  wins: number,
  wonValue: string,
) {
  return {
    definition,
    completeness: "complete",
    expectedSegmentCount: segments.length,
    eligible,
    wins,
    wonValue,
    segments,
  };
}

const integer = (numerator: number) => ({ numerator: String(numerator), denominator: "1" });

const pair = {
  baseline: {
    ...baseline,
    ...facts([row("A", 40, 20, "100.0000"), row("B", 60, 15, "300.0000")], 100, 35, "400.0000"),
  },
  comparison: {
    ...comparison,
    ...facts([row("B", 60, 12, "300.0000"), row("A", 60, 45, "270.0000")], 120, 57, "570.0000"),
  },
};

describe("commercial cohort change bridge", () => {
  test("isolates the declared ordered effects and reconciles 400 to 570", () => {
    // Replacing N, then mix, then rates, then sizes gives 400 → 480 → 450 → 465 → 570.
    expect(decomposeCommercialChange(pair)).toMatchObject({
      state: "available",
      order: ["volume", "segment-mix", "conversion", "size"],
      support: "complete",
      baselineWonValue: integer(4_000_000),
      comparisonWonValue: integer(5_700_000),
      change: integer(1_700_000),
      effects: {
        volume: integer(800_000),
        segmentMix: integer(-300_000),
        conversion: integer(150_000),
        size: integer(1_050_000),
        unsupportedChange: integer(0),
      },
    });
  });

  test("keeps exact fractional units when offsetting effects cancel", () => {
    expect(
      decomposeCommercialChange({
        baseline: { ...baseline, ...facts([row("A", 3, 1, "1.0000")], 3, 1, "1.0000") },
        comparison: { ...comparison, ...facts([row("A", 1, 1, "1.0000")], 1, 1, "1.0000") },
      }),
    ).toMatchObject({
      state: "available",
      change: integer(0),
      effects: {
        volume: { numerator: "-20000", denominator: "3" },
        segmentMix: integer(0),
        conversion: { numerator: "20000", denominator: "3" },
        size: integer(0),
      },
    });
  });

  test("attributes only the mix when volume, conversion and size stay fixed", () => {
    expect(
      decomposeCommercialChange({
        baseline: {
          ...baseline,
          ...facts([row("A", 4, 2, "20.0000"), row("B", 2, 2, "40.0000")], 6, 4, "60.0000"),
        },
        comparison: {
          ...comparison,
          ...facts([row("A", 2, 1, "10.0000"), row("B", 4, 4, "80.0000")], 6, 5, "90.0000"),
        },
      }),
    ).toMatchObject({
      state: "available",
      effects: {
        volume: integer(0),
        segmentMix: integer(300_000),
        conversion: integer(0),
        size: integer(0),
        unsupportedChange: integer(0),
      },
    });
  });

  test("keeps a first observed win from a genuine zero baseline in unsupported change", () => {
    const empty = facts([], 0, 0, "0.0000");
    const one = facts([row("A", 3, 1, "7.3001")], 3, 1, "7.3001");
    expect(
      decomposeCommercialChange({
        baseline: { ...baseline, ...empty },
        comparison: { ...comparison, ...one },
      }),
    ).toMatchObject({
      state: "available",
      support: "none",
      commonSegments: 0,
      unsupportedSegments: 1,
      effects: {
        volume: integer(0),
        segmentMix: integer(0),
        conversion: integer(0),
        size: integer(0),
        unsupportedChange: integer(73_001),
      },
    });
  });

  test("keeps a missing segment's change separate from the shared-cohort effects", () => {
    expect(
      decomposeCommercialChange({
        baseline: {
          ...baseline,
          ...facts([row("A", 2, 1, "10.0000"), row("B", 1, 1, "3.0000")], 3, 2, "13.0000"),
        },
        comparison: {
          ...comparison,
          ...facts([row("A", 2, 1, "10.0000"), row("C", 1, 1, "7.0000")], 3, 2, "17.0000"),
        },
      }),
    ).toMatchObject({
      state: "available",
      support: "partial",
      commonSegments: 1,
      unsupportedSegments: 2,
      effects: {
        volume: integer(0),
        segmentMix: integer(0),
        conversion: integer(0),
        size: integer(0),
        unsupportedChange: integer(40_000),
      },
    });
  });

  test("refuses unsettled, mismatched, overlapping and incomplete observations", () => {
    const refusal = (overrides: object, reason: string) => {
      expect(
        decomposeCommercialChange({ ...pair, comparison: { ...pair.comparison, ...overrides } }),
      ).toEqual({ state: "unavailable", reason });
    };
    refusal({ settledThrough: "2026-03-30T23:59:59.999999Z" }, "unsettled-period");
    refusal({ definition: { ...definition, currency: "USD" } }, "noncomparable-periods");
    refusal({ from: "2026-01-31T23:59:59.999999Z" }, "noncomparable-periods");
    refusal({ completeness: "incomplete" }, "incomplete-population");
  });

  test("refuses missing money, duplicate segments and totals that do not reconcile", () => {
    const segments = pair.comparison.segments;
    for (const overrides of [
      { segments: [{ ...segments[0], knownWonValues: 11 }, segments[1]] },
      { segments: [segments[0], segments[0]] },
      { eligible: 119 },
      { wonValue: "569.9999" },
    ]) {
      expect(
        decomposeCommercialChange({ ...pair, comparison: { ...pair.comparison, ...overrides } }),
      ).toEqual({ state: "unavailable", reason: "inconsistent-segments" });
    }
  });
});
