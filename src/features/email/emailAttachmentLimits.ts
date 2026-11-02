import { AppError, ERROR_IDS } from "@/constants/errorIds";

// Gmail raw MIME expands binary attachments during base64 encoding, then encodes
// the complete message a second time for the API. Keep a send well below the
// provider's 25 MiB raw-message limit and bound the buffers held in the worker.
export const GMAIL_ATTACHMENT_LIMITS = {
  count: 20,
  itemBytes: 10 * 1024 * 1024,
  totalBytes: 15 * 1024 * 1024,
} as const;

export function attachmentLimitError(message: string): AppError {
  return new AppError(ERROR_IDS.MAIL_SEND_REJECTED, message);
}

export function hasDuplicateAttachmentIds(items: ReadonlyArray<{ fileId: string }>): boolean {
  return new Set(items.map((item) => item.fileId)).size !== items.length;
}
