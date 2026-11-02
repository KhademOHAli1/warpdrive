import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { SmtpAttempt } from "./smtpOutboxTypes";

export async function storeSmtpArtifacts(
  tx: DbOrTx,
  attempt: SmtpAttempt,
  messageId: string,
  signal: AbortSignal,
): Promise<void> {
  for (const attachment of attempt.delivery_outcome?.preparedAttachments ?? []) {
    if (!attachment.ready) continue;
    const locator = { kind: "stored", objectKey: attachment.objectKey, sha256: attachment.sha256 };
    await tx.execute(sql`INSERT INTO email_message_attachments
      (message_id,account_id,provider_locator,filename,mime_type,size_bytes)
      SELECT ${messageId},${attempt.account_id},${JSON.stringify(locator)}::jsonb,
        ${attachment.filename},${attachment.contentType},${attachment.size}
      WHERE NOT EXISTS (SELECT 1 FROM email_message_attachments WHERE message_id=${messageId}
        AND account_id=${attempt.account_id} AND provider_locator->>'objectKey'=${attachment.objectKey})`);
    signal.throwIfAborted();
  }
}
