import { describe, expect, test } from "vitest";
import {
  computeLifecycleEconomics,
  type LifecycleEconomicsInput,
  MAX_ECONOMICS_ACCOUNTS,
  MAX_ECONOMICS_POSTINGS,
} from "./lifecycleEconomics";

type Account = LifecycleEconomicsInput["accounts"][number];
type Eligible = Extract<Account, { eligibility: "eligible" }>;
type Posting = Extract<Eligible["revenue"], { state: "known" }>["postings"][number];
type LaneControl = LifecycleEconomicsInput["control"]["revenue"];

const frame = {
  id: "finance-window:fixture",
  scopeRef: "accounts:eligible:v1",
  accountIdentityRef: "accounts:deduplicated:v1",
  revenuePolicyRef: "recognized-net:fixture:v1",
  deliveryCostPolicyRef: "direct-service-cost:fixture:v1",
  currency: "EUR",
  fromInclusive: "2026-03-01T00:00:00Z",
  toExclusive: "2026-04-01T00:00:00Z",
  settledThrough: "2026-04-01T00:00:00Z",
  observedAt: "2026-04-03T00:00:00Z",
  qualification: "qualified-complete",
  eligibility: "verified",
} satisfies LifecycleEconomicsInput["frame"];

function posting(accountId: string, key: string, kind: Posting["kind"], amount: string): Posting {
  return {
    factId: `${accountId}:${key}`,
    accountId,
    kind,
    money: { currency: "EUR", unit: "currency-major", amount },
    effectiveAt: frame.fromInclusive,
    observedAt: frame.observedAt,
  };
}

function eligible(accountId: string, revenue: Posting[], cost: Posting[] = []): Eligible {
  return {
    frameId: frame.id,
    accountId,
    eligibility: "eligible",
    revenue: { state: "known", postings: revenue },
    deliveryCost: { state: "known", postings: cost },
  };
}

const control = (knownAccounts: number, postings: number, subtotal: string): LaneControl => ({
  knownAccounts,
  postings,
  subtotal,
});

function request(
  accounts: Account[],
  eligibleAccountIds: string[],
  revenue: LaneControl,
  deliveryCost: LaneControl,
): LifecycleEconomicsInput {
  return {
    frame,
    control: {
      frameId: frame.id,
      currency: frame.currency,
      accounts: accounts.length,
      eligibleAccountIds,
      revenue,
      deliveryCost,
    },
    accounts,
  };
}

function mainFixture(): LifecycleEconomicsInput {
  return request(
    [
      eligible(
        "a",
        [
          posting("a", "sale", "realized-revenue", "80.1234"),
          posting("a", "credit", "realized-credit", "10.1234"),
        ],
        [posting("a", "cost", "attributable-delivery-cost", "40.3333")],
      ),
      eligible(
        "b",
        [posting("b", "sale", "realized-revenue", "30.0001")],
        [posting("b", "cost", "attributable-delivery-cost", "15.6667")],
      ),
      eligible("zero", [
        posting("zero", "sale", "realized-revenue", "2"),
        posting("zero", "credit", "realized-credit", "2"),
      ]),
      eligible(
        "refund-only",
        [posting("refund-only", "credit", "realized-credit", "20.0001")],
        [posting("refund-only", "cost", "attributable-delivery-cost", "4")],
      ),
      { frameId: frame.id, accountId: "excluded", eligibility: "ineligible" },
    ],
    ["a", "b", "zero", "refund-only"],
    control(4, 6, "80"),
    control(4, 3, "60"),
  );
}

function editAccount(
  input: LifecycleEconomicsInput,
  accountId: string,
  edit: (row: Eligible) => Account,
): LifecycleEconomicsInput {
  return {
    ...input,
    accounts: input.accounts.map((row) =>
      row.accountId === accountId && row.eligibility === "eligible" ? edit(row) : row,
    ),
  };
}

