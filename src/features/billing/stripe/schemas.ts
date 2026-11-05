import { z } from "zod";

export const STRIPE_API_VERSION = "2026-10-28.endive" as const;
export const stripeIdSchema = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));

export const customerIdSchema = stripeIdSchema("cus");
export const subscriptionIdSchema = stripeIdSchema("sub");
export const checkoutIdSchema = stripeIdSchema("cs");
export const invoiceIdSchema = stripeIdSchema("in");
export const chargeIdSchema = stripeIdSchema("ch");
export const paymentMethodIdSchema = stripeIdSchema("pm");
export const priceIdSchema = stripeIdSchema("price");
export const accountIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x21-\x7e]+$/);
export const billingIntervalSchema = z.enum(["monthly", "yearly"]);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export type PortalIntent = "overview" | "payment_methods" | "cancel";

export const stripeCustomerProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(250),
    email: z.email().max(254),
    address: z
      .object({
        line1: z.string().trim().min(1).max(200),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(1).max(100),
        postalCode: z.string().trim().min(1).max(30),
        state: z.string().trim().max(100).optional(),
        country: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict(),
    taxId: z.object({ type: z.literal("eu_vat"), value: z.string().min(1).max(50) }).optional(),
  })
  .strict();
export type StripeCustomerProfile = z.infer<typeof stripeCustomerProfileSchema>;

const timestamp = z.number().int().nonnegative();
const amount = z.number().int().safe();
const metadata = z.record(z.string().max(40), z.string().max(500)).default({});
const reference = (id: z.ZodType<string>) =>
  z
    .union([id, z.object({ id })])
    .transform((value) => (typeof value === "string" ? value : value.id));
const customerReference = reference(customerIdSchema);
const subscriptionReference = reference(subscriptionIdSchema);
const paymentMethodReference = reference(paymentMethodIdSchema);
const invoiceReference = reference(invoiceIdSchema);

// Redirect/download targets are returned only from Stripe's authenticated API.
// Reject other schemes/hosts before they can reach a browser redirect surface.
export const stripeHostedUrlSchema = z
  .string()
  .max(16_384)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com")) &&
        !url.username &&
        !url.password &&
        (url.port === "" || url.port === "443")
      );
    } catch {
      return false;
    }
  }, "Invalid Stripe URL");

