import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { analyticsOriginalMoney } from "./analyticsInputContracts";

export const MAX_ECONOMICS_ACCOUNTS = 5_000;
export const MAX_ECONOMICS_POSTINGS = 20_000;
const SCALE = 10_000n;
const definition = "settled-eligible-account-economics-v1";

const identifier = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim());
const instant = z
  .string()
  .max(80)
  .datetime({ offset: true })
  .transform((value, context) => {
    try {
      return Temporal.Instant.from(value).epochNanoseconds;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid exact instant" });
      return z.NEVER;
    }
  });
const rows = z.custom<readonly unknown[]>(Array.isArray);
const count = z.number().int().nonnegative();
const controlTotal = z.strictObject({
  knownAccounts: count,
  postings: count,
  subtotal: z.string().regex(/^-?\d{1,19}(?:\.\d{1,4})?$/),
});

const requestSchema = z.strictObject({
  frame: z.strictObject({
    id: identifier,
    scopeRef: identifier,
    accountIdentityRef: identifier,
    revenuePolicyRef: identifier,
    deliveryCostPolicyRef: identifier,
    currency: currencyCode,
    fromInclusive: instant,
    toExclusive: instant,
    settledThrough: instant,
    observedAt: instant,
    qualification: z.enum(["qualified-complete", "incomplete", "truncated", "unqualified"]),
    eligibility: z.enum(["verified", "withheld", "unresolved"]),
  }),
  control: z.strictObject({
    frameId: identifier,
    currency: currencyCode,
    accounts: count,
    eligibleAccountIds: rows,
    revenue: controlTotal,
    deliveryCost: controlTotal,
  }),
  accounts: rows,
});
const observation = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("known"), postings: rows }),
  z.strictObject({ state: z.literal("missing") }),
]);
const accountKey = { accountId: identifier, frameId: identifier };
const accountSchema = z.discriminatedUnion("eligibility", [
  z.strictObject({
    ...accountKey,
    eligibility: z.literal("eligible"),
    revenue: observation,
    deliveryCost: observation,
  }),
  z.strictObject({ ...accountKey, eligibility: z.literal("ineligible") }),
  z.strictObject({ ...accountKey, eligibility: z.literal("withheld") }),
  z.strictObject({ ...accountKey, eligibility: z.literal("unresolved") }),
]);
const postingSchema = z.strictObject({
  factId: identifier,
  accountId: identifier,
  kind: z.enum(["realized-revenue", "realized-credit", "attributable-delivery-cost"]),
  money: analyticsOriginalMoney,
  effectiveAt: instant,
  observedAt: instant,
});

type PostingInput = z.input<typeof postingSchema>;
type ObservationInput =
  | { state: "known"; postings: readonly PostingInput[] }
  | { state: "missing" };
type EligibleAccount = Extract<z.input<typeof accountSchema>, { eligibility: "eligible" }>;
type AccountInput =
  | (Omit<EligibleAccount, "revenue" | "deliveryCost"> & {
      revenue: ObservationInput;
      deliveryCost: ObservationInput;
    })
  | Exclude<z.input<typeof accountSchema>, { eligibility: "eligible" }>;
type RequestInput = z.input<typeof requestSchema>;
export type LifecycleEconomicsInput = Omit<RequestInput, "accounts" | "control"> & {
  accounts: readonly AccountInput[];
  control: Omit<RequestInput["control"], "eligibleAccountIds"> & {
    eligibleAccountIds: readonly string[];
  };
};
type Request = z.output<typeof requestSchema>;
type Frame = Request["frame"];
type Lane = "revenue" | "deliveryCost";

type FailureReason =
  | "invalid-request"
  | "unsettled-window"
  | "unqualified-source"
  | "eligibility-withheld"
  | "eligibility-unresolved"
  | "bounded-limit"
  | "frame-mismatch"
  | "mixed-currency"
  | "invalid-account"
  | "invalid-posting"
  | "duplicate-account"
  | "overlapping-postings"
  | "reconciliation-mismatch";