function editSale(input: LifecycleEconomicsInput, edit: (line: Posting) => Posting) {
  return editAccount(input, "b", (row) => {
    if (row.revenue.state !== "known") throw new Error("Expected fixture sale");
    return {
      ...row,
      revenue: { ...row.revenue, postings: row.revenue.postings.map(edit) },
    };
  });
}

describe("settled eligible customer economics", () => {
  test("separates positive concentration, signed net revenue, attributable cost and contribution", () => {
    const input = mainFixture();
    const result = computeLifecycleEconomics(input);
    // Account nets are 70, 30.0001, 0 and -20.0001. Eligible net is 80. Cost is 60.
    expect(result).toMatchObject({
      state: "available",
      definition: "settled-eligible-account-economics-v1",
      currency: "EUR",
      unit: "currency-major",
      window: {
        fromInclusive: frame.fromInclusive,
        toExclusive: frame.toExclusive,
        settledThrough: frame.settledThrough,
        observedAt: frame.observedAt,
      },
      eligibleAccounts: 4,
      coverage: {
        revenue: { positive: 2, zero: 1, negative: 1, missing: 0 },
        deliveryCost: { known: 4, missing: 0 },
      },
      realizedNetRevenue: { state: "known", amount: "80.0000", sign: "positive" },
      attributableDeliveryCost: { state: "known", amount: "60.0000", sign: "positive" },
      concentration: {
        state: "available",
        denominatorBasis: "positive-eligible-account-net-revenue",
        denominator: "100.0001",
        largest: {
          accounts: 1,
          amount: "70.0000",
          share: { numerator: "700000", denominator: "1000001" },
        },
        topFive: {
          accounts: 2,
          amount: "100.0001",
          share: { numerator: "1000001", denominator: "1000001" },
        },
      },
      deliveryContribution: {
        state: "known",
        amount: "20.0000",
        sign: "positive",
        margin: { state: "available", rate: { numerator: "200000", denominator: "800000" } },
      },
    });
    expect(
      computeLifecycleEconomics({ ...input, accounts: [...input.accounts].reverse() }),
    ).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/refund-only|a:sale|excluded/);
  });

  test("takes the five largest positive account nets and preserves four-decimal large sums", () => {
    const ranked = [1, 6, 3, 5, 2, 4].map((value) => {
      const id = `account:${value}`;
      return eligible(id, [posting(id, "sale", "realized-revenue", String(value))]);
    });
    expect(
      computeLifecycleEconomics(
        request(
          ranked,
          ranked.map((row) => row.accountId),
          control(6, 6, "21"),
          control(6, 0, "0"),
        ),
      ),
    ).toMatchObject({
      concentration: {
        denominator: "21.0000",
        topFive: {
          accounts: 5,
          amount: "20.0000",
          share: { numerator: "200000", denominator: "210000" },
        },
      },
    });

    const large = request(
      [
        eligible("huge", [posting("huge", "sale", "realized-revenue", "99999999999999.9999")]),
        eligible("tiny", [posting("tiny", "sale", "realized-revenue", "0.0001")]),
      ],
      ["huge", "tiny"],
      control(2, 2, "100000000000000"),
      control(2, 0, "0"),
    );
    expect(computeLifecycleEconomics(large)).toMatchObject({
      realizedNetRevenue: { state: "known", amount: "100000000000000.0000" },
      concentration: {
        denominator: "100000000000000.0000",
        largest: { share: { numerator: "999999999999999999", denominator: "1000000000000000000" } },
      },
    });
  });

  test("reports known revenue and concentration while withholding contribution for partial costs", () => {
    const input = editAccount(mainFixture(), "a", (row) => ({
      ...row,
      deliveryCost: { state: "missing" },
    }));
    expect(
      computeLifecycleEconomics({
        ...input,
        control: { ...input.control, deliveryCost: control(3, 2, "19.6667") },
      }),
    ).toMatchObject({
      coverage: { deliveryCost: { known: 3, missing: 1 } },
      realizedNetRevenue: { state: "known", amount: "80.0000" },
      attributableDeliveryCost: { state: "missing", knownSubtotal: { amount: "19.6667" } },
      concentration: { state: "available", denominator: "100.0001" },
      deliveryContribution: { state: "unavailable", reason: "missing-delivery-cost" },
    });
  });

  test("withholds the positive denominator for missing revenue and keeps independent known costs", () => {
    const input = editAccount(mainFixture(), "b", (row) => ({
      ...row,
      revenue: { state: "missing" },
    }));
    expect(
      computeLifecycleEconomics({
        ...input,
        control: { ...input.control, revenue: control(3, 5, "49.9999") },
      }),
    ).toMatchObject({
      coverage: { revenue: { positive: 1, zero: 1, negative: 1, missing: 1 } },
      realizedNetRevenue: { state: "missing", knownSubtotal: { amount: "49.9999" } },
      attributableDeliveryCost: { state: "known", amount: "60.0000" },
      concentration: { state: "unavailable", reason: "missing-revenue" },
      deliveryContribution: { state: "unavailable", reason: "missing-revenue" },
    });
    const unknown = editAccount(
      request([eligible("none", [])], ["none"], control(0, 0, "0"), control(0, 0, "0")),
      "none",
      (row) => ({ ...row, revenue: { state: "missing" }, deliveryCost: { state: "missing" } }),
    );
    expect(computeLifecycleEconomics(unknown)).toMatchObject({
      realizedNetRevenue: { state: "missing", knownSubtotal: null },
      attributableDeliveryCost: { state: "missing", knownSubtotal: null },
      deliveryContribution: { state: "unavailable", reason: "missing-both" },
    });
  });

  test("distinguishes no eligible accounts, qualified zero, and negative net revenue", () => {
    expect(
      computeLifecycleEconomics(request([], [], control(0, 0, "0"), control(0, 0, "0"))),
    ).toMatchObject({
      eligibleAccounts: 0,
      realizedNetRevenue: { state: "unavailable", reason: "no-eligible-accounts" },
      concentration: { state: "unavailable", reason: "no-eligible-accounts" },
    });
    expect(
      computeLifecycleEconomics(
        request(
          [eligible("zero", [], [posting("zero", "cost", "attributable-delivery-cost", "3")])],
          ["zero"],
          control(1, 0, "0"),
          control(1, 1, "3"),
        ),
      ),
    ).toMatchObject({
      realizedNetRevenue: { state: "known", amount: "0.0000", sign: "zero" },
      concentration: { state: "unavailable", reason: "no-positive-revenue" },
      deliveryContribution: {
        state: "known",
        amount: "-3.0000",
        sign: "negative",
        margin: { state: "unavailable", reason: "zero-revenue" },
      },
    });
    expect(
      computeLifecycleEconomics(
        request(
          [eligible("negative", [posting("negative", "credit", "realized-credit", "0.0001")])],
          ["negative"],
          control(1, 1, "-0.0001"),
          control(1, 0, "0"),
        ),
      ),
    ).toMatchObject({
      realizedNetRevenue: { state: "known", amount: "-0.0001", sign: "negative" },
      attributableDeliveryCost: { state: "known", amount: "0.0000", sign: "zero" },
      concentration: { state: "unavailable", reason: "no-positive-revenue" },
      deliveryContribution: { margin: { state: "unavailable", reason: "negative-revenue" } },
    });
  });

  test("withholds the entire aggregate when any account eligibility is hidden or unresolved", () => {
    const input = mainFixture();
    for (const [eligibility, reason] of [
      ["withheld", "eligibility-withheld"],
      ["unresolved", "eligibility-unresolved"],
    ] as const) {
      const hidden = editAccount(input, "a", ({ accountId, frameId }) => ({
        accountId,
        frameId,
        eligibility,
      }));
      expect(computeLifecycleEconomics(hidden)).toEqual({ state: "unavailable", reason });
      expect(computeLifecycleEconomics({ ...input, frame: { ...frame, eligibility } })).toEqual({
        state: "unavailable",
        reason,
      });
    }
  });

  test("refuses stale frame, duplicated account or fact, and same-size roster substitution", () => {
    const input = mainFixture();
    expect(
      computeLifecycleEconomics(
        editAccount(input, "b", (row) => ({
          ...row,
          frameId: "old-snapshot",
        })),
      ),
    ).toEqual({ state: "unavailable", reason: "frame-mismatch" });
    expect(
      computeLifecycleEconomics(editAccount(input, "b", (row) => ({ ...row, accountId: "a" }))),
    ).toEqual({ state: "unavailable", reason: "duplicate-account" });
    expect(
      computeLifecycleEconomics(editSale(input, (row) => ({ ...row, factId: "a:sale" }))),
    ).toEqual({ state: "unavailable", reason: "overlapping-postings" });
    expect(
      computeLifecycleEconomics(editSale(input, (row) => ({ ...row, accountId: "a" }))),
    ).toEqual({ state: "unavailable", reason: "invalid-posting" });
    expect(
      computeLifecycleEconomics({
        ...input,
        control: { ...input.control, eligibleAccountIds: ["a", "b", "zero", "hidden-substitute"] },
      }),
    ).toEqual({ state: "unavailable", reason: "reconciliation-mismatch" });
  });

  test("checks independent monetary, posting and known-account controls before reporting", () => {
    const input = mainFixture();
    for (const patch of [{ subtotal: "80.0001" }, { postings: 7 }, { knownAccounts: 3 }]) {
      expect(
        computeLifecycleEconomics({
          ...input,
          control: { ...input.control, revenue: { ...input.control.revenue, ...patch } },
        }),
      ).toEqual({ state: "unavailable", reason: "reconciliation-mismatch" });
    }
  });

  test("enforces a settled exact window, a single currency and attributable cost lane", () => {
    const input = mainFixture();
    const old = "2026-03-31T23:59:59.999999999Z";
    expect(
      computeLifecycleEconomics({ ...input, frame: { ...frame, settledThrough: old } }),
    ).toEqual({ state: "unavailable", reason: "unsettled-window" });
    const finalIncluded = editSale(input, (row) => ({ ...row, effectiveAt: old }));
    expect(computeLifecycleEconomics(finalIncluded)).toMatchObject({ state: "available" });
    for (const patch of [
      { effectiveAt: frame.toExclusive },
      { observedAt: "2026-04-03T00:00:00.000000001Z" },
      { kind: "attributable-delivery-cost" },
    ] as const) {
      expect(computeLifecycleEconomics(editSale(input, (row) => ({ ...row, ...patch })))).toEqual({
        state: "unavailable",
        reason: "invalid-posting",
      });
    }
    expect(
      computeLifecycleEconomics(
        editSale(input, (row) => ({
          ...row,
          money: { ...row.money, currency: "USD" },
        })),
      ),
    ).toEqual({ state: "unavailable", reason: "mixed-currency" });
  });

  test("refuses unqualified or truncated source and over-budget rows", () => {
    const input = mainFixture();
    expect(
      computeLifecycleEconomics({ ...input, frame: { ...frame, qualification: "truncated" } }),
    ).toEqual({ state: "unavailable", reason: "unqualified-source" });
    expect(
      computeLifecycleEconomics({
        ...input,
        accounts: new Array<unknown>(MAX_ECONOMICS_ACCOUNTS + 1),
      }),
    ).toEqual({ state: "unavailable", reason: "bounded-limit" });
    expect(
      computeLifecycleEconomics({
        ...input,
        control: { ...input.control, deliveryCost: control(4, MAX_ECONOMICS_POSTINGS + 1, "60") },
      }),
    ).toEqual({ state: "unavailable", reason: "bounded-limit" });
  });
});