export const stripeCustomerSchema = z.object({
  id: customerIdSchema,
  object: z.literal("customer"),
  livemode: z.boolean(),
  deleted: z.literal(false).optional(),
  metadata,
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z
    .object({
      line1: z.string().nullable(),
      line2: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      postal_code: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable()
    .optional(),
  tax_ids: z
    .object({
      data: z.array(
        z.object({
          id: stripeIdSchema("txi"),
          type: z.string(),
          value: z.string(),
          verification: z
            .object({ status: z.enum(["pending", "verified", "unverified", "unavailable"]) })
            .nullable()
            .optional(),
        }),
      ),
      has_more: z.boolean(),
    })
    .optional(),
  invoice_settings: z
    .object({ default_payment_method: paymentMethodReference.nullable().optional() })
    .optional(),
});
export type StripeCustomer = z.infer<typeof stripeCustomerSchema>;

export const stripePriceSchema = z.object({
  id: priceIdSchema,
  object: z.literal("price"),
  livemode: z.boolean(),
  active: z.boolean(),
  currency: z.string(),
  unit_amount: z.number().int().nonnegative().nullable(),
  type: z.enum(["recurring", "one_time"]),
  recurring: z
    .object({
      interval: z.enum(["day", "week", "month", "year"]),
      interval_count: z.number().int().positive(),
      usage_type: z.enum(["licensed", "metered"]),
    })
    .nullable(),
});

export const stripeCheckoutSchema = z.object({
  id: checkoutIdSchema,
  object: z.literal("checkout.session"),
  livemode: z.boolean(),
  customer: customerReference.nullable(),
  subscription: subscriptionReference.nullable(),
  client_reference_id: z.string().nullable(),
  mode: z.enum(["subscription", "payment", "setup"]),
  status: z.enum(["open", "complete", "expired"]).nullable(),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  url: stripeHostedUrlSchema.nullable(),
  expires_at: timestamp,
  metadata,
});
export type StripeCheckout = z.infer<typeof stripeCheckoutSchema>;

export const stripeSubscriptionItemSchema = z.object({
  id: stripeIdSchema("si"),
  quantity: z.number().int().nonnegative().optional(),
  current_period_start: timestamp,
  current_period_end: timestamp,
  price: z.object({
    id: priceIdSchema,
    object: z.literal("price"),
    livemode: z.boolean(),
    currency: z.string().regex(/^[a-z]{3}$/),
    unit_amount: amount.nullable(),
    recurring: z
      .object({
        interval: z.enum(["day", "week", "month", "year"]),
        interval_count: z.number().int().positive(),
        usage_type: z.enum(["licensed", "metered"]).optional(),
      })
      .nullable(),
  }),
});
export const stripeSubscriptionSchema = z.object({
  id: subscriptionIdSchema,
  object: z.literal("subscription"),
  livemode: z.boolean(),
  customer: customerReference,
  status: z.enum([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]),
  metadata,
  cancel_at_period_end: z.boolean(),
  cancel_at: timestamp.nullable().optional(),
  canceled_at: timestamp.nullable().optional(),
  ended_at: timestamp.nullable().optional(),
  trial_end: timestamp.nullable().optional(),
  latest_invoice: invoiceReference.nullable().optional(),
  default_payment_method: paymentMethodReference.nullable().optional(),
  pending_update: z.object({ expires_at: timestamp }).nullable().optional(),
  items: z.object({
    data: z.array(stripeSubscriptionItemSchema).max(100),
    has_more: z.boolean(),
  }),
});
export type StripeSubscription = z.infer<typeof stripeSubscriptionSchema>;

export const stripeInvoiceSchema = z.object({
  id: invoiceIdSchema,
  object: z.literal("invoice"),
  livemode: z.boolean(),
  customer: customerReference.nullable(),
  parent: z
    .object({
      type: z.string(),
      subscription_details: z
        .object({ subscription: subscriptionReference, metadata: metadata.nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  number: z.string().nullable(),
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).nullable(),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount_due: amount,
  amount_paid: amount,
  amount_remaining: amount,
  total: amount,
  created: timestamp,
  due_date: timestamp.nullable(),
  period_start: timestamp,
  period_end: timestamp,
  hosted_invoice_url: stripeHostedUrlSchema.nullable(),
  invoice_pdf: stripeHostedUrlSchema.nullable(),
});
export type StripeInvoice = z.infer<typeof stripeInvoiceSchema>;

export const stripeChargeSchema = z.object({
  id: chargeIdSchema,
  object: z.literal("charge"),
  livemode: z.boolean(),
  customer: customerReference.nullable(),
  amount: amount,
  amount_refunded: amount,
  currency: z.string().regex(/^[a-z]{3}$/),
  created: timestamp,
  paid: z.boolean(),
  refunded: z.boolean(),
  status: z.enum(["succeeded", "pending", "failed"]),
  receipt_url: stripeHostedUrlSchema.nullable(),
  receipt_number: z.string().nullable(),
});
export type StripeCharge = z.infer<typeof stripeChargeSchema>;

export const stripePaymentMethodSchema = z.object({
  id: paymentMethodIdSchema,
  object: z.literal("payment_method"),
  livemode: z.boolean(),
  customer: customerReference.nullable(),
  type: z.string().min(1).max(100),
  card: z
    .object({
      brand: z.string().max(50),
      last4: z.string().regex(/^\d{4}$/),
      exp_month: z.number().int().min(1).max(12),
      exp_year: z.number().int().min(2000).max(9999),
    })
    .optional(),
  sepa_debit: z
    .object({ last4: z.string().regex(/^[A-Za-z0-9]{4}$/), country: z.string().max(2) })
    .optional(),
});
export type StripePaymentMethod = z.infer<typeof stripePaymentMethodSchema>;

export const stripePortalSchema = z.object({
  id: stripeIdSchema("bps"),
  object: z.literal("billing_portal.session"),
  livemode: z.boolean(),
  customer: customerReference,
  url: stripeHostedUrlSchema,
  return_url: z.string().nullable().optional(),
});
export type StripePortal = z.infer<typeof stripePortalSchema>;

export const stripePageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ object: z.literal("list"), data: z.array(item).max(100), has_more: z.boolean() });
export type StripePage<T> = { data: T[]; has_more: boolean; next_cursor: string | null };

export const stripeEventSchema = z.object({
  id: stripeIdSchema("evt"),
  object: z.literal("event"),
  type: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9_.]+$/),
  livemode: z.boolean(),
  api_version: z.string().max(100).nullable(),
  created: timestamp,
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export type VerifiedStripeEvent = z.infer<typeof stripeEventSchema>;
