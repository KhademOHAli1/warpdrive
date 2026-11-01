import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import type { AuthorizedAttachment } from "./attachmentDownloadAccess";
import type { AttachmentDownloadDeps } from "./attachmentDownloadTypes";
import { isMailConnectionCurrent, loadImapConnection } from "./mailConnectionRuntime";
import { privateGmailAttachmentSource } from "./privateIntakeGmailAttachment";
import { parseRawMime } from "./providers/rawMime";
import { RAW_MIME_LIMITS } from "./providers/rawMimeTypes";

const locatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("imap"),
    folderPath: z.string().min(1).max(1024),
    uidValidity: z.string().regex(/^\d+$/),
    uid: z.number().int().positive().max(4294967295),
    partKey: z.string().regex(/^\d+(?:\.\d+)*$/),
  }),
  z.object({
    kind: z.literal("stored"),
    objectKey: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[\da-f]{64}$/i),
  }),
]);
type Locator = z.infer<typeof locatorSchema>;
type BytesResult = Result<
  { bytes: Buffer; generation: number | null; privateBinding?: string },
  AppError
>;

export function attachmentDownloadDenied(): AppError {
  return new AppError(ERROR_IDS.GMAIL_ATTACHMENT_DENIED, "attachment not found");
}
const denied = (): BytesResult => err(attachmentDownloadDenied());

async function storedBytes(
  deps: AttachmentDownloadDeps,
  row: AuthorizedAttachment,
  locator: Extract<Locator, { kind: "stored" }>,
  signal: AbortSignal,
): Promise<BytesResult> {
  if (deps.storage === undefined) return denied();
  const head = await deps.storage.headObject(locator.objectKey, signal);
  signal.throwIfAborted();
  if (!head.ok || head.value.size !== row.size || head.value.size > RAW_MIME_LIMITS.attachmentBytes)
    return denied();
  const loaded = await deps.storage.getObjectBytes(locator.objectKey, signal);
  signal.throwIfAborted();
  if (!loaded.ok || loaded.value.length !== row.size) return denied();
  const hash = createHash("sha256").update(loaded.value).digest();
  if (!timingSafeEqual(hash, Buffer.from(locator.sha256, "hex"))) return denied();
  return ok({ bytes: loaded.value, generation: null });
}

async function imapBytes(
  db: Db,
  deps: AttachmentDownloadDeps,
  row: AuthorizedAttachment,
  locator: Extract<Locator, { kind: "imap" }>,
  signal: AbortSignal,
): Promise<BytesResult> {
  if (row.provider !== "imap_smtp") return denied();
  const loaded = await (
    deps.loadConnection ?? ((accountId, s) => loadImapConnection(db, accountId, s))
  )(row.accountId, signal);
  signal.throwIfAborted();
  if (!loaded.ok) return denied();
  const runtime = loaded.value;
  if (
    runtime.accountId !== row.accountId ||
    runtime.ownerId !== row.ownerUserId ||
    runtime.generation !== row.generation ||
    !(await isMailConnectionCurrent(db, runtime, signal))
  )
    return denied();
  const source = await runtime.imap.getSource({
    path: locator.folderPath,
    uidValidity: locator.uidValidity,
    uid: locator.uid,
    signal,
  });
  signal.throwIfAborted();
  if (!source.ok) return denied();
  const parsed = await parseRawMime({ source: source.value, signal });
  if (!parsed.ok) return denied();
  const part = parsed.value.attachments.find((part) => part.partKey === locator.partKey);
  if (
    part === undefined ||
    part.filename !== row.filename ||
    part.contentType !== row.mimeType ||
    part.size !== row.size
  )
    return denied();
  return ok({ bytes: part.content, generation: runtime.generation });
}

export async function attachmentDownloadBytes(
  db: Db,
  deps: AttachmentDownloadDeps,
  row: AuthorizedAttachment,
  actorId: string,
  signal: AbortSignal,
): Promise<BytesResult> {
  if (!Number.isSafeInteger(row.size) || row.size < 0 || row.size > RAW_MIME_LIMITS.attachmentBytes)
    return denied();
  if (row.providerLocator !== null) {
    const parsed = locatorSchema.safeParse(row.providerLocator);
    if (!parsed.success) return denied();
    return parsed.data.kind === "stored"
      ? storedBytes(deps, row, parsed.data, signal)
      : imapBytes(db, deps, row, parsed.data, signal);
  }
  return gmailBytes(db, deps, row, actorId, signal);
}

async function gmailBytes(
  db: Db,
  deps: AttachmentDownloadDeps,
  row: AuthorizedAttachment,
  actorId: string,
  signal: AbortSignal,
): Promise<BytesResult> {
  if (row.provider !== "gmail" || row.gmailAttachmentId === null) return denied();
  const held =
    row.gmailMessageId === null
      ? await privateGmailAttachmentSource(db, row, actorId, signal)
      : null;
  if (row.gmailMessageId === null && held === null) return denied();
  const providerMessageId = row.gmailMessageId ?? held?.providerMessageId;
  if (providerMessageId === undefined) return denied();
  const client = await deps.resolveClient(row.accountId, signal);
  signal.throwIfAborted();
  if (!client.ok) return client;
  const fetched = await client.value.getAttachment({
    messageId: providerMessageId,
    attachmentId: row.gmailAttachmentId,
    signal,
  });
  signal.throwIfAborted();
  if (!fetched.ok) return fetched;
  const bytes = Buffer.from(fetched.value.dataBase64, "base64url");
  return bytes.length > RAW_MIME_LIMITS.attachmentBytes ||
    (held !== null && bytes.length !== row.size)
    ? denied()
    : ok({
        bytes,
        generation: held === null ? null : row.generation,
        ...(held === null ? {} : { privateBinding: held.binding }),
      });
}
