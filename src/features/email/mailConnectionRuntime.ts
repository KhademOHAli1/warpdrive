import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { decryptToken } from "./crypto";
import { checkMailboxInputSchema } from "./mailConnectionSchemas";
import { resolveMailboxTransports } from "./mailConnectionTransport";
import type { createImapTransport } from "./providers/imap";
import type { createSmtpTransport } from "./providers/smtp";

export interface ImapConnectionRuntime {
  accountId: string;
  ownerId: string;
  generation: number;
  emailAddress: string;
  historyDays: number;
  folderPaths: string[];
  imap: ReturnType<typeof createImapTransport>;
  smtp: ReturnType<typeof createSmtpTransport>;
}

interface AccountRow {
  id: string;
  user_id: string;
  email_address: string;
  connection_generation: number;
  history_days: number;
  folder_paths: string[];
  credentials_enc: Buffer | null;
}

export async function loadImapConnection(
  db: Db,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<ImapConnectionRuntime, AppError>> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
    SELECT a.id, a.user_id, a.email_address, a.connection_generation, a.history_days,
      a.folder_paths, a.credentials_enc
    FROM email_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=${accountId} AND a.provider='imap_smtp' AND a.status='connected'
      AND a.paused=false AND u.is_active=true AND u.invited_at IS NULL
  `)
  ).rows[0] as AccountRow | undefined;
  signal.throwIfAborted();
  if (row === undefined || row.credentials_enc === null)
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox unavailable", { accountId }),
    );
  const decrypted = decryptToken(row.credentials_enc);
  if (!decrypted.ok)
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_INVALID, "mailbox credential data unavailable", {
        accountId,
      }),
    );
  let decoded: unknown;
  try {
    decoded = JSON.parse(decrypted.value);
  } catch {
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_INVALID, "mailbox credential data invalid", {
        accountId,
      }),
    );
  }
  const parsed = checkMailboxInputSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.emailAddress.toLowerCase() !== row.email_address.toLowerCase())
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_INVALID, "mailbox credential identity mismatch", {
        accountId,
      }),
    );
  const transports = await resolveMailboxTransports(parsed.data, signal);
  if (!transports.ok)
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox endpoint unavailable", {
        accountId,
        reason: transports.error,
      }),
    );
  if (
    !(await isMailConnectionCurrent(
      db,
      { accountId: row.id, ownerId: row.user_id, generation: row.connection_generation },
      signal,
    ))
  )
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed while resolving endpoint", {
        accountId,
      }),
    );
  return ok({
    accountId: row.id,
    ownerId: row.user_id,
    generation: row.connection_generation,
    emailAddress: row.email_address,
    historyDays: row.history_days,
    folderPaths: row.folder_paths,
    imap: transports.value.imap,
    smtp: transports.value.smtp,
  });
}

export async function isMailConnectionCurrent(
  db: Db,
  runtime: Pick<ImapConnectionRuntime, "accountId" | "ownerId" | "generation">,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
    SELECT a.id FROM email_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=${runtime.accountId} AND a.user_id=${runtime.ownerId}
      AND a.connection_generation=${runtime.generation} AND a.status='connected'
      AND a.paused=false AND u.is_active=true AND u.invited_at IS NULL
  `)
  ).rows[0];
  signal.throwIfAborted();
  return row !== undefined;
}
