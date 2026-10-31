import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";

export async function findDraftCreation(
  db: Db,
  input: { createId?: string; accountId: string },
  signal: AbortSignal,
): Promise<Result<{ id: string } | null, AppError>> {
  if (input.createId === undefined) return ok(null);
  const row = (
    await db.execute(sql`SELECT id,account_id FROM email_drafts WHERE id=${input.createId}`)
  ).rows[0] as { id: string; account_id: string } | undefined;
  signal.throwIfAborted();
  if (!row) return ok(null);
  return row.account_id === input.accountId
    ? ok({ id: row.id })
    : err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
}
