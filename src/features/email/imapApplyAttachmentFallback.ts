import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";

async function repairExactCopies(
  tx: DbOrTx,
  accountId: string,
  predicate: SQL,
  signal: AbortSignal,
): Promise<void> {
  // Only exact-source copies share MIME part keys. SMTP semantic copies can have
  // different MIME nesting, so their immutable stored snapshots remain authoritative.
  await tx.execute(sql`WITH copies AS (
    SELECT DISTINCT ON (l.message_id) l.message_id,f.path,l.uid_validity,l.uid FROM mail_message_locators l
      JOIN mail_folders f ON f.id=l.folder_id AND f.account_id=l.account_id AND f.uid_validity=l.uid_validity
      JOIN email_messages m ON m.id=l.message_id AND m.account_id=l.account_id
      WHERE l.account_id=${accountId} AND ${predicate} AND l.active=true
        AND m.message_fingerprint IS NOT NULL
      ORDER BY l.message_id,l.last_seen_at DESC,l.id)
    UPDATE email_message_attachments a SET provider_locator=a.provider_locator ||
      jsonb_build_object('folderPath',copy.path,'uidValidity',copy.uid_validity,'uid',copy.uid)
    FROM copies copy WHERE a.account_id=${accountId} AND a.message_id=copy.message_id AND a.provider_locator->>'kind'='imap'`);
  signal.throwIfAborted();
}

export function repairImapAttachmentLocators(
  tx: DbOrTx,
  accountId: string,
  messageId: string,
  signal: AbortSignal,
): Promise<void> {
  return repairExactCopies(tx, accountId, sql`l.message_id=${messageId}`, signal);
}

export function repairImapEpochAttachmentLocators(
  tx: DbOrTx,
  accountId: string,
  folderId: string,
  signal: AbortSignal,
): Promise<void> {
  return repairExactCopies(
    tx,
    accountId,
    sql`EXISTS(SELECT 1 FROM mail_message_locators previous
    WHERE previous.account_id=l.account_id AND previous.message_id=l.message_id AND previous.folder_id=${folderId})`,
    signal,
  );
}
