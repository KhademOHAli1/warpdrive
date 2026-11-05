function requestUrl(value: RequestInfo | URL) {
  if (typeof value === "string") return new URL(value);
  return new URL(value instanceof URL ? value.href : value.url);
}
function isCheckout(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "object" in value &&
    value.object === "checkout.session"
  );
}

import type { BillingConfig } from "./config";
import type { subscription } from "./fixtures.test-support";
import { StripeGateway } from "./stripe/gateway";

/** Stripe HTTP stand-in only. All application persistence in integration tests is real PostgreSQL. */
export function syntheticStripe(config: BillingConfig, signal: AbortSignal) {
  const state = {
    accountId: "",
    customersCreated: 0,
    checkoutsCreated: 0,
    throwAfterCheckout: false,
    subscriptions: [] as ReturnType<typeof subscription>[],
    pendingSeatPayment: false,
  };
  const cached = new Map<string, unknown>();
  const reply = (value: unknown) => Promise.resolve(Response.json(value));
  const subscriptionReply = (
    body: URLSearchParams,
    key: string | null,
    method: string | undefined,
  ) => {
    const sub = state.subscriptions[0];
    if (sub === undefined) return Promise.resolve(Response.json({}, { status: 404 }));
    if (method === "POST") {
      if (state.pendingSeatPayment) sub.pending_update = { expires_at: 2_000_000_000 };
      else {
        const seat = sub.items.data.find((item) => item.id === "si_seats");
        if (seat !== undefined) seat.quantity = Number(body.get("items[0][quantity]"));
      }
      if (key !== null) cached.set(key, structuredClone(sub));
    }
    return reply(sub);
  };
  const checkoutReply = (body: URLSearchParams, key: string | null) => {
    state.checkoutsCreated++;
    const checkout = {
      id: "cs_test_synthetic",
      object: "checkout.session",
      livemode: false,
      customer: "cus_synthetic",
      subscription: null,
      client_reference_id: state.accountId,
      mode: "subscription",
      status: "open",
      payment_status: "unpaid",
      url: "https://checkout.stripe.com/c/synthetic",
      expires_at: 2_000_000_000,
      metadata: {
        warpdrive_account_id: state.accountId,
        warpdrive_operation_key: body.get("metadata[warpdrive_operation_key]"),
      },
    };
    if (key !== null) cached.set(key, checkout);
    if (state.throwAfterCheckout) {
      state.throwAfterCheckout = false;
      return Promise.reject(new TypeError("synthetic connection loss"));
    }
    return reply(checkout);
  };
  const priceReply = (url: URL) => {
    const id = url.pathname.split("/").at(-1);
    return reply({
      id,
      object: "price",
      livemode: false,
      active: true,
      currency: "eur",
      unit_amount: 1000,
      type: "recurring",
      recurring: {
        interval: id?.includes("Yearly") === true ? "year" : "month",
        interval_count: 1,
        usage_type: "licensed",
      },
    });
  };
  const fetcher: typeof fetch = (rawUrl, init) => {
    const url = requestUrl(rawUrl);
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const key = new Headers(init?.headers).get("idempotency-key");
    const replay = cached.get(key ?? "");
    if (replay !== undefined) return reply(replay);
    if (url.pathname === "/v1/customers" && init?.method === "POST") {
      state.accountId = body.get("metadata[warpdrive_account_id]") ?? "";
      state.customersCreated++;
      const customer = {
        id: "cus_synthetic",
        object: "customer",
        livemode: false,
        name: "Synthetic GmbH",
        email: "billing@example.test",
        metadata: { warpdrive_account_id: state.accountId },
      };
      if (key !== null) cached.set(key, customer);
      return reply(customer);
    }
    if (url.pathname === "/v1/customers/cus_synthetic")
      return reply({
        id: "cus_synthetic",
        object: "customer",
        livemode: false,
        metadata: { warpdrive_account_id: state.accountId },
        name: "Synthetic GmbH",
        email: "billing@example.test",
      });
    if (url.pathname.startsWith("/v1/prices/")) return priceReply(url);
    if (url.pathname === "/v1/subscriptions")
      return reply({ object: "list", has_more: false, data: state.subscriptions });
    if (url.pathname === "/v1/subscriptions/sub_synthetic")
      return subscriptionReply(body, key, init?.method);
    if (url.pathname === "/v1/invoices/create_preview")
      return reply({ currency: "eur", amount_due: 500, total: 500 });
    if (url.pathname === "/v1/checkout/sessions" && init?.method === "POST")
      return checkoutReply(body, key);
    if (url.pathname.startsWith("/v1/checkout/sessions/cs_")) {
      return reply([...cached.values()].find(isCheckout));
    }
    if (url.pathname === "/v1/invoices/in_foreign")
      return reply({
        id: "in_foreign",
        object: "invoice",
        livemode: false,
        customer: "cus_foreign",
        number: "F-1",
        status: "paid",
        currency: "eur",
        amount_due: 100,
        amount_paid: 100,
        amount_remaining: 0,
        total: 100,
        created: 1_999_000_000,
        due_date: null,
        period_start: 1_999_000_000,
        period_end: 2_000_000_000,
        hosted_invoice_url: "https://invoice.stripe.com/i/foreign",
        invoice_pdf: "https://pay.stripe.com/invoice/foreign/pdf",
      });
    return Promise.resolve(Response.json({}, { status: 404 }));
  };
  return { state, gateway: new StripeGateway({ ...config, signal, fetch: fetcher }) };
}