type Failure = { state: "unavailable"; reason: FailureReason };
type AmountSign = "positive" | "zero" | "negative";
type KnownAmount = { amount: string; sign: AmountSign };
type ExactRatio = { numerator: string; denominator: string };
type KnownLane =
  | ({ state: "known" } & KnownAmount)
  | { state: "missing"; knownSubtotal: KnownAmount | null }
  | { state: "unavailable"; reason: "no-eligible-accounts" };

interface ConcentrationShare {
  accounts: number;
  amount: string;
  share: ExactRatio;
}

type Concentration =
  | {
      state: "unavailable";
      reason: "no-eligible-accounts" | "missing-revenue" | "no-positive-revenue";
    }
  | {
      state: "available";
      denominatorBasis: "positive-eligible-account-net-revenue";
      denominator: string;
      largest: ConcentrationShare;
      topFive: ConcentrationShare;
    };

type DeliveryContribution =
  | {
      state: "unavailable";
      reason: "no-eligible-accounts" | "missing-revenue" | "missing-delivery-cost" | "missing-both";
    }
  | ({
      state: "known";
      margin:
        | { state: "available"; rate: ExactRatio }
        | { state: "unavailable"; reason: "zero-revenue" | "negative-revenue" };
    } & KnownAmount);

export type LifecycleEconomics =
  | Failure
  | {
      state: "available";
      definition: typeof definition;
      currency: string;
      unit: "currency-major";
      window: {
        fromInclusive: string;
        toExclusive: string;
        settledThrough: string;
        observedAt: string;
      };
      scopeRef: string;
      eligibleAccounts: number;
      coverage: {
        revenue: { positive: number; zero: number; negative: number; missing: number };
        deliveryCost: { known: number; missing: number };
      };
      realizedNetRevenue: KnownLane;
      attributableDeliveryCost: KnownLane;
      concentration: Concentration;
      deliveryContribution: DeliveryContribution;
    };

function unavailable(reason: FailureReason): Failure {
  return { state: "unavailable", reason };
}

function toUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return negative ? -units : units;
}

function amount(value: bigint): KnownAmount {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(4, "0");
  return {
    amount: `${negative ? "-" : ""}${absolute / SCALE}.${fraction}`,
    sign: negative ? "negative" : value === 0n ? "zero" : "positive",
  };
}

interface LaneTotal {
  knownAccounts: number;
  postings: number;
  subtotal: bigint;
}

interface Totals {
  eligible: number;
  revenue: LaneTotal;
  deliveryCost: LaneTotal;
  positiveRevenue: bigint[];
  negativeRevenueAccounts: number;
}

function emptyLane(): LaneTotal {
  return { knownAccounts: 0, postings: 0, subtotal: 0n };
}

function validFrame(request: Request): Failure | null {
  const { frame, control, accounts } = request;
  if (frame.eligibility === "withheld") return unavailable("eligibility-withheld");
  if (frame.eligibility === "unresolved") return unavailable("eligibility-unresolved");
  if (frame.qualification !== "qualified-complete") return unavailable("unqualified-source");
  if (frame.fromInclusive >= frame.toExclusive) return unavailable("invalid-request");
  if (frame.toExclusive > frame.settledThrough || frame.settledThrough > frame.observedAt)
    return unavailable("unsettled-window");
  if (control.frameId !== frame.id) return unavailable("frame-mismatch");
  if (control.currency !== frame.currency) return unavailable("mixed-currency");
  if (
    Math.max(accounts.length, control.accounts, control.eligibleAccountIds.length) >
      MAX_ECONOMICS_ACCOUNTS ||
    control.revenue.postings + control.deliveryCost.postings > MAX_ECONOMICS_POSTINGS
  )
    return unavailable("bounded-limit");
  return accounts.length === control.accounts ? null : unavailable("reconciliation-mismatch");
}

function readPosting(
  frame: Frame,
  accountId: string,
  lane: Lane,
  input: unknown,
): Failure | { factId: string; units: bigint } {
  const parsed = postingSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid-posting");
  const posting = parsed.data;
  if (posting.money.currency !== frame.currency) return unavailable("mixed-currency");
  const deliveryCost = posting.kind === "attributable-delivery-cost";
  if (
    posting.accountId !== accountId ||
    (lane === "deliveryCost") !== deliveryCost ||
    posting.effectiveAt < frame.fromInclusive ||
    posting.effectiveAt >= frame.toExclusive ||
    posting.observedAt < posting.effectiveAt ||
    posting.observedAt > frame.observedAt
  )
    return unavailable("invalid-posting");
  const units = toUnits(posting.money.amount);
  return { factId: posting.factId, units: posting.kind === "realized-credit" ? -units : units };
}

