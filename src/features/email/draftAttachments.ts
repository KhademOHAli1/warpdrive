import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { canActorAccessParent } from "@/features/files/fileAuthz";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";

export interface DraftAttachment {
  fileId: string;
  filename: string;
  size: number;
}

export async function resolveDraftAttachments(
  db: Db,
  actor: AuthUser,
  input: { fileId: string }[],
  signal: AbortSignal,
): Promise<Result<DraftAttachment[], AppError>> {
  const attachments: DraftAttachment[] = [];
  for (const { fileId } of input) {
    signal.throwIfAborted();
    const file = (
      await db.execute(sql`SELECT filename,size_bytes,entity_type,entity_id
      FROM files WHERE id=${fileId} AND status='ready'`)
    ).rows[0] as
      | {
          filename: string;
          size_bytes: string | number;
          entity_type: "deal" | "person" | "organization";
          entity_id: string;
        }
      | undefined;
    if (!file || !(await canActorAccessParent(db, actor, file.entity_type, file.entity_id, signal)))
      return err(new AppError(ERROR_IDS.GMAIL_ATTACHMENT_DENIED, "draft attachment unavailable"));
    const size = Number(file.size_bytes);
    if (!Number.isSafeInteger(size) || size < 0)
      return err(new AppError(ERROR_IDS.GMAIL_ATTACHMENT_DENIED, "draft attachment size invalid"));
    attachments.push({ fileId, filename: file.filename, size });
  }
  signal.throwIfAborted();
  return ok(attachments);
}
