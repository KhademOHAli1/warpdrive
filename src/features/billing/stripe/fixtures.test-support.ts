import type { StripeBillingConfig } from "./gateway";

export const stripeConfig = (fetcher: typeof fetch): StripeBillingConfig => ({
  signal: new AbortController().signal,
  secretKey: "sk_test_privateSecret",
  appOrigin: "https://app.example.com",
  portalConfigurationId: "bpc_default",
  workspacePriceIds: { monthly: "price_workspaceMonth", yearly: "price_workspaceYear" },
  seatPriceIds: { monthly: "price_seatMonth", yearly: "price_seatYear" },
  includedSeats: 2,
  livemode: false,
  fetch: fetcher,
});
export const checkoutFixture = {
  id: "cs_test_example",
  object: "checkout.session",
  livemode: false,
  customer: "cus_example",
  subscription: null,
  client_reference_id: "11111111-1111-4111-8111-111111111111",
  mode: "subscription",
  status: "open",
  payment_status: "unpaid",
  url: "https://checkout.stripe.com/c/example",
  expires_at: 2_000_000_000,
  metadata: { warpdrive_account_id: "11111111-1111-4111-8111-111111111111" },
};
export const stripeJson = (value: unknown, status = 200) =>
  Promise.resolve(Response.json(value, { status }));
