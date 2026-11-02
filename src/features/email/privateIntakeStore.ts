import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { PrivateIntakeProvider } from "./privateIntakeTypes";

export interface PrivateIntakeMessage {
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  sentAt: Date | null;
  rfcMessageId: string | null;
}

// Call only inside the mailbox's short owner/account persistence fence. Real
// provider identities belong to the ledger until an exact receipt proves them.
export async function storePrivateIntake(
  tx: DbOrTx,
  args: {
    accountId: string;
    provider: PrivateIntakeProvider;
    observedProviderId: string;
    observedPayload: Record<string, unknown>;
    message: PrivateIntakeMessage;
    storeAttachments: (messageId: string) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<{ intakeId: string; messageId: string | null; threadId: string; inserted: boolean }> {
  args.signal.throwIfAborted();
  const existing = (
    await tx.execute(sql`SELECT id,owned_message_id,baseline_thread_id
    FROM email_private_intake WHERE account_id=${args.accountId} AND provider=${args.provider}
      AND observed_provider_id=${args.observedProviderId} FOR UPDATE`)
  ).rows[0] as
    | { id: string; owned_message_id: string | null; baseline_thread_id: string }
    | undefined;
  args.signal.throwIfAborted();
  if (existing !== undefined)
    return {
      intakeId: existing.id,
      messageId: existing.owned_message_id,
      threadId: existing.baseline_thread_id,
      inserted: false,
    };

  const intakeId = randomUUID();
  const messageId = randomUUID();
  const threadId = randomUUID();
  const syntheticId = `private-intake:${intakeId}`;
  const m = args.message;
  await tx.execute(sql`INSERT INTO email_threads
    (id,account_id,provider_thread_id,subject,visibility,last_message_at)
    VALUES(${threadId},${args.accountId},${syntheticId},${m.subject},'private',${m.sentAt})`);
  await tx.execute(sql`INSERT INTO email_messages
    (id,account_id,thread_id,provider_message_id,rfc_message_id,direction,from_email,from_name,
     to_emails,cc_emails,subject,snippet,body_html,body_text,sent_at,tracking_enabled)
    VALUES(${messageId},${args.accountId},${threadId},${syntheticId},${m.rfcMessageId},'inbound',
      ${m.fromEmail},${m.fromName},${JSON.stringify(m.toEmails)}::jsonb,
      ${JSON.stringify(m.ccEmails)}::jsonb,${m.subject},${m.snippet},${m.bodyHtml},${m.bodyText},
      ${m.sentAt},false)`);
  args.signal.throwIfAborted();
  await args.storeAttachments(messageId);
  args.signal.throwIfAborted();
  const inserted = await tx.execute(sql`INSERT INTO email_private_intake
    (id,account_id,provider,observed_provider_id,observed_payload,observed_payload_hash,
     owned_message_id,baseline_thread_id,baseline_message_hash,baseline_thread_hash,
     baseline_attachments_hash)
    SELECT ${intakeId},${args.accountId},${args.provider},${args.observedProviderId},
      ${JSON.stringify(args.observedPayload)}::jsonb,
      public.private_intake_hash_v1(${JSON.stringify(args.observedPayload)}::jsonb),
      ${messageId},${threadId},b.message_hash,b.thread_hash,b.attachments_hash
    FROM public.private_intake_baseline_v1(${args.accountId}::uuid,${messageId}::uuid) b
    RETURNING id`);
  args.signal.throwIfAborted();
  if (inserted.rows.length !== 1)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private intake baseline is unavailable");
  return { intakeId, messageId, threadId, inserted: true };
}