function addObservation(
  frame: Frame,
  accountId: string,
  lane: Lane,
  read: z.output<typeof observation>,
  totals: Totals,
  factIds: Set<string>,
): Failure | null {
  if (read.state === "missing") return null;
  if (factIds.size + read.postings.length > MAX_ECONOMICS_POSTINGS)
    return unavailable("bounded-limit");
  let accountTotal = 0n;
  for (const input of read.postings) {
    const posting = readPosting(frame, accountId, lane, input);
    if ("state" in posting) return posting;
    if (factIds.has(posting.factId)) return unavailable("overlapping-postings");
    factIds.add(posting.factId);
    accountTotal += posting.units;
  }
  const total = totals[lane];
  total.knownAccounts += 1;
  total.postings += read.postings.length;
  total.subtotal += accountTotal;
  if (lane === "revenue") {
    if (accountTotal > 0n) totals.positiveRevenue.push(accountTotal);
    if (accountTotal < 0n) totals.negativeRevenueAccounts += 1;
  }
  return null;
}

function eligibleRoster(control: Request["control"]): Set<string> | null {
  const roster = new Set<string>();
  for (const input of control.eligibleAccountIds) {
    const id = identifier.safeParse(input);
    if (!id.success || roster.has(id.data)) return null;
    roster.add(id.data);
  }
  return roster;
}

type ReadableAccount = Extract<
  z.output<typeof accountSchema>,
  { eligibility: "eligible" | "ineligible" }
>;

function readAccount(raw: unknown, frameId: string): Failure | ReadableAccount {
  const parsed = accountSchema.safeParse(raw);
  if (!parsed.success) return unavailable("invalid-account");
  const account = parsed.data;
  if (account.eligibility === "withheld") return unavailable("eligibility-withheld");
  if (account.eligibility === "unresolved") return unavailable("eligibility-unresolved");
  return account.frameId === frameId ? account : unavailable("frame-mismatch");
}

function sumAccounts(
  request: Request,
  roster: ReadonlySet<string>,
): Failure | { state: "ready"; totals: Totals } {
  const accounts = new Set<string>();
  const factIds = new Set<string>();
  const totals: Totals = {
    eligible: 0,
    revenue: emptyLane(),
    deliveryCost: emptyLane(),
    positiveRevenue: [],
    negativeRevenueAccounts: 0,
  };
  for (const raw of request.accounts) {
    const account = readAccount(raw, request.frame.id);
    if ("state" in account) return account;
    if (accounts.has(account.accountId)) return unavailable("duplicate-account");
    accounts.add(account.accountId);
    if (roster.has(account.accountId) !== (account.eligibility === "eligible"))
      return unavailable("reconciliation-mismatch");
    if (account.eligibility === "ineligible") continue;

    totals.eligible += 1;
    const invalid =
      addObservation(
        request.frame,
        account.accountId,
        "revenue",
        account.revenue,
        totals,
        factIds,
      ) ??
      addObservation(
        request.frame,
        account.accountId,
        "deliveryCost",
        account.deliveryCost,
        totals,
        factIds,
      );
    if (invalid !== null) return invalid;
  }
  return { state: "ready", totals };
}

function reconciles(total: LaneTotal, control: z.output<typeof controlTotal>): boolean {
  return (
    total.knownAccounts === control.knownAccounts &&
    total.postings === control.postings &&
    total.subtotal === toUnits(control.subtotal)
  );
}

function laneReadout(total: LaneTotal, eligible: number): KnownLane {
  if (eligible === 0) return { state: "unavailable", reason: "no-eligible-accounts" };
  if (total.knownAccounts === eligible) return { state: "known", ...amount(total.subtotal) };
  return {
    state: "missing",
    knownSubtotal: total.knownAccounts === 0 ? null : amount(total.subtotal),
  };
}

