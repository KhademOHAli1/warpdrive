import { describe, expect, test } from "vitest";
import {
  calculatePeriodForecast,
  type ForecastScenarioAssumptions,
  type ForecastTarget,
  MAX_PERIOD_FORECAST_DEALS,
  type PeriodForecastDeal,
  type PeriodForecastInput,
} from "./periodForecast";

const CUTOFF = "2026-03-28T22:00:00.000010Z";
// Berlin's 23-hour day at the spring DST transition, resolved upstream.
const TARGET: ForecastTarget = {
  from: "2026-03-28T23:00:00.000000Z",
  toExclusive: "2026-03-29T22:00:00.000000Z",
  timeZone: "Europe/Berlin",
  calendar: "gregory",
};

const WIN_EVIDENCE = {
  kind: "manual",
  sourceId: "win-assumptions",
  version: "2",
  observedAt: CUTOFF,
} as const;
const TIMING_EVIDENCE = {
  kind: "rule",
  sourceId: "period-timing-assumptions",
  version: "3.1",
  observedAt: "2026-03-28T22:00:00.000009Z",
} as const;
const SIZE_EVIDENCE = {
  kind: "manual",
  sourceId: "size-what-if",
  version: "1",
  observedAt: CUTOFF,
} as const;

type Open = Extract<PeriodForecastDeal, { status: "open" }>;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function factors(
  win: string | null,
  timing: string | null,
  size?: string,
): ForecastScenarioAssumptions {
  return {
    pWin: win === null ? null : { probability: win, evidence: WIN_EVIDENCE },
    pCloseInPeriodGivenWin:
      timing === null ? null : { probability: timing, target: TARGET, evidence: TIMING_EVIDENCE },
    ...(size === undefined
      ? {}
      : { sizeMultiplier: { multiplier: size, evidence: SIZE_EVIDENCE } }),
  };
}

function deal(n: number, assumptions = factors("0.5", "0.5"), changes: Partial<Open> = {}): Open {
  return {
    dealId: id(n),
    incarnationId: id(1_000 + n),
    status: "open",
    currency: "EUR",
    value: "100.0000",
    scenarios: { conservative: assumptions, base: assumptions, upside: assumptions },
    ...changes,
  };
}

function frame(deals: readonly PeriodForecastDeal[], changes: Partial<PeriodForecastInput> = {}) {
  return { currency: "EUR", target: TARGET, cutoffObservedAt: CUTOFF, deals, ...changes };
}

function available(input: PeriodForecastInput) {
  const result = calculatePeriodForecast(input);
  if (!result.ok) throw new Error(`Expected forecast output, got ${result.reason}`);
  return result;
}

