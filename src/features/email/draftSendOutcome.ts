import { z } from "zod";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import type { SendEmailOutcome } from "@/types/mail";

const attemptSchema = z.object({
  attemptId: z.uuid(),
  status: z.string(),
  submitted: z.boolean(),
  scheduledAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  messageId: z.string().nullable(),
  deliveryState: z.enum(["accepted", "partial", "unknown", "rejected"]).nullable(),
  accepted: z.array(z.string()).nullable(),
  rejected: z.array(z.string()).nullable(),
  sentCopyState: z.enum(["started", "complete", "failed", "unknown"]).nullable(),
  sentCopyFolder: z.string().nullable(),
});

type Attempt = z.infer<typeof attemptSchema>;

function receiptState(a: Attempt) {
  if (a.deliveryState !== null) return a.deliveryState;
  if (a.status === "sent" && a.providerMessageId !== null) return "accepted";
  if (a.status === "needs_review") return "unknown";
  if (a.status === "failed" && !a.submitted) return "rejected";
  return null;
}

function sendingReceiptStatus(a: Attempt): string {
  const inLease =
    a.claimedAt !== null &&
    Date.now() - new Date(a.claimedAt).getTime() < CLAIM_LEASE_SECONDS * 1000;
  return a.submitted && !inLease ? "needs_review" : "pending";
}

function receiptStatus(a: Attempt, state: ReturnType<typeof receiptState>): string {
  if (a.status === "sending" && (state === null || state === "unknown"))
    return sendingReceiptStatus(a);
  if (state === "unknown" || state === "partial") return "needs_review";
  if (state === "accepted" && a.messageId === null) return "needs_review";
  if (a.status === "sending") return sendingReceiptStatus(a);
  if (a.status === "failed" && a.submitted && state !== "rejected") return "needs_review";
  if (
    a.status === "pending" &&
    a.scheduledAt !== null &&
    new Date(a.scheduledAt).getTime() > Date.now()
  )
    return "scheduled";
  return a.status;
}

function receiptSentCopy(a: Attempt): SendEmailOutcome["sentCopy"] {
  if (a.sentCopyState === null || a.sentCopyFolder === null) return undefined;
  return {
    state: a.sentCopyState === "started" ? "unknown" : a.sentCopyState,
    folderPath: a.sentCopyFolder,
  };
}

export function draftSendOutcome(raw: unknown): SendEmailOutcome | undefined {
  const parsed = attemptSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const a = parsed.data;
  const state = receiptState(a);
  const status = receiptStatus(a, state);
  return {
    status,
    attemptId: a.attemptId,
    providerMessageId: a.providerMessageId ?? undefined,
    messageId: a.messageId ?? undefined,
    deliveryOutcome:
      state !== null && status !== "pending"
        ? { state, accepted: a.accepted ?? undefined, rejected: a.rejected ?? undefined }
        : undefined,
    sentCopy: receiptSentCopy(a),
  };
}

// Select only user-facing receipt fields. Credential/snapshot data never leaves
// the server as part of a draft, even when it shares this durable outbox record.
export const PUBLIC_SEND_ATTEMPT_FIELDS = `jsonb_build_object(
  'attemptId',s.id,'status',s.status,'submitted',s.send_started_at IS NOT NULL,'scheduledAt',s.scheduled_at,'claimedAt',s.claimed_at,
  'providerMessageId',coalesce(s.provider_message_id,s.gmail_message_id),
  'deliveryState',s.delivery_outcome->>'state','accepted',s.delivery_outcome->'accepted','rejected',s.delivery_outcome->'rejected',
  'sentCopyState',s.delivery_outcome->'sentCopy'->>'state','sentCopyFolder',s.delivery_outcome->'sentCopy'->>'folderPath',
  'messageId',(SELECT m.id FROM email_messages m WHERE m.account_id=s.account_id
    AND (m.provider_message_id=s.provider_message_id OR m.gmail_message_id=s.gmail_message_id) LIMIT 1))`;
export const DRAFT_SEND_OUTCOME_COLUMN = `(SELECT ${PUBLIC_SEND_ATTEMPT_FIELDS}
  FROM email_send_attempts s WHERE s.account_id=d.account_id AND s.idempotency_key=d.send_intent_id) AS send_attempt`;
