import { sql } from "drizzle-orm";
import type { EMAIL_ACCOUNT_STATUS } from "@/constants/email";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";

// Confirm a mailbox belongs to the actor BEFORE any token decrypt/refresh side effect
// (Codex finding F5). A missing account and a non-owned account return the SAME error so
// a caller cannot probe which account ids exist. Mirrors the ownership check inside
// runSend (send.ts) but runs first, in the action, ahead of ensureAccessToken.
// Existing callers use the default sender, with a deterministic legacy fallback.
export async function getActorMailbox(
  db: Db,
  actorId: string,
  signal: AbortSignal,
): Promise<{ id: string; emailAddress: string } | null> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
      SELECT id, email_address FROM email_accounts WHERE user_id=${actorId}
      ORDER BY (status='connected' AND NOT paused AND coalesce((capabilities->>'send')::boolean,true)) DESC,
        is_default DESC, created_at, id LIMIT 1
    `)
  ).rows[0] as { id: string; email_address: string } | undefined;
  if (row === undefined) return null;
  return { id: row.id, emailAddress: row.email_address };
}

type MailboxStatus = (typeof EMAIL_ACCOUNT_STATUS)[number];

export interface ActorMailboxStatus {
  id: string;
  emailAddress: string;
  status: MailboxStatus;
  lastSyncAt: Date | null;
  lastErrorId: string | null;
}

// Read the actor's Gmail mailbox for Gmail-specific connection controls.
// Filter the provider before default ordering so an IMAP default cannot supply the card.
// Token bytes stay out of the projection.
export async function getActorGmailMailboxStatus(
  db: Db,
  actorId: string,
  signal: AbortSignal,
): Promise<ActorMailboxStatus | null> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
      SELECT id, email_address, status, last_sync_at, last_error_id
      FROM email_accounts WHERE user_id=${actorId} AND provider='gmail'
      ORDER BY is_default DESC, created_at, id LIMIT 1
    `)
  ).rows[0] as
    | {
        id: string;
        email_address: string;
        status: MailboxStatus;
        last_sync_at: string | Date | null;
        last_error_id: string | null;
      }
    | undefined;
  if (row === undefined) return null;
  // Raw SQL returns timestamptz as a string; normalize to Date at this boundary (mirrors
  // dealRepo / resync). Callers get the Date | null contract the type promises.
  const lastSyncAt = row.last_sync_at === null ? null : new Date(row.last_sync_at);
  return {
    id: row.id,
    emailAddress: row.email_address,
    status: row.status,
    lastSyncAt,
    lastErrorId: row.last_error_id,
  };
}

export async function assertMailboxOwner(
  db: Db,
  accountId: string,
  actorId: string,
  signal: AbortSignal,
): Promise<Result<{ emailAddress: string }, AppError>> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`SELECT user_id, email_address FROM email_accounts WHERE id=${accountId}`)
  ).rows[0] as { user_id: string; email_address: string } | undefined;
  if (row === undefined || row.user_id !== actorId) {
    return err(new AppError(ERROR_IDS.PERM_DENIED, "not allowed to use this mailbox", {}));
  }
  return ok({ emailAddress: row.email_address });
}

// Confirm a signature belongs to the actor. Missing and not-owned return the same error
// so a caller cannot probe which signature ids exist.
export async function assertSignatureOwner(
  db: DbOrTx,
  signatureId: string,
  actorId: string,
  signal: AbortSignal,
): Promise<Result<{ bodyHtml: string }, AppError>> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`SELECT user_id, body_html FROM signatures WHERE id=${signatureId}`)
  ).rows[0] as { user_id: string; body_html: string } | undefined;
  if (row === undefined || row.user_id !== actorId) {
    return err(
      new AppError(
        ERROR_IDS.PERM_SIGNATURE_DENIED,
        "signature not found or not owned by actor",
        {},
      ),
    );
  }
  return ok({ bodyHtml: row.body_html });
}
