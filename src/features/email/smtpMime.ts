import { createHash } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { StorageClient } from "@/features/files/storage";
import { err, ok, type Result } from "@/types/result";
import type { SendPayload } from "./outboxClaim";
import { RAW_MIME_LIMITS } from "./providers/rawMimeTypes";
import type { PreparedSmtpAttachment } from "./smtpOutboxTypes";

export interface SmtpMimeInput {
  attemptId: string;
  messageId: string;
  from: string;
  payload: SendPayload;
  date: Date;
  inReplyTo: string | null;
  references: string[];
  preparedAttachments: PreparedSmtpAttachment[];
  storage: StorageClient;
  signal: AbortSignal;
}

// All storage access and MIME generation precede the durable DATA boundary.
export async function buildSmtpMime(args: SmtpMimeInput): Promise<Result<Buffer, AppError>> {
  args.signal.throwIfAborted();
  const attachments = [];
  let size = Buffer.byteLength(args.payload.html) + Buffer.byteLength(args.payload.text ?? "");
  if (args.preparedAttachments.length > RAW_MIME_LIMITS.attachmentCount)
    return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Too many email attachments"));
  for (const attachment of args.preparedAttachments) {
    const content = await args.storage.getObjectBytes(attachment.objectKey, args.signal);
    args.signal.throwIfAborted();
    if (!content.ok) return content;
    if (createHash("sha256").update(content.value).digest("hex") !== attachment.sha256)
      return err(
        new AppError(ERROR_IDS.FILE_METADATA_MISMATCH, "Email attachment snapshot changed"),
      );
    size += content.value.length;
    if (
      content.value.length > RAW_MIME_LIMITS.attachmentBytes ||
      size > RAW_MIME_LIMITS.messageBytes
    )
      return err(
        new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Email attachment size limit exceeded"),
      );
    attachments.push({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: content.value,
    });
  }
  try {
    const compiled = new MailComposer({
      from:
        args.payload.fromName !== undefined && args.payload.fromName !== null
          ? { name: args.payload.fromName, address: args.from }
          : args.from,
      to: args.payload.to,
      cc: args.payload.cc,
      subject: args.payload.subject,
      html: args.payload.html,
      text: args.payload.text,
      date: args.date,
      messageId: args.messageId,
      inReplyTo: args.inReplyTo ?? undefined,
      references: args.references,
      headers: { "X-Warpdrive-Send-Attempt": args.attemptId },
      attachments,
      disableFileAccess: true,
      disableUrlAccess: true,
    }).compile();
    const raw = await compiled.build();
    args.signal.throwIfAborted();
    if (raw.length > RAW_MIME_LIMITS.messageBytes)
      return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Encoded email size limit exceeded"));
    return ok(raw);
  } catch {
    args.signal.throwIfAborted();
    return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Email could not be encoded"));
  }
}
