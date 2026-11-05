import { describe, expect, it } from "vitest";
import { billingEnvSchema, parseBillingConfig } from "./config";
import { billingCommandSchema } from "./contracts";
import { account, config, subscription } from "./fixtures.test-support";
import { readSeatQuote, type SeatQuote, signSeatQuote } from "./seatQuotes";
import { subscriptionSnapshot } from "./snapshot";

describe("billing configuration and capacity authority", () => {
  it("leaves existing installations unbilled by default", () => {
    expect(parseBillingConfig(billingEnvSchema.parse({}), "https://app.example.com")).toBeNull();
  });
  it("requires an explicit merchant-operated deployment", () => {
    expect(() =>
      parseBillingConfig(
        billingEnvSchema.parse({ BILLING_ENABLED: "true" }),
        "https://app.example.com",
      ),
    ).toThrow();
  });
  it("derives capacity from paid line items plus included seats", () => {
    expect(subscriptionSnapshot(subscription(), account, config)).toMatchObject({
      purchasedSeats: 5,
      interval: "monthly",
      status: "active",
    });
  });
  it("rejects another account/customer, a partial item page, or unknown extra items", () => {
    const wrongCustomer = subscription();
    wrongCustomer.customer = "cus_foreign";
    const wrongAccount = subscription();
    wrongAccount.metadata.warpdrive_account_id = "other";
    const partial = subscription();
    partial.items.has_more = true;
    const unknownItem = subscription();
    unknownItem.items.data.push({
      ...unknownItem.items.data[0]!,
      id: "si_unknown",
      price: { ...unknownItem.items.data[0]!.price, id: "price_unknown" },
    });
    for (const sub of [wrongCustomer, wrongAccount, partial, unknownItem])
      expect(() => subscriptionSnapshot(sub, account, config)).toThrow();
  });
  it("rejects client-owned price/customer identity and undeclared commands", () => {
    expect(
      billingCommandSchema.safeParse({
        action: "portal",
        intent: "overview",
        customerId: "cus_other",
      }).success,
    ).toBe(false);
    expect(billingCommandSchema.safeParse({ action: "charge", amount: 1 }).success).toBe(false);
  });
});

describe("seat change quotes", () => {
  const quote: SeatQuote = {
    version: 1,
    accountId: account.id,
    subscriptionId: "sub_synthetic",
    seatItemId: "si_seats",
    interval: "monthly",
    totalSeats: 7,
    priorFingerprint: "a".repeat(64),
    prorationDate: 2_000_000_000,
    expiresAt: 2_000_000_900,
    amountDue: 500,
    currency: "eur",
  };
  it("round-trips a signed account-bound amount and proration date", () => {
    expect(readSeatQuote(signSeatQuote(quote, config.secretKey), config.secretKey)).toEqual(quote);
  });
  it("rejects amount tampering, another signing key and malformed tokens", () => {
    const token = signSeatQuote(quote, config.secretKey);
    const altered = `${Buffer.from(JSON.stringify({ ...quote, amountDue: 1 })).toString("base64url")}.${token.split(".")[1]}`;
    for (const invalid of [altered, "invalid", `${token}.extra`])
      expect(() => readSeatQuote(invalid, config.secretKey)).toThrow();
    expect(() => readSeatQuote(token, "another-key")).toThrow();
  });
});
