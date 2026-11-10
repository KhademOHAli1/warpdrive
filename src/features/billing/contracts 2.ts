import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { billingIntervalSchema, stripeCustomerProfileSchema } from "./stripe/schemas";

export const BILLING_SCOPE = "workspace";
export const BILLING_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;
export const billingCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("checkout"),
      requestId: z.uuid(),
      interval: billingIntervalSchema,
      totalSeats: z.number().int().min(1).max(10_000),
      profile: stripeCustomerProfileSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("portal"),
      intent: z.enum(["overview", "payment_methods", "cancel"]),
    })
    .strict(),
  z.object({ action: z.literal("reconcile") }).strict(),
  z
    .object({ action: z.literal("preview_seats"), totalSeats: z.number().int().min(1).max(10_000) })
    .strict(),
  z
    .object({
      action: z.literal("change_seats"),
      requestId: z.uuid(),
      quote: z.string().min(1).max(8192),
    })
    .strict(),
]);
export type BillingCommand = z.infer<typeof billingCommandSchema>;

export type SubscriptionSnapshot = {
  subscriptionId: string;
  status: string;
  interval: "monthly" | "yearly";
  purchasedSeats: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number;
  latestInvoiceId: string | null;
};
export type BillingAccount = {
  id: string;
  livemode: boolean;
  customerId: string | null;
  checkoutOperationId: string | null;
  seatOperationId: string | null;
  subscription: SubscriptionSnapshot | null;
  syncState: "never" | "current" | "needs_review";
  syncedAt: Date | null;
};
export type BillingOperation = {
  id: string;
  accountId: string;
  kind: "customer" | "checkout" | "seats";
  requestKey: string;
  fingerprint: string;
  startedAt: Date;
  resourceId: string | null;
};
export type BillingErrorCode =
  | "not_configured"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "not_ready"
  | "checkout_in_progress"
  | "already_subscribed"
  | "request_conflict"
  | "reconciliation_required"
  | "provider_unavailable";
const BILLING_ERROR_IDS = {
  not_configured: ERROR_IDS.BILLING_NOT_CONFIGURED,
  forbidden: ERROR_IDS.BILLING_DENIED,
  invalid_input: ERROR_IDS.BILLING_INPUT_INVALID,
  not_found: ERROR_IDS.BILLING_NOT_FOUND,
  not_ready: ERROR_IDS.BILLING_NOT_READY,
  checkout_in_progress: ERROR_IDS.BILLING_CHECKOUT_PENDING,
  already_subscribed: ERROR_IDS.BILLING_ALREADY_SUBSCRIBED,
  request_conflict: ERROR_IDS.BILLING_REQUEST_CONFLICT,
  reconciliation_required: ERROR_IDS.BILLING_RECONCILIATION,
  provider_unavailable: ERROR_IDS.BILLING_PROVIDER_UNAVAILABLE,
} as const;
export class BillingError extends AppError {
  constructor(readonly code: BillingErrorCode) {
    super(BILLING_ERROR_IDS[code], `Billing operation could not complete (${code}).`);
    this.name = "BillingError";
  }
}

export interface BillingTransaction {
  account: BillingAccount;
  saveAccount(patch: Partial<Omit<BillingAccount, "id" | "livemode">>): Promise<void>;
  operation(kind: BillingOperation["kind"], requestKey: string): Promise<BillingOperation | null>;
  operationById(id: string): Promise<BillingOperation | null>;
  reserveOperation(
    kind: BillingOperation["kind"],
    requestKey: string,
    fingerprint: string,
  ): Promise<BillingOperation>;
  completeOperation(operationId: string, resourceId: string): Promise<void>;
  hasEvent(eventId: string): Promise<boolean>;
  completeEvent(event: {
    id: string;
    type: string;
    digest: string;
    created: number;
  }): Promise<void>;
  audit(
    action: string,
    actorId: string | null,
    metadata?: Record<string, string | number | boolean | null>,
  ): Promise<void>;
}
export interface BillingStore {
  readAccount(livemode: boolean): Promise<BillingAccount | null>;
  withAccount<T>(livemode: boolean, work: (tx: BillingTransaction) => Promise<T>): Promise<T>;
  activeUserCount(): Promise<number>;
}
