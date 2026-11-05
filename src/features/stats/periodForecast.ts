import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";

export const PERIOD_FORECAST_DEFINITION_VERSION = 1;
export const MAX_PERIOD_FORECAST_DEALS = 5_000;
export const PERIOD_FORECAST_SCENARIOS = ["conservative", "base", "upside"] as const;

type Scenario = (typeof PERIOD_FORECAST_SCENARIOS)[number];
const MONEY_PLACES = 4;
const FACTOR_PLACES = 6;
const ONE_FACTOR = 1_000_000n;
const COUNT_PLACES = FACTOR_PLACES * 2;
const VALUE_PLACES = MONEY_PLACES + FACTOR_PLACES * 3;

const uuid = z.guid().transform((id) => id.toLowerCase());
// Fixed UTC precision makes comparison exact without passing timestamps through JS Date.
const instant = z.string().datetime({ precision: 6 });
const targetSchema = z.strictObject({
  from: instant,
  toExclusive: instant,
  timeZone: z.string().min(1).max(100),
  calendar: z.enum(["gregory", "persian"]),
});

const reference = z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/);
const evidenceSchema = z.strictObject({
  kind: z.enum(["manual", "rule", "model"]),
  sourceId: reference,
  version: reference,
  observedAt: instant,
});

const probability = z.string().regex(/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/);
const probabilitySchema = z.strictObject({ probability, evidence: evidenceSchema });
const timingSchema = probabilitySchema.extend({ target: targetSchema });
const sizeSchema = z.strictObject({
  // Version 1 permits a size assumption from zero to ten times the observed deal value.
  multiplier: z.string().regex(/^(?:[0-9](?:\.\d{1,6})?|10(?:\.0{1,6})?)$/),
  evidence: evidenceSchema,
});

const scenarioSchema = z.strictObject({
  pWin: probabilitySchema.nullable(),
  pCloseInPeriodGivenWin: timingSchema.nullable(),
  sizeMultiplier: sizeSchema.optional(),
});
const scenarioSetSchema = z.strictObject({
  conservative: scenarioSchema,
  base: scenarioSchema,
  upside: scenarioSchema,
});

const dealFields = {
  dealId: uuid,
  incarnationId: uuid,
  currency: z.string().regex(/^[A-Z]{3}$/),
  value: z
    .string()
    .regex(/^-?\d{1,14}(?:\.\d{1,4})?$/)
    .nullable(),
  expectedCloseDate: z.string().date().nullable().optional(),
};
const openDealSchema = z.strictObject({
  ...dealFields,
  status: z.literal("open"),
  scenarios: scenarioSetSchema,
});
const dealSchema = z.discriminatedUnion("status", [
  openDealSchema,
  z.strictObject({ ...dealFields, status: z.enum(["won", "lost"]) }),
]);

const frameSchema = z.strictObject({
  currency: currencyCode,
  target: targetSchema,
  cutoffObservedAt: instant,
  deals: z.custom<readonly unknown[]>(Array.isArray),
});

export type PeriodForecastDeal = z.input<typeof dealSchema>;
export type ForecastTarget = z.output<typeof targetSchema>;
export type ForecastScenarioAssumptions = z.input<typeof scenarioSchema>;
export type PeriodForecastInput = Omit<z.input<typeof frameSchema>, "deals"> & {
  deals: readonly PeriodForecastDeal[];
};

type Frame = z.output<typeof frameSchema>;
type OpenDeal = z.output<typeof openDealSchema>;
type ScenarioAssumptions = z.output<typeof scenarioSchema>;

interface ForecastMeasure {
  // Null means there were eligible deals but no known contribution for this measure.
  knownTotal: string | null;
  knownDealCount: number;
  missingDealCount: number;
}

interface ScenarioContributor {
  dealId: string;
  incarnationId: string;
  recordedValue: string | null;
  recordedExpectedCloseDate: string | null;
  assumptions: ScenarioAssumptions;
  expectedWonCount: string | null;
  expectedWonValue: string | null;
}

interface ScenarioForecast {
  expectedWonCount: ForecastMeasure;
  expectedWonValue: ForecastMeasure;
  missingWinProbabilityCount: number;
  missingTimingProbabilityCount: number;
  contributors: ScenarioContributor[];
}