describe("period forecast from explicit assumptions", () => {
  test("uses eventual win and conditional period close factors for open deals only", () => {
    const row = deal(1, factors("0.5", "0.25"), { value: "80.0000" });
    const won = {
      dealId: id(2),
      incarnationId: id(1_002),
      status: "won",
      currency: "EUR",
      value: "9000.0000",
    } as const;
    const lost = { ...won, dealId: id(3), incarnationId: id(1_003), status: "lost" } as const;
    const result = available(frame([won, row, lost]));
    expect(result).toMatchObject({
      definitionVersion: 1,
      basis: "explicit-assumptions",
      currency: "EUR",
      target: TARGET,
      cutoffObservedAt: CUTOFF,
      openDealCount: 1,
      closedDealCount: 2,
      recordedOpenValue: { knownTotal: "80.0000", knownDealCount: 1, missingDealCount: 0 },
    });
    expect(result.scenarios.base).toMatchObject({
      expectedWonCount: { knownTotal: "0.125", knownDealCount: 1, missingDealCount: 0 },
      expectedWonValue: { knownTotal: "10.0000", knownDealCount: 1, missingDealCount: 0 },
      contributors: [
        {
          dealId: row.dealId,
          incarnationId: row.incarnationId,
          recordedValue: "80.0000",
          assumptions: {
            pWin: { evidence: WIN_EVIDENCE },
            pCloseInPeriodGivenWin: { evidence: TIMING_EVIDENCE, target: TARGET },
          },
        },
      ],
    });
  });

  test("evaluates conversion, timing and size what-ifs on the same deal without changing its recorded value", () => {
    const row = deal(1, undefined, {
      value: "200.0000",
      scenarios: {
        conservative: factors("0.25", "0.2", "0.5"),
        base: factors("0.5", "0.5"),
        upside: factors("0.75", "0.8", "1.25"),
      },
    });
    const result = available(frame([row]));
    const scenarios = [
      result.scenarios.conservative,
      result.scenarios.base,
      result.scenarios.upside,
    ];
    expect(scenarios.map((item) => item.expectedWonCount.knownTotal)).toEqual([
      "0.05",
      "0.25",
      "0.6",
    ]);
    expect(scenarios.map((item) => item.expectedWonValue.knownTotal)).toEqual([
      "5.0000",
      "50.0000",
      "150.0000",
    ]);
    expect(result.recordedOpenValue.knownTotal).toBe("200.0000");
    expect(result.scenarios.upside.contributors[0]?.assumptions.sizeMultiplier).toEqual({
      multiplier: "1.25",
      evidence: SIZE_EVIDENCE,
    });
    expect(row.value).toBe("200.0000");
  });

  test.each(["USD", "EUR", "IRR"])(
    "retains exact large %s values beyond floating-point precision",
    (currency) => {
      const row = deal(1, factors("0.5", "0.5"), { currency, value: "99999999999999.1234" });
      const result = available(frame([row], { currency }));
      expect(result.recordedOpenValue.knownTotal).toBe("99999999999999.1234");
      expect(result.scenarios.base.expectedWonValue.knownTotal).toBe("24999999999999.78085");
    },
  );

  test("keeps tiny products exact and accumulates before any display rounding", () => {
    const a = factors("0.000001", "0.000001", "0.000001");
    const result = available(
      frame([deal(1, a, { value: "0.0001" }), deal(2, a, { value: "0.0001" })]),
    );
    expect(result.scenarios.base.contributors.map((row) => row.expectedWonValue)).toEqual([
      `0.${"0".repeat(21)}1`,
      `0.${"0".repeat(21)}1`,
    ]);
    expect(result.scenarios.base.expectedWonCount.knownTotal).toBe("0.000000000002");
    expect(result.scenarios.base.expectedWonValue.knownTotal).toBe(`0.${"0".repeat(21)}2`);
  });

  test("separates known zero, missing value, missing win evidence and missing timing evidence", () => {
    const result = available(
      frame([
        deal(1, factors("1", "1"), { value: null }),
        deal(2, factors("0", null), { value: "100.0000" }),
        deal(3, factors("0.5", "1"), { value: "0.0000" }),
        deal(4, factors(null, "0"), { value: "10.0000" }),
        deal(5, factors("0", "1"), { value: "80.0000" }),
      ]),
    );
    expect(result.recordedOpenValue).toEqual({
      knownTotal: "190.0000",
      knownDealCount: 4,
      missingDealCount: 1,
    });
    expect(result.scenarios.base).toMatchObject({
      expectedWonCount: { knownTotal: "1.5", knownDealCount: 3, missingDealCount: 2 },
      expectedWonValue: { knownTotal: "0.0000", knownDealCount: 2, missingDealCount: 3 },
      missingWinProbabilityCount: 1,
      missingTimingProbabilityCount: 1,
    });
    expect(
      result.scenarios.base.contributors.map((row) => [row.expectedWonCount, row.expectedWonValue]),
    ).toEqual([
      ["1", null],
      [null, null],
      ["0.5", "0.0000"],
      [null, null],
      ["0", "0.0000"],
    ]);
  });

  test("represents an empty eligible cohort as zero and an unresolved populated cohort as unknown", () => {
    const empty = available(frame([]));
    expect(empty.scenarios.base.expectedWonValue).toEqual({
      knownTotal: "0.0000",
      knownDealCount: 0,
      missingDealCount: 0,
    });
    expect(empty.scenarios.base.expectedWonCount.knownTotal).toBe("0");
    const unresolved = available(frame([deal(1, factors(null, null), { value: null })]));
    expect(unresolved.recordedOpenValue.knownTotal).toBeNull();
    expect(unresolved.scenarios.base.expectedWonValue).toEqual({
      knownTotal: null,
      knownDealCount: 0,
      missingDealCount: 1,
    });
    expect(unresolved.scenarios.base.expectedWonCount.knownTotal).toBeNull();
  });

  test("keeps a missing scenario unresolved and never infers timing from a recorded close date", () => {
    const outside = deal(1, undefined, {
      expectedCloseDate: "2026-04-15",
      scenarios: {
        conservative: factors("1", "0"),
        base: factors("1", null),
        upside: factors("1", "0.4"),
      },
    });
    const noDate = deal(2, factors("1", "0.5"), { expectedCloseDate: null });
    const result = available(frame([outside, noDate]));
    expect(result.scenarios.conservative.expectedWonValue.knownTotal).toBe("50.0000");
    expect(result.scenarios.base.expectedWonValue).toEqual({
      knownTotal: "50.0000",
      knownDealCount: 1,
      missingDealCount: 1,
    });
    expect(result.scenarios.base.contributors[0]).toMatchObject({
      recordedExpectedCloseDate: "2026-04-15",
      expectedWonValue: null,
    });
    expect(result.scenarios.base.contributors[1]).toMatchObject({
      recordedExpectedCloseDate: null,
      expectedWonValue: "50.0000",
    });
    expect(result.scenarios.upside.expectedWonValue.knownTotal).toBe("90.0000");
  });

  test.each([
    { toExclusive: "2026-03-29T22:00:00.000001Z" },
    { timeZone: "UTC" },
    { calendar: "persian" as const },
  ])("rejects timing estimates for a different resolved target %j", (changes) => {
    const changed = factors("0.5", null);
    changed.pCloseInPeriodGivenWin = {
      probability: "0.5",
      target: { ...TARGET, ...changes },
      evidence: TIMING_EVIDENCE,
    };
    expect(calculatePeriodForecast(frame([deal(1, changed)]))).toEqual({
      ok: false,
      reason: "timing-target-mismatch",
    });
  });

  test("rejects a version observed one microsecond after the forecast cutoff", () => {
    const future = factors("0.5", "0.5");
    future.pWin = {
      probability: "0.5",
      evidence: { ...WIN_EVIDENCE, observedAt: "2026-03-28T22:00:00.000011Z" },
    };
    expect(calculatePeriodForecast(frame([deal(1, future)]))).toEqual({
      ok: false,
      reason: "evidence-after-cutoff",
    });
  });

  test("requires zero or unknown timing when the half-open period has ended at the cutoff", () => {
    const changes = { cutoffObservedAt: TARGET.toExclusive };
    expect(calculatePeriodForecast(frame([deal(1, factors("1", "0.000001"))], changes))).toEqual({
      ok: false,
      reason: "timing-before-cutoff",
    });
    const zero = available(frame([deal(1, factors("1", "0"))], changes));
    expect(zero.scenarios.base.expectedWonValue.knownTotal).toBe("0.0000");
    const unknown = available(frame([deal(1, factors("1", null))], changes));
    expect(unknown.scenarios.base.expectedWonValue.knownTotal).toBeNull();
  });

  test.each(["-0.1", "1.000001", "0.1234567", "0.5e0", " 0.4"])(
    "rejects impossible or inexact factor %j",
    (factor) => {
      expect(calculatePeriodForecast(frame([deal(1, factors(factor, "1"))]))).toEqual({
        ok: false,
        reason: "invalid-deal",
      });
    },
  );

  test("rejects floating-point money, out-of-bound size and unversioned evidence", () => {
    const unversioned = factors("0.5", "0.5");
    unversioned.pWin = { probability: "0.5", evidence: { ...WIN_EVIDENCE, version: "" } };
    for (const row of [
      deal(1, undefined, { value: 0.1 as unknown as string }),
      deal(1, factors("1", "1", "10.000001")),
      deal(1, unversioned),
    ])
      expect(calculatePeriodForecast(frame([row]))).toEqual({ ok: false, reason: "invalid-deal" });
  });

  test("rejects mixed currencies, duplicate deal UUIDs and oversized input before calculating", () => {
    const row = deal(10);
    expect(calculatePeriodForecast(frame([row, deal(11, undefined, { currency: "USD" })]))).toEqual(
      {
        ok: false,
        reason: "mixed-currency",
      },
    );
    expect(
      calculatePeriodForecast(
        frame([row, { ...row, dealId: row.dealId.toUpperCase(), incarnationId: id(8_000) }]),
      ),
    ).toEqual({
      ok: false,
      reason: "duplicate-deal",
    });
    expect(calculatePeriodForecast(frame([row, { ...row, dealId: id(11) }]))).toEqual({
      ok: false,
      reason: "duplicate-deal",
    });
    expect(
      calculatePeriodForecast(
        frame(Array.from({ length: MAX_PERIOD_FORECAST_DEALS + 1 }, () => row)),
      ),
    ).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
  });

  test("rejects unsupported currency, reversed or empty intervals and invalid reporting zone", () => {
    for (const target of [
      { ...TARGET, from: TARGET.toExclusive },
      { ...TARGET, from: "2026-03-30T00:00:00.000000Z" },
      { ...TARGET, timeZone: "Invalid/Zone" },
    ])
      expect(calculatePeriodForecast(frame([], { target }))).toEqual({
        ok: false,
        reason: "invalid-input",
      });
    expect(calculatePeriodForecast(frame([], { currency: "ZZZ" }))).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });

  test("reconciles signed exact amounts and sorts contributors independently of input order", () => {
    const a = deal(1, factors("1", "1"), { value: "10.0001" });
    const b = deal(2, factors("1", "1"), { value: "-0.0001" });
    const result = available(frame([b, a]));
    expect(result).toEqual(available(frame([a, b])));
    expect(result.scenarios.base.contributors.map((row) => row.expectedWonValue)).toEqual([
      "10.0001",
      "-0.0001",
    ]);
    expect(result.scenarios.base.expectedWonValue.knownTotal).toBe("10.0000");
  });
});
