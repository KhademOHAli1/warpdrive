import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { canSeeLinkedDeal, canSeeLinkedPerson } from "./emailVisibility";
import { privateIntakeBlocksThread } from "./privateIntakeRestrictions";

export async function assertDraftThread(
  db: DbOrTx,
  input: { threadId?: string | null; accountId: string },
  signal: AbortSignal,
): Promise<Result<null, AppError>> {
  if (input.threadId === undefined || input.threadId === null) return ok(null);
  const row = (
    await db.execute(sql`SELECT id FROM email_threads
    WHERE id=${input.threadId} AND account_id=${input.accountId}
      AND NOT ${privateIntakeBlocksThread(input.accountId, input.threadId)}`)
  ).rows[0];
  signal.throwIfAborted();
  return row
    ? ok(null)
    : err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found for account"));
}

// A picker is not an authorization boundary: MCP and composer callers can supply arbitrary
// UUIDs. Apply the shared CRM visibility rules before storing either explicit link, with the
// same not-found result for missing and hidden records.
export async function assertDraftLinks(
  db: DbOrTx,
  actor: AuthUser,
  links: { linkDealId?: string | null; linkPersonId?: string | null },
  signal: AbortSignal,
): Promise<Result<null, AppError>> {
  signal.throwIfAborted();
  const dealId = links.linkDealId ?? null;
  if (dealId !== null) {
    if (!(await canSeeLinkedDeal(db, actor, dealId, signal)))
      return err(new AppError(ERROR_IDS.DEAL_NOT_FOUND, "draft deal link not found", {}));
  }
  const personId = links.linkPersonId ?? null;
  if (personId !== null) {
    if (!(await canSeeLinkedPerson(db, actor, personId, signal)))
      return err(new AppError(ERROR_IDS.CONTACT_NOT_FOUND, "draft person link not found", {}));
  }
  signal.throwIfAborted();
  return ok(null);
}
