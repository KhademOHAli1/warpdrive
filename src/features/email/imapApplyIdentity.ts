import { and, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { emailMessages } from "@/db/schema";
import { mailMessageLocators } from "@/db/schema/mailRemote";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImapFolderCheckpoint, PreparedImapMessage } from "./imapSyncTypes";
import { findSmtpSentCopy } from "./smtpMimeProof";

export async function existingImapMessage(
  tx: DbOrTx,
  accountId: string,
  folder: ImapFolderCheckpoint,
  message: PreparedImapMessage,
  signal: AbortSignal,
) {
  const [locator] = await tx
    .select({ messageId: mailMessageLocators.messageId })
    .from(mailMessageLocators)
    .where(
      and(
        eq(mailMessageLocators.accountId, accountId),
        eq(mailMessageLocators.folderId, folder.id),
        eq(mailMessageLocators.uidValidity, folder.uidValidity),
        eq(mailMessageLocators.uid, message.uid),
      ),
    );
  signal.throwIfAborted();
  const provedId =
    locator?.messageId ??
    (await findSmtpSentCopy(tx, {
      accountId,
      isSentFolder: folder.isSentFolder,
      parsed: message.parsed,
      signal,
    }));
  const [existing] = await tx
    .select({
      id: emailMessages.id,
      fingerprint: emailMessages.messageFingerprint,
      providerMessageId: emailMessages.providerMessageId,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.accountId, accountId),
        provedId === null
          ? eq(emailMessages.messageFingerprint, message.fingerprint)
          : eq(emailMessages.id, provedId),
      ),
    );
  signal.throwIfAborted();
  // SMTP copies can acquire provider transport headers. Their accepted semantic receipt or
  // persisted APPENDUID locator establishes identity; a global RFC header never does.
  if (
    existing !== undefined &&
    existing.fingerprint !== null &&
    existing.fingerprint !== message.fingerprint &&
    existing.providerMessageId?.startsWith("smtp:") !== true
  )
    throw new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP immutable message identity changed", {
      accountId,
    });
  return existing;
}
