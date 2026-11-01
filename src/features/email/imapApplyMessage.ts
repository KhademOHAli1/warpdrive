import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { wsChannel } from "@/constants/wsChannels";
import { emailMessages } from "@/db/schema";
import type { AuthUser } from "@/features/permissions/types";
import { publishEvent } from "@/server/notify";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { imapAttachmentLocators } from "./imapApplyAttachments";
import { applyImapDeliveryObservations } from "./imapApplyDeliveryObservations";
import { existingImapMessage } from "./imapApplyIdentity";
import { imapThreadForMessage } from "./imapApplyThread";
import type { ImapFolderCheckpoint, PreparedImapMessage } from "./imapSyncTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export async function applyImapMessage(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  folder: ImapFolderCheckpoint,
  owner: AuthUser,
  message: PreparedImapMessage,
  now: Date,
  signal: AbortSignal,
): Promise<{ messageId: string; inserted: boolean }> {
  const existing = await existingImapMessage(tx, runtime.accountId, folder, message, signal);
  signal.throwIfAborted();
  if (existing !== undefined) {
    if (existing.fingerprint === null && existing.providerMessageId?.startsWith("smtp:") !== true)
      await tx
        .update(emailMessages)
        .set({ messageFingerprint: message.fingerprint })
        .where(eq(emailMessages.id, existing.id));
    await imapAttachmentLocators(
      tx,
      {
        accountId: runtime.accountId,
        messageId: existing.id,
        folderPath: folder.path,
        uidValidity: folder.uidValidity,
        uid: message.uid,
      },
      message.parsed,
      signal,
    );
    const observedExisting = await applyImapDeliveryObservations(
      tx,
      { accountId: runtime.accountId, messageId: existing.id, parsed: message.parsed },
      signal,
    );
    if (!observedExisting.ok) throw observedExisting.error;
    return { messageId: existing.id, inserted: false };
  }
  const parsed = message.parsed;
  const date = parsed.date ?? message.internalDate ?? now;
  const threadId = await imapThreadForMessage(tx, runtime, owner, parsed, date, signal);
  const from = parsed.from[0];
  const [row] = await tx
    .insert(emailMessages)
    .values({
      accountId: runtime.accountId,
      threadId,
      providerMessageId: `imap:${folder.id}:${folder.uidValidity}:${message.uid}`,
      rfcMessageId: parsed.rfcMessageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      messageFingerprint: message.fingerprint,
      direction:
        from?.email.toLowerCase() === runtime.emailAddress.toLowerCase() ? "outbound" : "inbound",
      fromEmail: from?.email ?? "",
      fromName: from?.name ?? null,
      toEmails: parsed.to.map((address) => address.email),
      ccEmails: parsed.cc.map((address) => address.email),
      subject: parsed.subject,
      snippet: Array.from(parsed.text ?? parsed.subject ?? "")
        .slice(0, 200)
        .join(""),
      bodyHtml: parsed.htmlWithRemoteImages,
      bodyText: parsed.text,
      sentAt: date,
    })
    .returning({ id: emailMessages.id });
  signal.throwIfAborted();
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "IMAP message insert returned no row");
  await imapAttachmentLocators(
    tx,
    {
      accountId: runtime.accountId,
      messageId: row.id,
      folderPath: folder.path,
      uidValidity: folder.uidValidity,
      uid: message.uid,
    },
    parsed,
    signal,
  );
  const observedNew = await applyImapDeliveryObservations(
    tx,
    { accountId: runtime.accountId, messageId: row.id, parsed },
    signal,
  );
  if (!observedNew.ok) throw observedNew.error;
  const recentInbound =
    from?.email.toLowerCase() !== runtime.emailAddress.toLowerCase() &&
    message.internalDate !== null &&
    message.internalDate >= folder.notificationAfter;
  if (recentInbound)
    await publishEvent(
      tx,
      {
        v: 1,
        channel: wsChannel.user(runtime.ownerId),
        ts: now.toISOString(),
        actorId: null,
        type: "email_arrived",
        data: { messageId: row.id, threadId, accountId: runtime.accountId },
      },
      signal,
    );
  return { messageId: row.id, inserted: true };
}
