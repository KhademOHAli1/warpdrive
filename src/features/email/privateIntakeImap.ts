import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { imapAttachmentLocators } from "./imapApplyAttachments";
import { applyImapDeliveryObservations } from "./imapApplyDeliveryObservations";
import type { ImapFolderCheckpoint, PreparedImapMessage } from "./imapSyncTypes";
import { hasPrivateNotificationHint } from "./privateIntakeHints";
import { storePrivateIntake } from "./privateIntakeStore";
import { RAW_MIME_LIMITS, type RawParsedMail } from "./providers/rawMimeTypes";
import { findSmtpSentCopy } from "./smtpMimeProof";

// Retaining parsed HTML variants and base64 bytes must remain bounded as well as MIME input.
const MAX_OBSERVED_PAYLOAD_BYTES = RAW_MIME_LIMITS.messageBytes * 4;

export async function applyMatchingImapDeliveryObservations(
  tx: DbOrTx,
  input: {
    accountId: string;
    messageId: string;
    parsed: RawParsedMail;
    sourceFingerprint: string;
    heldSourceFingerprint?: string | null;
  },
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  // A retained source cannot acquire machine evidence from different replay bytes.
  if (
    input.heldSourceFingerprint !== undefined &&
    input.heldSourceFingerprint !== input.sourceFingerprint
  )
    return;
  const observed = await applyImapDeliveryObservations(tx, input, signal);
  if (!observed.ok) throw observed.error;
}

function retainedPart<T extends { content: Buffer }>(part: T) {
  const { content, ...metadata } = part;
  return { ...metadata, contentBase64: content.toString("base64") };
}

function observedPayload(
  folder: ImapFolderCheckpoint,
  message: PreparedImapMessage,
  id: string,
  signal: AbortSignal,
): Record<string, unknown> {
  signal.throwIfAborted();
  const parsed = message.parsed;
  const payload = {
    id,
    version: 1,
    provider: "imap_smtp",
    folderId: folder.id,
    folderPath: folder.path,
    uidValidity: folder.uidValidity,
    uid: message.uid,
    internalDate: message.internalDate?.toISOString() ?? null,
    sourceFingerprint: message.sourceFingerprint,
    parsed: {
      ...parsed,
      date: parsed.date?.toISOString() ?? null,
      attachments: parsed.attachments.map(retainedPart),
      deliveryReports: parsed.deliveryReports.map(retainedPart),
    },
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_OBSERVED_PAYLOAD_BYTES)
    throw new AppError(
      ERROR_IDS.MAIL_SYNC_FAILED,
      "Private IMAP evidence exceeds retention bounds",
    );
  signal.throwIfAborted();
  return payload;
}

export async function heldPrivateImapCopy(
  tx: DbOrTx,
  accountId: string,
  messageId: string,
  signal: AbortSignal,
): Promise<{ sourceFingerprint: string | null } | null> {
  signal.throwIfAborted();
  const result =
    await tx.execute(sql`SELECT observed_payload->>'sourceFingerprint' AS source_fingerprint
    FROM email_private_intake
    WHERE account_id=${accountId} AND provider='imap_smtp' AND owned_message_id=${messageId}
      AND intake_state<>'confirmed_notification' LIMIT 1`);
  signal.throwIfAborted();
  const row = result.rows[0];
  if (row === undefined) return null;
  return { sourceFingerprint: originalSourceFingerprint(row.source_fingerprint) };
}

function originalSourceFingerprint(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export async function holdPrivateImapObservation(
  tx: DbOrTx,
  accountId: string,
  folder: ImapFolderCheckpoint,
  message: PreparedImapMessage,
  now: Date,
  signal: AbortSignal,
): Promise<{
  messageId: string | null;
  inserted: boolean;
  sourceFingerprint: string | null;
} | null> {
  signal.throwIfAborted();
  const observedProviderId = `imap:${folder.id}:${folder.uidValidity}:${message.uid}`;
  const prior = (
    await tx.execute(sql`SELECT owned_message_id,
      observed_payload->>'sourceFingerprint' AS source_fingerprint FROM email_private_intake
      WHERE account_id=${accountId} AND provider='imap_smtp'
        AND observed_provider_id=${observedProviderId} FOR UPDATE`)
  ).rows[0] as { owned_message_id: string | null; source_fingerprint: string | null } | undefined;
  signal.throwIfAborted();
  let held: { messageId: string | null; inserted: boolean; sourceFingerprint: string | null };
  if (prior !== undefined) {
    // A tombstone remains authoritative even after its public hint or local copy disappears.
    held = {
      messageId: prior.owned_message_id,
      inserted: false,
      sourceFingerprint: originalSourceFingerprint(prior.source_fingerprint),
    };
  } else {
    if (
      folder.isSentFolder &&
      (await findSmtpSentCopy(tx, {
        accountId,
        isSentFolder: true,
        parsed: message.parsed,
        signal,
      })) !== null
    )
      return null;
    if (!(await hasPrivateNotificationHint(tx, accountId, message.parsed.rfcMessageId, signal)))
      return null;
    const parsed = message.parsed;
    const stored = await storePrivateIntake(tx, {
      accountId,
      provider: "imap_smtp",
      observedProviderId,
      observedPayload: observedPayload(folder, message, observedProviderId, signal),
      message: {
        fromEmail: parsed.from[0]?.email ?? "",
        fromName: parsed.from[0]?.name ?? null,
        toEmails: parsed.to.map((address) => address.email),
        ccEmails: parsed.cc.map((address) => address.email),
        subject: parsed.subject,
        snippet: Array.from(parsed.text ?? parsed.subject ?? "")
          .slice(0, 200)
          .join(""),
        bodyHtml: parsed.htmlWithRemoteImages,
        bodyText: parsed.text,
        sentAt: parsed.date ?? message.internalDate ?? now,
        rfcMessageId: parsed.rfcMessageId,
      },
      signal,
      storeAttachments: (messageId) =>
        imapAttachmentLocators(
          tx,
          {
            accountId,
            messageId,
            folderPath: folder.path,
            uidValidity: folder.uidValidity,
            uid: message.uid,
          },
          parsed,
          signal,
        ),
    });
    held = { ...stored, sourceFingerprint: message.sourceFingerprint };
  }
  if (held.messageId !== null) {
    await applyMatchingImapDeliveryObservations(
      tx,
      {
        accountId,
        messageId: held.messageId,
        parsed: message.parsed,
        sourceFingerprint: message.sourceFingerprint,
        heldSourceFingerprint: held.sourceFingerprint,
      },
      signal,
    );
  }
  signal.throwIfAborted();
  return held;
}
