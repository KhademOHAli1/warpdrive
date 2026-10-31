import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { StorageClient } from "@/features/files/storage";
import { err, ok, type Result } from "@/types/result";
import type { SendPayload } from "./outboxClaim";
import { RAW_MIME_LIMITS } from "./providers/rawMimeTypes";
import type { PreparedSmtpAttachment, SmtpAttempt } from "./smtpOutboxTypes";

interface ArtifactArgs {
  attempt: SmtpAttempt;
  token: string;
  storage: StorageClient;
  signal: AbortSignal;
}
type SourceAttachment = NonNullable<SendPayload["attachments"]>[number];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function prepareSmtpArtifacts(
  db: Db,
  args: ArtifactArgs,
): Promise<Result<PreparedSmtpAttachment[], AppError>> {
  const sources = args.attempt.payload.attachments ?? [];
  if (sources.length > RAW_MIME_LIMITS.attachmentCount)
    return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Too many email attachments"));
  const prepared = [...(args.attempt.delivery_outcome?.preparedAttachments ?? [])];
  let remaining = RAW_MIME_LIMITS.messageBytes;
  for (const source of sources) {
    const artifact = await ensureArtifact(db, args, source, prepared, remaining);
    if (!artifact.ok) return artifact;
    remaining -= artifact.value.size;
  }
  return ok(prepared);
}

async function ensureArtifact(
  db: Db,
  args: ArtifactArgs,
  source: SourceAttachment,
  prepared: PreparedSmtpAttachment[],
  remaining: number,
): Promise<Result<PreparedSmtpAttachment, AppError>> {
  let artifact = prepared.find((item) => item.fileId === source.fileId);
  if (artifact?.ready === true) return artifact.size <= remaining ? ok(artifact) : oversized();
  const bytes = await args.storage.getObjectBytes(source.s3Key, args.signal);
  args.signal.throwIfAborted();
  if (!bytes.ok) return bytes;
  if (bytes.value.length > RAW_MIME_LIMITS.attachmentBytes || bytes.value.length > remaining)
    return oversized();
  const sha256 = hash(bytes.value);
  if (artifact !== undefined && artifact.sha256 !== sha256)
    return err(new AppError(ERROR_IDS.FILE_METADATA_MISMATCH, "Prepared email attachment changed"));
  if (artifact === undefined) {
    artifact = {
      fileId: source.fileId,
      objectKey: `mail/${args.attempt.account_id}/${args.attempt.id}/${randomUUID()}`,
      sha256,
      filename: source.filename,
      contentType: source.contentType,
      size: bytes.value.length,
      ready: false,
    };
    prepared.push(artifact);
    if (!(await persistArtifacts(db, args, prepared))) return changed();
  }
  const copied = await args.storage.copyObject(source.s3Key, artifact.objectKey, args.signal);
  args.signal.throwIfAborted();
  if (!copied.ok) return copied;
  artifact.ready = true;
  if (!(await persistArtifacts(db, args, prepared))) return changed();
  return ok(artifact);
}

function changed(): Result<never, AppError> {
  return err(
    new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Email attachment preparation changed"),
  );
}
function oversized(): Result<never, AppError> {
  return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Email attachment size limit exceeded"));
}
async function persistArtifacts(
  db: Db,
  args: ArtifactArgs,
  artifacts: PreparedSmtpAttachment[],
): Promise<boolean> {
  const result = await db.execute(sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(
    COALESCE(delivery_outcome,'{}'::jsonb),'{preparedAttachments}',${JSON.stringify(artifacts)}::jsonb)
    WHERE id=${args.attempt.id} AND claim_token=${args.token} AND send_started_at IS NULL
      AND payload=${JSON.stringify(args.attempt.payload)}::jsonb RETURNING id`);
  args.signal.throwIfAborted();
  return result.rows.length === 1;
}
