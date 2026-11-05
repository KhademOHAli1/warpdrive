import { z } from "zod";
import {
  billingIntervalSchema,
  chargeIdSchema,
  invoiceIdSchema,
  stripeChargeSchema,
  stripeCheckoutSchema,
  stripeHostedUrlSchema,
  stripeInvoiceSchema,
  stripePaymentMethodSchema,
} from "../stripe/schemas";

const addressSchema = z
  .object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string().nullable(),
  })
  .nullable()
  .optional();

const customerSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: addressSchema,
  taxIds: z
    .object({
      data: z.array(z.object({ id: z.string(), type: z.string(), value: z.string() })),
      has_more: z.boolean(),
    })
    .optional(),
  defaultPaymentMethodId: z.string().nullable(),
});

const subscriptionSchema = z.object({
  subscriptionId: z.string(),
  status: z.string(),
  interval: billingIntervalSchema,
  purchasedSeats: z.number().int().nonnegative(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.number().int().nonnegative(),
  latestInvoiceId: z.string().nullable(),
});

export const overviewSchema = z.object({
  configured: z.boolean(),
  customer: customerSchema.nullable(),
  subscription: subscriptionSchema.nullable(),
  syncedAt: z.string().nullable(),
  syncState: z.enum(["never", "current", "needs_review"]),
  activeUsers: z.number().int().nonnegative(),
  includedSeats: z.number().int().nonnegative(),
  currency: z.literal("eur"),
  livemode: z.boolean(),
  paymentMethodsManagedBy: z.literal("stripe_customer_portal"),
  pendingCheckout: z
    .object({
      id: z.string(),
      status: z.string(),
      url: stripeHostedUrlSchema.nullable(),
      expiresAt: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export const invoiceSchema = stripeInvoiceSchema.pick({
  id: true,
  number: true,
  status: true,
  currency: true,
  amount_due: true,
  total: true,
  created: true,
  hosted_invoice_url: true,
  invoice_pdf: true,
});
export const receiptSchema = stripeChargeSchema.pick({
  id: true,
  amount: true,
  currency: true,
  created: true,
  paid: true,
  refunded: true,
  status: true,
  receipt_number: true,
});
export const paymentMethodSchema = stripePaymentMethodSchema.pick({
  id: true,
  type: true,
  card: true,
  sepa_debit: true,
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), has_more: z.boolean(), next_cursor: z.string().nullable() });

const billingErrorCodeSchema = z.enum([
  "unauthorized",
  "fresh_auth_required",
  "forbidden",
  "provider_unavailable",
  "not_configured",
  "invalid_input",
  "not_ready",
  "checkout_in_progress",
  "already_subscribed",
  "request_conflict",
  "reconciliation_required",
  "rate_limited",
  "not_found",
]);
export type BillingErrorCode = z.infer<typeof billingErrorCodeSchema>;
export const errorEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), id: z.string().optional() }),
});

export type BillingOverview = z.infer<typeof overviewSchema>;
export type BillingInvoice = z.infer<typeof invoiceSchema>;
export type BillingReceipt = z.infer<typeof receiptSchema>;
export type BillingPaymentMethod = z.infer<typeof paymentMethodSchema>;
export type BillingSubscription = z.infer<typeof subscriptionSchema>;
export type BillingProfile = {
  name: string;
  email: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    state?: string;
    country: string;
  };
  taxId?: { type: "eu_vat"; value: string };
};
export type BillingPage<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type BillingPageKind = "invoices" | "receipts" | "payment-methods";
export type BillingCommand =
  | {
      action: "checkout";
      requestId: string;
      interval: z.infer<typeof billingIntervalSchema>;
      totalSeats: number;
      profile: BillingProfile;
    }
  | { action: "portal"; intent: "overview" | "payment_methods" | "cancel" }
  | { action: "preview_seats"; totalSeats: number }
  | { action: "change_seats"; requestId: string; quote: string }
  | { action: "reconcile" };

export const checkoutSchema = stripeCheckoutSchema.pick({
  id: true,
  status: true,
  payment_status: true,
  url: true,
  expires_at: true,
  subscription: true,
});
export const portalSchema = z.object({ url: stripeHostedUrlSchema });
export const seatPreviewSchema = z.object({
  quote: z.string().min(1),
  amountDue: z.number().int().safe(),
  currency: z.literal("eur"),
  expiresAt: z.number().int().positive(),
  purchasedSeats: z.number().int().positive(),
  isEstimate: z.literal(true),
});
export const seatChangeSchema = z.object({
  subscription: subscriptionSchema,
  pending: z.boolean(),
  latestInvoiceId: z.string().nullable(),
});
export type BillingCheckout = z.infer<typeof checkoutSchema>;
export type BillingSeatPreview = z.infer<typeof seatPreviewSchema>;

export const billingResponseSchemas = {
  checkout: checkoutSchema,
  portal: portalSchema,
  seatPreview: seatPreviewSchema,
  seatChange: seatChangeSchema,
  reconcile: z.object({
    recovered: z.boolean(),
    subscription: subscriptionSchema.nullable().optional(),
  }),
};

export { billingErrorCodeSchema, chargeIdSchema, invoiceIdSchema, stripeHostedUrlSchema };
