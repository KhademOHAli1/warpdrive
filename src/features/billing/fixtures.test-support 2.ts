import type { BillingConfig } from "./config";
import type { BillingAccount } from "./contracts";
import { stripeSubscriptionSchema } from "./stripe/schemas";

export const config: BillingConfig = {
  secretKey: "sk_test_synthetic",
  webhookSecret: "whsec_synthetic",
  appOrigin: "https://app.example.com",
  portalConfigurationId: "bpc_synthetic",
  workspacePriceIds: { monthly: "price_baseMonthly", yearly: "price_baseYearly" },
  seatPriceIds: { monthly: "price_seatMonthly", yearly: "price_seatYearly" },
  includedSeats: 2,
  livemode: false,
  allowedCountries: new Set(["DE"]),
};
export const account: BillingAccount = {
  id: "11111111-1111-4111-8111-111111111111",
  livemode: false,
  customerId: "cus_synthetic",
  checkoutOperationId: null,
  seatOperationId: null,
  subscription: null,
  syncState: "never",
  syncedAt: null,
};
export const subscription = () =>
  stripeSubscriptionSchema.parse({
    id: "sub_synthetic",
    object: "subscription",
    livemode: false,
    customer: account.customerId,
    status: "active",
    metadata: { warpdrive_account_id: account.id },
    cancel_at_period_end: false,
    items: {
      has_more: false,
      data: [
        {
          id: "si_base",
          quantity: 1,
          current_period_start: 1_999_000_000,
          current_period_end: 2_000_000_000,
          price: {
            id: config.workspacePriceIds.monthly,
            object: "price",
            livemode: false,
            currency: "eur",
            unit_amount: 1000,
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          },
        },
        {
          id: "si_seats",
          quantity: 3,
          current_period_start: 1_999_000_000,
          current_period_end: 2_000_000_000,
          price: {
            id: config.seatPriceIds.monthly,
            object: "price",
            livemode: false,
            currency: "eur",
            unit_amount: 100,
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          },
        },
      ],
    },
  });