function ratio(numerator: bigint, denominator: bigint): ExactRatio {
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

function share(values: readonly bigint[], denominator: bigint): ConcentrationShare {
  const numerator = values.reduce((sum, value) => sum + value, 0n);
  return {
    accounts: values.length,
    amount: amount(numerator).amount,
    share: ratio(numerator, denominator),
  };
}

function concentration(totals: Totals): Concentration {
  if (totals.eligible === 0) return { state: "unavailable", reason: "no-eligible-accounts" };
  if (totals.revenue.knownAccounts < totals.eligible)
    return { state: "unavailable", reason: "missing-revenue" };
  if (totals.positiveRevenue.length === 0)
    return { state: "unavailable", reason: "no-positive-revenue" };
  const values = [...totals.positiveRevenue].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const denominator = values.reduce((sum, value) => sum + value, 0n);
  return {
    state: "available",
    denominatorBasis: "positive-eligible-account-net-revenue",
    denominator: amount(denominator).amount,
    largest: share(values.slice(0, 1), denominator),
    topFive: share(values.slice(0, 5), denominator),
  };
}

function deliveryContribution(totals: Totals): DeliveryContribution {
  if (totals.eligible === 0) return { state: "unavailable", reason: "no-eligible-accounts" };
  const missingRevenue = totals.revenue.knownAccounts < totals.eligible;
  const missingCost = totals.deliveryCost.knownAccounts < totals.eligible;
  if (missingRevenue && missingCost) return { state: "unavailable", reason: "missing-both" };
  if (missingRevenue) return { state: "unavailable", reason: "missing-revenue" };
  if (missingCost) return { state: "unavailable", reason: "missing-delivery-cost" };
  const revenue = totals.revenue.subtotal;
  const contribution = revenue - totals.deliveryCost.subtotal;
  return {
    state: "known",
    ...amount(contribution),
    margin:
      revenue > 0n
        ? { state: "available", rate: ratio(contribution, revenue) }
        : { state: "unavailable", reason: revenue === 0n ? "zero-revenue" : "negative-revenue" },
  };
}

function iso(epoch: bigint): string {
  return Temporal.Instant.fromEpochNanoseconds(epoch).toString();
}

/** Compute aggregates from one independently controlled, eligible account ledger slice. */
export function computeLifecycleEconomics(input: unknown): LifecycleEconomics {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid-request");
  const request = parsed.data;
  const invalid = validFrame(request);
  if (invalid !== null) return invalid;
  const { frame, control } = request;
  const roster = eligibleRoster(control);
  if (roster === null) return unavailable("reconciliation-mismatch");
  const summed = sumAccounts(request, roster);
  if (summed.state === "unavailable") return summed;
  const { totals } = summed;
  if (
    totals.eligible !== roster.size ||
    !reconciles(totals.revenue, control.revenue) ||
    !reconciles(totals.deliveryCost, control.deliveryCost)
  )
    return unavailable("reconciliation-mismatch");
  const positive = totals.positiveRevenue.length;
  const negative = totals.negativeRevenueAccounts;
  return {
    state: "available",
    definition,
    currency: frame.currency,
    unit: "currency-major",
    window: {
      fromInclusive: iso(frame.fromInclusive),
      toExclusive: iso(frame.toExclusive),
      settledThrough: iso(frame.settledThrough),
      observedAt: iso(frame.observedAt),
    },
    scopeRef: frame.scopeRef,
    eligibleAccounts: totals.eligible,
    coverage: {
      revenue: {
        positive,
        negative,
        zero: totals.revenue.knownAccounts - positive - negative,
        missing: totals.eligible - totals.revenue.knownAccounts,
      },
      deliveryCost: {
        known: totals.deliveryCost.knownAccounts,
        missing: totals.eligible - totals.deliveryCost.knownAccounts,
      },
    },
    realizedNetRevenue: laneReadout(totals.revenue, totals.eligible),
    attributableDeliveryCost: laneReadout(totals.deliveryCost, totals.eligible),
    concentration: concentration(totals),
    deliveryContribution: deliveryContribution(totals),
  };
}
