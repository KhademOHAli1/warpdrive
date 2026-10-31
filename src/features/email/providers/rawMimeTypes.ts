export interface MailAddress {
  email: string;
  name: string | null;
}

export interface RawMailAttachment {
  // MIME part identity within this immutable source; independent of filenames and Gmail IDs.
  partKey: string;
  filename: string;
  contentType: string;
  disposition: "attachment" | "inline";
  contentId: string | null;
  size: number;
  content: Buffer;
}

export interface RawParsedMail {
  rfcMessageId: string | null;
  warpdriveSendAttemptId: string | null;
  inReplyTo: string | null;
  references: string[];
  date: Date | null;
  subject: string | null;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  text: string | null;
  html: string | null;
  // Sanitized storage variant; render only through the reader's explicit remote-image gate.
  htmlWithRemoteImages: string | null;
  attachments: RawMailAttachment[];
}

export interface RawMimeLimits {
  messageBytes: number;
  headerBytes: number;
  bodyBytes: number;
  attachmentBytes: number;
  attachmentCount: number;
  partCount: number;
}

export const RAW_MIME_LIMITS: Readonly<RawMimeLimits> = {
  messageBytes: 25 * 1024 * 1024,
  headerBytes: 64 * 1024,
  bodyBytes: 2 * 1024 * 1024,
  attachmentBytes: 10 * 1024 * 1024,
  attachmentCount: 50,
  partCount: 128,
};

export type RawMimeFailure = {
  kind:
    | "message_too_large"
    | "headers_too_large"
    | "body_too_large"
    | "attachment_too_large"
    | "too_many_attachments"
    | "invalid_message"
    | "invalid_limits";
};
