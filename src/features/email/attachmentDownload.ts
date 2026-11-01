import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import { authorizedAttachment } from "./attachmentDownloadAccess";
import { attachmentDownloadBytes, attachmentDownloadDenied } from "./attachmentDownloadBytes";
import type { AttachmentDownload, AttachmentDownloadDeps } from "./attachmentDownloadTypes";
import { privateGmailAttachmentSource } from "./privateIntakeGmailAttachment";

export type { AttachmentDownload, AttachmentDownloadDeps } from "./attachmentDownloadTypes";

const attachmentIdSchema = z.uuid();

export async function resolveAttachmentDownload(
  db: Db,
  deps: AttachmentDownloadDeps,
  args: { actor: AuthUser; attachmentId: string },
  signal: AbortSignal,
): Promise<Result<AttachmentDownload, AppError>> {
  signal.throwIfAborted();
  const parsed = attachmentIdSchema.safeParse(args.attachmentId);
  if (!parsed.success)
    return err(
      new AppError(ERROR_IDS.GMAIL_ATTACHMENT_INPUT_INVALID, "attachmentId must be a uuid"),
    );
  const original = await authorizedAttachment(db, args.actor, parsed.data, signal);
  if (original === null) return err(attachmentDownloadDenied());
  const loaded = await attachmentDownloadBytes(db, deps, original, args.actor.id, signal);
  signal.throwIfAborted();
  if (!loaded.ok) return loaded;
  // Network and storage I/O never retain row locks. Recheck access before exposing the bytes.
  const current = await authorizedAttachment(db, args.actor, parsed.data, signal);
  if (
    current === null ||
    current.accountId !== original.accountId ||
    current.ownerUserId !== original.ownerUserId ||
    current.messageId !== original.messageId ||
    current.filename !== original.filename ||
    current.mimeType !== original.mimeType ||
    current.size !== original.size
  )
    return err(attachmentDownloadDenied());
  if (
    loaded.value.generation !== null &&
    (current.generation !== loaded.value.generation ||
      current.status !== "connected" ||
      current.paused)
  )
    return err(attachmentDownloadDenied());
  if (loaded.value.privateBinding !== undefined) {
    const source = await privateGmailAttachmentSource(db, current, args.actor.id, signal);
    if (source?.binding !== loaded.value.privateBinding) return err(attachmentDownloadDenied());
  }
  return ok({
    filename: original.filename,
    mimeType: original.mimeType,
    bytes: loaded.value.bytes,
  });
}
