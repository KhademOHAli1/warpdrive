import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { AuthorizedAttachment } from "./attachmentDownloadAccess";
import { extractAttachments } from "./attachmentParse";
import { gmailMessageSchema } from "./gmailSchemas";

// Reading an observed attachment grants no send/copy association. Only the
// current mailbox owner may use this ledger's opaque remote identity.
export async function privateGmailAttachmentSource(
  db: Db,
  row: AuthorizedAttachment,
  actorId: string,
  signal: AbortSignal,
): Promise<{ providerMessageId: string; binding: string } | null> {
  signal.throwIfAborted();
  if (
    row.provider !== "gmail" ||
    row.gmailMessageId !== null ||
    row.ownerUserId !== actorId ||
    row.status !== "connected" ||
    row.paused ||
    row.gmailAttachmentId === null
  )
    return null;
  const held = (
    await db.execute(sql`SELECT i.id,i.observed_provider_id,i.observed_payload
    FROM email_private_intake i JOIN email_messages m
      ON m.id=i.owned_message_id AND m.account_id=i.account_id
    JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
    JOIN email_accounts a ON a.id=i.account_id JOIN users u ON u.id=a.user_id
    WHERE i.account_id=${row.accountId} AND i.owned_message_id=${row.messageId}
      AND a.user_id=${actorId} AND a.connection_generation=${row.generation}
      AND a.status='connected' AND NOT a.paused AND u.is_active AND u.invited_at IS NULL
      AND i.provider='gmail' AND i.content_state='retained' AND i.intake_state<>'confirmed_notification'
      AND m.provider_message_id='private-intake:'||i.id::text AND m.gmail_message_id IS NULL
      AND t.provider_thread_id='private-intake:'||i.id::text AND t.gmail_thread_id IS NULL
      AND t.visibility='private' AND t.person_id IS NULL AND t.deal_id IS NULL AND t.lead_id IS NULL`)
  ).rows[0] as { id: string; observed_provider_id: string; observed_payload: unknown } | undefined;
  signal.throwIfAborted();
  if (held === undefined) return null;
  const message = gmailMessageSchema.safeParse(held.observed_payload);
  if (!message.success || message.data.id !== held.observed_provider_id) return null;
  const matches = extractAttachments(message.data.payload).filter(
    (part) =>
      part.gmailAttachmentId === row.gmailAttachmentId &&
      part.filename === row.filename &&
      part.mimeType === row.mimeType &&
      part.sizeBytes === row.size,
  );
  if (matches.length !== 1) return null;
  return {
    providerMessageId: held.observed_provider_id,
    binding: JSON.stringify([
      held.id,
      held.observed_provider_id,
      row.gmailAttachmentId,
      row.filename,
      row.mimeType,
      row.size,
    ]),
  };
}
