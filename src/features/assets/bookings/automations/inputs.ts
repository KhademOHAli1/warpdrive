import { z } from "zod";
import { bookingAutomationTriggers } from "./contracts";

export const bookingAutomationId = z.uuid().toLowerCase();
const id = bookingAutomationId;

export const bookingAutomationNoticeInput = z.strictObject({ bookingId: id });

export const bookingAutomationRunInput = z.strictObject({
  siteId: id,
  status: z.enum(["pending", "delivered", "failed", "skipped"]).optional(),
  cursor: z.string().max(160).optional(),
});

export const bookingAutomationProfileInput = z.strictObject({
  siteId: id,
  requestId: id,
  version: z.number().int().nonnegative(),
  triggers: z
    .array(z.enum(bookingAutomationTriggers))
    .max(bookingAutomationTriggers.length)
    .refine((triggers) => new Set(triggers).size === triggers.length),
});

export const bookingAutomationRetryInput = z.strictObject({
  siteId: id,
  requestId: id,
  runId: id,
  failureId: id,
});
