import { z } from "zod";
import type {
  DeliveryObservationView,
  DeliveryReviewState,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";
import { DELIVERY_REPORT_LIMITS as LIMITS } from "./deliveryReportTypes";
import { isValidMailRecipient } from "./recipientAddress";

export const deliveryObservationErrorSchema = z.enum([
  "invalid_input",
  "not_found",
  "conflict",
  "permission",
  "rate_limit",
  "unknown",
]);
const kind = z.enum(["to", "cc", "bcc"]);
const address = z.string().max(254).refine(isValidMailRecipient);
const field = z.string().max(LIMITS.fieldBytes);
const typedValue = z.strictObject({ type: field.min(1), value: field });
const diagnostic = z.strictObject({
  type: field.min(1),
  text: z.string().max(LIMITS.diagnosticBytes),
  display: z.literal("plain_text"),
});
const associatedTarget = z.strictObject({ attemptId: z.guid(), recipient: address, kind });
const positiveRevision = z.number().int().min(1).max(2_147_483_647);
const associated = z.strictObject({
  revision: positiveRevision,
  decision: z.literal("associated"),
  target: associatedTarget,
});
const dismissed = z.strictObject({
  revision: positiveRevision,
  decision: z.literal("dismissed"),
  target: z.null(),
});
const review = z.discriminatedUnion("decision", [
  associated,
  dismissed,
  z.strictObject({
    revision: positiveRevision,
    decision: z.literal("unavailable"),
    target: z.null(),
  }),
  z.strictObject({ revision: z.literal(0), decision: z.literal("unreviewed"), target: z.null() }),
]);
export const savedDeliveryReviewSchema: z.ZodType<DeliveryReviewState> = z.discriminatedUnion(
  "decision",
  [associated, dismissed],
);
const recipient = z.strictObject({
  index: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.recipientBlocks - 1),
  originalRecipient: typedValue.nullable(),
  finalRecipient: typedValue,
  action: z.enum(["failed", "delayed", "delivered", "relayed", "expanded"]),
  status: z.string().regex(/^[245]\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/u),
  statusClass: z.union([z.literal(2), z.literal(4), z.literal(5)]),
  terminalReport: z.boolean(),
  actionStatus: z.enum(["consistent", "conflict"]),
  remoteMta: typedValue.nullable(),
  diagnostic: diagnostic.nullable(),
  localizedDiagnostics: z
    .array(
      z.strictObject({
        languageTag: field.min(1),
        text: z.string().max(LIMITS.diagnosticBytes),
        display: z.literal("plain_text"),
      }),
    )
    .max(LIMITS.localizedDiagnostics),
  lastAttemptDate: field.nullable(),
  finalLogId: field.nullable(),
  willRetryUntil: field.nullable(),
  extensions: z
    .array(z.strictObject({ name: field.min(1), value: field }))
    .max(LIMITS.fieldsPerBlock),
  review,
});
const report: z.ZodType<DeliveryObservationView> = z.strictObject({
  id: z.guid(),
  sourceMessageId: z.guid(),
  partKey: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[0-9]+([.!][0-9]+)*$/u),
  mediaType: z.enum(["message/delivery-status", "message/global-delivery-status"]),
  provenance: z.enum(["direct", "nested", "forwarded"]),
  trust: z.literal("unverified"),
  requiresReview: z.literal(true),
  recipients: z
    .array(recipient)
    .min(1)
    .max(LIMITS.recipientBlocks)
    .refine((values) => new Set(values.map((entry) => entry.index)).size === values.length),
});
export const deliveryObservationReportsSchema = z
  .array(report)
  .max(100)
  .refine((values) => new Set(values.map((entry) => entry.id)).size === values.length);
const target: z.ZodType<DeliveryReviewTarget> = z.strictObject({
  attemptId: z.guid(),
  subject: z.string().max(2000),
  sentAt: z.iso.datetime({ offset: true }),
  recipients: z.array(z.strictObject({ address, kind })).min(1).max(3000),
});
export const deliveryObservationTargetsSchema = z
  .array(target)
  .max(100)
  .refine((values) => new Set(values.map((entry) => entry.attemptId)).size === values.length);
