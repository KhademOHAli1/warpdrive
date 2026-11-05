import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BillingError } from "./contracts";
import {
  billingIntervalSchema,
  type StripeSubscription,
  subscriptionIdSchema,
} from "./stripe/schemas";

const quoteSchema = z.object({
  version: z.literal(1),
  accountId: z.uuid(),
  subscriptionId: subscriptionIdSchema,
  seatItemId: z
    .string()
    .regex(/^si_[A-Za-z0-9]+$/)
    .nullable(),
  interval: billingIntervalSchema,
  totalSeats: z.number().int().min(1).max(10_000),
  priorFingerprint: z.string().length(64),
  prorationDate: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  amountDue: z.number().int().safe(),
  currency: z.literal("eur"),
});
export type SeatQuote = z.infer<typeof quoteSchema>;
const signingKey = (secret: string) =>
  createHmac("sha256", secret).update("warpdrive-seat-quote-v1").digest();
export function signSeatQuote(quote: SeatQuote, secret: string) {
  const body = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${body}.${createHmac("sha256", signingKey(secret)).update(body).digest("base64url")}`;
}
export function readSeatQuote(token: string, secret: string): SeatQuote {
  const [body, signature, extra] = token.split(".");
  if (
    body === undefined ||
    body === "" ||
    signature === undefined ||
    signature === "" ||
    extra !== undefined ||
    token.length > 8192 ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    throw new BillingError("invalid_input");
  const expected = createHmac("sha256", signingKey(secret)).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new BillingError("invalid_input");
  try {
    return quoteSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    throw new BillingError("invalid_input");
  }
}
export function subscriptionFingerprint(sub: StripeSubscription) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: sub.id,
        items: sub.items,
        status: sub.status,
        cancel: sub.cancel_at_period_end,
        invoice: sub.latest_invoice,
        pending: sub.pending_update,
      }),
    )
    .digest("hex");
}
