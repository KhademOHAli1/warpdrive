import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "./webhook";

const secret = "whsec_syntheticSecret";
const nowSeconds = 2_000_000_000;
const raw = JSON.stringify({
  id: "evt_example",
  object: "event",
  type: "invoice.paid",
  livemode: false,
  api_version: "2026-10-28.endive",
  created: nowSeconds,
  data: { object: { id: "in_example", customer: "cus_example" } },
});
const signature = (body = raw, time = nowSeconds) =>
  `t=${time},v1=${createHmac("sha256", secret).update(`${time}.${body}`).digest("hex")}`;
describe("Stripe webhook authenticity", () => {
  it("verifies the original body and supports rotated v1 signatures", () => {
    expect(
      verifyStripeWebhook(raw, `${signature()},v1=${"0".repeat(64)}`, {
        secret,
        nowSeconds,
        livemode: false,
      }).id,
    ).toBe("evt_example");
  });
  it.each([
    "",
    "garbage",
    `t=${nowSeconds},v1=abc`,
    `t=${nowSeconds},t=${nowSeconds},v1=${"0".repeat(64)}`,
  ])("rejects malformed signature %s", (header) => {
    expect(() =>
      verifyStripeWebhook(raw, header, { secret, nowSeconds, livemode: false }),
    ).toThrow();
  });
  it("rejects modified payloads even when the JSON has the same meaning", () => {
    expect(() =>
      verifyStripeWebhook(`${raw}\n`, signature(), { secret, nowSeconds, livemode: false }),
    ).toThrow();
  });
  it.each([-301, 301])("rejects timestamps outside the tolerance (%s)", (offset) => {
    expect(() =>
      verifyStripeWebhook(raw, signature(raw, nowSeconds + offset), {
        secret,
        nowSeconds,
        livemode: false,
      }),
    ).toThrow();
  });
  it("isolates live and sandbox events", () => {
    expect(() =>
      verifyStripeWebhook(raw, signature(), { secret, nowSeconds, livemode: true }),
    ).toThrow();
  });
  it("rejects signed oversized payloads and non-event JSON", () => {
    const huge = "a".repeat(1_048_577);
    expect(() =>
      verifyStripeWebhook(huge, signature(huge), { secret, nowSeconds, livemode: false }),
    ).toThrow();
    expect(() =>
      verifyStripeWebhook("{}", signature("{}"), { secret, nowSeconds, livemode: false }),
    ).toThrow();
  });
});
