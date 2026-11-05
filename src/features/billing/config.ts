import { z } from "zod";
import { BillingError } from "./contracts";
import type { StripeBillingConfig } from "./stripe";

const EU_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];
export type BillingConfig = Omit<StripeBillingConfig, "signal"> & {
  webhookSecret: string;
  allowedCountries: ReadonlySet<string>;
};
export const billingEnvShape = {
  BILLING_ENABLED: z.enum(["true", "false"]).default("false"),
  BILLING_MANAGED_HOSTING: z.enum(["true", "false"]).default("false"),
  STRIPE_LIVEMODE: z.enum(["true", "false"]).default("false"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().default(""),
  STRIPE_WORKSPACE_PRICE_MONTHLY: z.string().default(""),
  STRIPE_WORKSPACE_PRICE_YEARLY: z.string().default(""),
  STRIPE_SEAT_PRICE_MONTHLY: z.string().default(""),
  STRIPE_SEAT_PRICE_YEARLY: z.string().default(""),
  STRIPE_INCLUDED_SEATS: z.string().default(""),
  STRIPE_ALLOWED_COUNTRIES: z.string().default(EU_COUNTRIES.join(",")),
};
export const billingEnvSchema = z.object(billingEnvShape);

/** Disabled by default. Merchant secrets belong only on deployments operated by Warpdrive. */
export function parseBillingConfig(
  raw: z.output<typeof billingEnvSchema>,
  appOrigin: string,
): BillingConfig | null {
  if (raw.BILLING_ENABLED === "false") return null;
  if (raw.BILLING_MANAGED_HOSTING !== "true") throw new BillingError("not_configured");
  const included = Number(raw.STRIPE_INCLUDED_SEATS);
  if (
    raw.STRIPE_INCLUDED_SEATS === "" ||
    !Number.isSafeInteger(included) ||
    included < 0 ||
    included > 10_000
  )
    throw new BillingError("not_configured");
  const webhookSecret = raw.STRIPE_WEBHOOK_SECRET;
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) throw new BillingError("not_configured");
  const countryList = raw.STRIPE_ALLOWED_COUNTRIES.split(",").map((v) => v.trim());
  if (!countryList.length || countryList.some((v) => !EU_COUNTRIES.includes(v)))
    throw new BillingError("not_configured");
  return {
    secretKey: raw.STRIPE_SECRET_KEY,
    webhookSecret,
    appOrigin,
    portalConfigurationId: raw.STRIPE_PORTAL_CONFIGURATION_ID,
    workspacePriceIds: {
      monthly: raw.STRIPE_WORKSPACE_PRICE_MONTHLY,
      yearly: raw.STRIPE_WORKSPACE_PRICE_YEARLY,
    },
    seatPriceIds: {
      monthly: raw.STRIPE_SEAT_PRICE_MONTHLY,
      yearly: raw.STRIPE_SEAT_PRICE_YEARLY,
    },
    includedSeats: included,
    automaticTax: true,
    livemode: raw.STRIPE_LIVEMODE === "true",
    allowedCountries: new Set(countryList),
  };
}