type Failure = {
  ok: false;
  reason:
    | "invalid-input"
    | "bounded-limit"
    | "invalid-deal"
    | "mixed-currency"
    | "duplicate-deal"
    | "timing-target-mismatch"
    | "timing-before-cutoff"
    | "evidence-after-cutoff";
};

export type PeriodForecastResult =
  | Failure
  | {
      ok: true;
      definitionVersion: typeof PERIOD_FORECAST_DEFINITION_VERSION;
      basis: "explicit-assumptions";
      currency: string;
      target: ForecastTarget;
      cutoffObservedAt: string;
      openDealCount: number;
      closedDealCount: number;
      recordedOpenValue: ForecastMeasure;
      scenarios: Record<Scenario, ScenarioForecast>;
    };

function decimalUnits(value: string, places: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(places, "0")}`);
}

function decimalText(units: bigint, places: number, minimumFraction = 0): string {
  const absolute = units < 0n ? -units : units;
  const digits = absolute.toString().padStart(places + 1, "0");
  const fraction = digits.slice(-places).replace(/0+$/, "").padEnd(minimumFraction, "0");
  return `${units < 0n ? "-" : ""}${digits.slice(0, -places)}${fraction === "" ? "" : `.${fraction}`}`;
}

function measure(
  total: bigint,
  knownDealCount: number,
  openDealCount: number,
  places: number,
  minimumFraction = 0,
): ForecastMeasure {
  return {
    knownTotal:
      knownDealCount === 0 && openDealCount > 0
        ? null
        : decimalText(total, places, minimumFraction),
    knownDealCount,
    missingDealCount: openDealCount - knownDealCount,
  };
}

function prepareDeals(
  frame: Frame,
): Failure | { ok: true; open: OpenDeal[]; closedDealCount: number } {
  const seenDeals = new Set<string>();
  const seenIncarnations = new Set<string>();
  const open: OpenDeal[] = [];
  for (const raw of frame.deals) {
    const parsed = dealSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid-deal" };
    const deal = parsed.data;
    if (deal.currency !== frame.currency) return { ok: false, reason: "mixed-currency" };
    if (seenDeals.has(deal.dealId) || seenIncarnations.has(deal.incarnationId))
      return { ok: false, reason: "duplicate-deal" };
    seenDeals.add(deal.dealId);
    seenIncarnations.add(deal.incarnationId);
    if (deal.status === "open") open.push(deal);
  }
  open.sort((left, right) => {
    if (left.dealId < right.dealId) return -1;
    if (left.dealId > right.dealId) return 1;
    return 0;
  });
  return { ok: true, open, closedDealCount: frame.deals.length - open.length };
}

function sameTarget(left: ForecastTarget, right: ForecastTarget): boolean {
  return (
    left.from === right.from &&
    left.toExclusive === right.toExclusive &&
    left.timeZone === right.timeZone &&
    left.calendar === right.calendar
  );
}

function verifyAssumptions(frame: Frame, assumptions: ScenarioAssumptions): Failure | null {
  const { pWin, pCloseInPeriodGivenWin, sizeMultiplier } = assumptions;
  if (pCloseInPeriodGivenWin !== null) {
    if (!sameTarget(frame.target, pCloseInPeriodGivenWin.target))
      return { ok: false, reason: "timing-target-mismatch" };
    if (
      frame.target.toExclusive <= frame.cutoffObservedAt &&
      decimalUnits(pCloseInPeriodGivenWin.probability, FACTOR_PLACES) > 0n
    )
      return { ok: false, reason: "timing-before-cutoff" };
  }
  const estimates = [pWin, pCloseInPeriodGivenWin, sizeMultiplier];
  if (
    estimates.some(
      (estimate) =>
        estimate !== null &&
        estimate !== undefined &&
        estimate.evidence.observedAt > frame.cutoffObservedAt,
    )
  )
    return { ok: false, reason: "evidence-after-cutoff" };
  return null;
}

function contributionUnits(value: string | null, assumptions: ScenarioAssumptions) {
  const { pWin, pCloseInPeriodGivenWin, sizeMultiplier } = assumptions;
  // Require both factors even if one is zero. An absent estimate stays visible as a gap.
  if (pWin === null || pCloseInPeriodGivenWin === null) return { count: null, value: null };
  const count =
    decimalUnits(pWin.probability, FACTOR_PLACES) *
    decimalUnits(pCloseInPeriodGivenWin.probability, FACTOR_PLACES);
  if (value === null) return { count, value: null };
  const size =
    sizeMultiplier === undefined
      ? ONE_FACTOR
      : decimalUnits(sizeMultiplier.multiplier, FACTOR_PLACES);
  return { count, value: count * size * decimalUnits(value, MONEY_PLACES) };
}

function scenarioForecast(
  frame: Frame,
  openDeals: readonly OpenDeal[],
  scenario: Scenario,
): Failure | { ok: true; forecast: ScenarioForecast } {
  const contributors: ScenarioContributor[] = [];
  let countTotal = 0n;
  let valueTotal = 0n;
  let knownCount = 0;
  let knownValue = 0;
  let missingWin = 0;
  let missingTiming = 0;
  for (const deal of openDeals) {
    const assumptions = deal.scenarios[scenario];
    const failure = verifyAssumptions(frame, assumptions);
    if (failure !== null) return failure;
    if (assumptions.pWin === null) missingWin += 1;
    if (assumptions.pCloseInPeriodGivenWin === null) missingTiming += 1;
    const units = contributionUnits(deal.value, assumptions);
    if (units.count !== null) {
      countTotal += units.count;
      knownCount += 1;
    }
    if (units.value !== null) {
      valueTotal += units.value;
      knownValue += 1;
    }
    contributors.push({
      dealId: deal.dealId,
      incarnationId: deal.incarnationId,
      recordedValue: deal.value,
      recordedExpectedCloseDate: deal.expectedCloseDate ?? null,
      assumptions,
      expectedWonCount: units.count === null ? null : decimalText(units.count, COUNT_PLACES),
      expectedWonValue:
        units.value === null ? null : decimalText(units.value, VALUE_PLACES, MONEY_PLACES),
    });
  }
  return {
    ok: true,
    forecast: {
      expectedWonCount: measure(countTotal, knownCount, openDeals.length, COUNT_PLACES),
      expectedWonValue: measure(
        valueTotal,
        knownValue,
        openDeals.length,
        VALUE_PLACES,
        MONEY_PLACES,
      ),
      missingWinProbabilityCount: missingWin,
      missingTimingProbabilityCount: missingTiming,
      contributors,
    },
  };
}

function recordedOpenValue(openDeals: readonly OpenDeal[]): ForecastMeasure {
  let total = 0n;
  let known = 0;
  for (const deal of openDeals) {
    if (deal.value === null) continue;
    total += decimalUnits(deal.value, MONEY_PLACES);
    known += 1;
  }
  return measure(total, known, openDeals.length, MONEY_PLACES, MONEY_PLACES);
}

/**
 * The caller proves complete authorized membership at the cutoff and resolves the half-open
 * target instants. Both factors must use the same win definition and forecast cutoff:
 * pWin means eventual win from that cutoff, and timing is conditional on that win.
 * Evidence vintage alone does not prove that compatibility or qualify a statistical model.
 * Recorded close dates are evidence for the caller, and never set a factor here.
 * Scenarios are explicit what-ifs over the same cohort. Their names impose no ranking or
 * statistical interval. Monetary and count results retain exact scaled products and sums.
 */
export function calculatePeriodForecast(input: PeriodForecastInput): PeriodForecastResult {
  const parsed = frameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const frame = parsed.data;
  if (frame.deals.length > MAX_PERIOD_FORECAST_DEALS) return { ok: false, reason: "bounded-limit" };
  if (frame.target.from >= frame.target.toExclusive || !isTimeZone(frame.target.timeZone))
    return { ok: false, reason: "invalid-input" };
  const deals = prepareDeals(frame);
  if (!deals.ok) return deals;
  const conservative = scenarioForecast(frame, deals.open, "conservative");
  if (!conservative.ok) return conservative;
  const base = scenarioForecast(frame, deals.open, "base");
  if (!base.ok) return base;
  const upside = scenarioForecast(frame, deals.open, "upside");
  if (!upside.ok) return upside;
  return {
    ok: true,
    definitionVersion: PERIOD_FORECAST_DEFINITION_VERSION,
    basis: "explicit-assumptions",
    currency: frame.currency,
    target: frame.target,
    cutoffObservedAt: frame.cutoffObservedAt,
    openDealCount: deals.open.length,
    closedDealCount: deals.closedDealCount,
    recordedOpenValue: recordedOpenValue(deals.open),
    scenarios: {
      conservative: conservative.forecast,
      base: base.forecast,
      upside: upside.forecast,
    },
  };
}
