import { describe, expect, it, vi } from "vitest";
import { checkoutFixture, stripeConfig, stripeJson } from "./fixtures.test-support";
import { StripeGateway } from "./gateway";

describe("Stripe billing transport", () => {
  it("uses server price IDs, optional additional seats, stable idempotency and pinned API version", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Stripe-Version")).toBe("2026-10-28.endive");
      expect(headers.get("Idempotency-Key")).toBe("operation-1");
      expect(init?.redirect).toBe("error");
      const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      expect(body.get("customer")).toBe("cus_example");
      expect(body.get("line_items[0][price]")).toBe("price_workspaceMonth");
      expect(body.get("line_items[0][quantity]")).toBe("1");
      expect(body.get("line_items[1][price]")).toBe("price_seatMonth");
      expect(body.get("line_items[1][quantity]")).toBe("3");
      expect(body.get("metadata[warpdrive_operation_key]")).toBe("operation-1");
      expect(body.get("billing_address_collection")).toBe("required");
      expect(body.get("automatic_tax[enabled]")).toBe("true");
      expect(body.get("success_url")).toBe(
        "https://app.example.com/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      );
      expect(body.get("cancel_url")).toBe(
        "https://app.example.com/settings/billing?checkout=canceled",
      );
      return stripeJson(checkoutFixture);
    });
    await new StripeGateway(stripeConfig(fetcher)).createCheckout(
      "cus_example",
      checkoutFixture.client_reference_id,
      "monthly",
      5,
      "operation-1",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not add a paid-seat line for included capacity", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(
        new URLSearchParams(typeof init?.body === "string" ? init.body : "").has(
          "line_items[1][price]",
        ),
      ).toBe(false);
      return stripeJson(checkoutFixture);
    });
    await new StripeGateway(stripeConfig(fetcher)).createCheckout(
      "cus_example",
      checkoutFixture.client_reference_id,
      "monthly",
      2,
      "operation-2",
    );
  });
  it("rejects foreign customer identity, test/live mismatch and unsafe hosted URLs", async () => {
    for (const fixture of [
      { ...checkoutFixture, customer: "cus_other" },
      { ...checkoutFixture, livemode: true },
      { ...checkoutFixture, url: "https://stripe.com.attacker.test/invoice" },
    ]) {
      const api = new StripeGateway(stripeConfig(async () => stripeJson(fixture)));
      await expect(
        api.createCheckout(
          "cus_example",
          checkoutFixture.client_reference_id,
          "monthly",
          2,
          "operation-3",
        ),
      ).rejects.toThrow();
    }
  });
  it("sanitizes provider errors and does not retry ambiguous writes automatically", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      stripeJson({ error: "private billing address and secret" }, 500),
    );
    const api = new StripeGateway(stripeConfig(fetcher));
    await expect(
      api.createCheckout(
        "cus_example",
        checkoutFixture.client_reference_id,
        "monthly",
        2,
        "operation-4",
      ),
    ).rejects.toMatchObject({ code: "http_error", status: 500 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not start Stripe IO for an aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    const api = new StripeGateway({ ...stripeConfig(fetcher), signal: controller.signal });
    await expect(api.retrieveCustomer("cus_example")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("strips full card data and unrelated financial fields from method summaries", async () => {
    const api = new StripeGateway(
      stripeConfig(async () =>
        stripeJson({
          object: "list",
          has_more: false,
          data: [
            {
              id: "pm_card",
              object: "payment_method",
              livemode: false,
              customer: "cus_example",
              type: "card",
              card: {
                brand: "visa",
                last4: "4242",
                exp_month: 12,
                exp_year: 2030,
                number: "4242424242424242",
                cvc: "123",
              },
              billing_details: { address: "private" },
            },
          ],
        }),
      ),
    );
    const result = await api.listPaymentMethods("cus_example");
    expect(JSON.stringify(result)).not.toContain("4242424242424242");
    expect(JSON.stringify(result)).not.toContain("cvc");
    expect(result.data[0]?.card?.last4).toBe("4242");
  });
  it("refuses a non-EUR, inactive or wrong-interval configured price", async () => {
    for (const delta of [
      { currency: "usd" },
      { active: false },
      { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
    ]) {
      const api = new StripeGateway(
        stripeConfig(async () =>
          stripeJson({
            id: "price_workspaceMonth",
            object: "price",
            livemode: false,
            active: true,
            currency: "eur",
            unit_amount: 1000,
            type: "recurring",
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
            ...delta,
          }),
        ),
      );
      await expect(api.validatePrices("monthly")).rejects.toThrow();
    }
  });
  it("bounds a stalled provider call", async () => {
    const api = new StripeGateway({
      ...stripeConfig(() => new Promise(() => undefined)),
      timeoutMs: 10,
    });
    await expect(api.retrieveCustomer("cus_example")).rejects.toMatchObject({ code: "timeout" });
  });
});
