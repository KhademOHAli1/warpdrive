import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { GmailMessage } from "./gmailSchemas";
import type { ParsedGmailMessage } from "./mimeParse";
import { hasPrivateNotificationHint } from "./privateIntakeHints";
import { storePrivateIntake } from "./privateIntakeStore";

export async function holdPrivateGmailObservation(
  tx: DbOrTx,
  accountId: string,
  remote: GmailMessage,
  parsed: ParsedGmailMessage,
  signal: AbortSignal,
): Promise<{ held: boolean; inserted: boolean }> {
  signal.throwIfAborted();
  const prior = await tx.execute(sql`SELECT id FROM email_private_intake
    WHERE account_id=${accountId} AND provider='gmail' AND observed_provider_id=${remote.id}`);
  signal.throwIfAborted();
  const rfcMessageId =
    remote.payload?.headers?.find((header) => header.name.toLowerCase() === "message-id")?.value ??
    null;
  if (
    prior.rows.length === 0 &&
    !(await hasPrivateNotificationHint(tx, accountId, rfcMessageId, signal))
  )
    return { held: false, inserted: false };
  const held = await storePrivateIntake(tx, {
    accountId,
    provider: "gmail",
    observedProviderId: remote.id,
    observedPayload: remote,
    message: { ...parsed, rfcMessageId },
    signal,
    storeAttachments: async (messageId) => {
      for (const a of parsed.attachments) {
        await tx.execute(sql`INSERT INTO email_message_attachments
          (message_id,account_id,gmail_attachment_id,filename,mime_type,size_bytes)
          VALUES(${messageId},${accountId},${a.gmailAttachmentId},${a.filename},${a.mimeType},${a.sizeBytes})`);
        signal.throwIfAborted();
      }
    },
  });
  return { held: true, inserted: held.inserted };
}
