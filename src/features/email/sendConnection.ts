import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Result } from "@/types/result";
import { err, ok } from "@/types/result";
import { createGmailClient, type GmailClient } from "./gmailClient";
import { makeRefresh } from "./gmailRefresh";
import { type ImapConnectionRuntime, loadImapConnection } from "./mailConnectionRuntime";
import { isFutureScheduledSend } from "./sendScheduling";
import { ensureAccessToken } from "./tokens";

interface SendConnectionArgs {
  accountId: string;
  actorId: string;
  idempotencyKey: string;
  scheduledSendAt?: Date;
  signal: AbortSignal;
}

export interface SendConnectionDeps {
  loadMail?: typeof loadImapConnection;
  resolveGmail?: (accountId: string, signal: AbortSignal) => Promise<Result<GmailClient, AppError>>;
}

export async function resolveSendConnection(
  db: Db,
  args: SendConnectionArgs,
  deps: SendConnectionDeps = {},
): Promise<
  Result<
    { gmail?: GmailClient; mail?: ImapConnectionRuntime; expectedGeneration?: number },
    AppError
  >
> {
  args.signal.throwIfAborted();
  const row = (
    await db.execute(sql`
    SELECT a.provider,a.connection_generation, EXISTS(SELECT 1 FROM email_send_attempts s
      WHERE s.account_id=a.id AND s.idempotency_key=${args.idempotencyKey}) AS existing
    FROM email_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=${args.accountId} AND a.user_id=${args.actorId} AND u.is_active=true AND u.invited_at IS NULL
      AND a.status <> 'disconnected' AND a.paused=false
      AND coalesce((a.capabilities->>'send')::boolean,true)=true
  `)
  ).rows[0] as { provider: string; existing: boolean; connection_generation: number } | undefined;
  args.signal.throwIfAborted();
  if (!row) return err(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox unavailable"));
  if (!row.existing && isFutureScheduledSend(args.scheduledSendAt, Date.now())) return ok({});
  if (row.provider === "imap_smtp") {
    const mail = await (deps.loadMail ?? loadImapConnection)(db, args.accountId, args.signal);
    return mail.ok ? ok({ mail: mail.value }) : mail;
  }
  if (row.provider !== "gmail")
    return err(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "mailbox provider cannot send"));
  const gmail = deps.resolveGmail
    ? await deps.resolveGmail(args.accountId, args.signal)
    : await defaultGmail(db, args.accountId, args.signal);
  return gmail.ok
    ? ok({ gmail: gmail.value, expectedGeneration: row.connection_generation })
    : gmail;
}

async function defaultGmail(db: Db, accountId: string, signal: AbortSignal) {
  const token = await ensureAccessToken(db, {
    accountId,
    signal,
    deps: { refresh: makeRefresh(signal) },
  });
  return token.ok ? ok(createGmailClient(token.value.token)) : token;
}
