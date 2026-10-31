import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import type { MailboxConnectionView } from "./connections/types";
import {
  publicMailboxCapabilities,
  publicMailboxError,
  publicMailboxFolders,
  publicMailboxProgress,
  publicMailboxSettings,
  publicMailboxStatus,
  publicRevocationStatus,
} from "./mailConnectionHttpView";

interface MailboxRow {
  id: string;
  email_address: string;
  provider: "gmail" | "imap_smtp";
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  paused: boolean;
  is_default: boolean;
  last_sync_at: Date | string | null;
  capabilities: unknown;
  progress: unknown;
  history_days: number;
  folder_paths: unknown;
  connection_settings: unknown;
  revocation_status: string | null;
  last_error_id: string | null;
  folder_error_kind: string | null;
}

export async function listActorMailboxes(
  db: Db,
  actorId: string,
  signal: AbortSignal,
): Promise<MailboxConnectionView[]> {
  signal.throwIfAborted();
  const rows = (
    await db.execute(sql`
    SELECT a.id, a.email_address, a.provider, a.display_name, a.status, a.paused, a.is_default,
      a.last_sync_at, a.capabilities, a.history_days, a.folder_paths, a.connection_settings,
      r.status AS revocation_status, a.last_error_id, f.last_error_kind AS folder_error_kind,p.progress
    FROM email_accounts a LEFT JOIN auth_integration_revocations r
      ON r.id::text=a.connection_settings->>'remoteRevocationId' AND r.user_id=a.user_id AND r.provider='google'
    LEFT JOIN LATERAL (SELECT last_error_kind FROM mail_folders WHERE account_id=a.id AND last_error_kind IS NOT NULL ORDER BY updated_at DESC LIMIT 1) f ON true
    LEFT JOIN LATERAL (SELECT jsonb_build_object('processed',count(*),'skipped',count(*) FILTER(WHERE l.skipped_reason IS NOT NULL),
      'skipReasons',jsonb_build_object('messageTooLarge',count(*) FILTER(WHERE l.skipped_reason='message_too_large'),
        'invalidMessage',count(*) FILTER(WHERE l.skipped_reason='invalid_message'),
        'messageMissing',count(*) FILTER(WHERE l.skipped_reason='message_missing'))) AS progress
      FROM mail_message_locators l JOIN mail_folders mf ON mf.id=l.folder_id AND mf.account_id=l.account_id
      WHERE l.account_id=a.id AND l.uid_validity=mf.uid_validity
        AND mf.path IN (SELECT jsonb_array_elements_text(a.folder_paths))) p ON true
    WHERE a.user_id=${actorId}
    ORDER BY a.is_default DESC, a.created_at, a.id
  `)
  ).rows as unknown as MailboxRow[];
  signal.throwIfAborted();
  return rows.map((row) => ({
    id: row.id,
    emailAddress: row.email_address,
    provider: row.provider,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    status: publicMailboxStatus(
      row.status,
      row.paused,
      publicMailboxError(row.last_error_id, row.folder_error_kind, row.status),
    ),
    errorCode: publicMailboxError(row.last_error_id, row.folder_error_kind, row.status),
    isDefault: row.is_default,
    lastSyncAtIso: row.last_sync_at === null ? null : new Date(row.last_sync_at).toISOString(),
    capabilities: publicMailboxCapabilities(row.capabilities),
    ...(row.provider === "imap_smtp" ? { syncProgress: publicMailboxProgress(row.progress) } : {}),
    historyDays: row.history_days,
    folderPaths: publicMailboxFolders(row.folder_paths),
    ...publicMailboxSettings(row.connection_settings),
    remoteRevocationStatus: publicRevocationStatus(row.provider, row.status, row.revocation_status),
  }));
}

export async function selectDefaultMailbox(
  db: Db,
  actorId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<void, AppError>> {
  return db.transaction(async (tx) => {
    signal.throwIfAborted();
    await tx.execute(sql`SELECT id FROM users WHERE id=${actorId} FOR NO KEY UPDATE`);
    const row = (
      await tx.execute(sql`
      SELECT id FROM email_accounts
      WHERE id=${accountId} AND user_id=${actorId} AND status <> 'disconnected'
      FOR NO KEY UPDATE
    `)
    ).rows[0];
    if (row === undefined)
      return err(new AppError(ERROR_IDS.PERM_DENIED, "mailbox unavailable", {}));
    await tx.execute(
      sql`UPDATE email_accounts SET is_default=false WHERE user_id=${actorId} AND is_default=true`,
    );
    await tx.execute(
      sql`UPDATE email_accounts SET is_default=true, updated_at=now() WHERE id=${accountId}`,
    );
    signal.throwIfAborted();
    return ok(undefined);
  });
}

export async function disconnectMailbox(
  db: Db,
  actorId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<void, AppError>> {
  return db.transaction(async (tx) => {
    signal.throwIfAborted();
    await tx.execute(sql`SELECT id FROM users WHERE id=${actorId} FOR NO KEY UPDATE`);
    const row = (
      await tx.execute(sql`
      SELECT id,provider,refresh_token_enc,is_default FROM email_accounts
      WHERE id=${accountId} AND user_id=${actorId} FOR NO KEY UPDATE
    `)
    ).rows[0] as
      | { id: string; provider: string; refresh_token_enc: Buffer | null; is_default: boolean }
      | undefined;
    if (row === undefined)
      return err(new AppError(ERROR_IDS.PERM_DENIED, "mailbox unavailable", {}));
    let remoteId: string | null = null;
    if (row.provider === "gmail" && row.refresh_token_enc !== null) {
      const revoke = (
        await tx.execute(sql`
        INSERT INTO auth_integration_revocations(user_id,provider,token_enc)
        VALUES(${actorId},'google',${row.refresh_token_enc}) RETURNING id
      `)
      ).rows[0] as { id: string } | undefined;
      if (revoke === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "mailbox revocation unavailable", {});
      remoteId = revoke.id;
    }
    await tx.execute(sql`
      UPDATE email_accounts SET status='disconnected', paused=false, is_default=false,
        credentials_enc=NULL,refresh_token_enc=NULL,watch_expires_at=NULL,
        connection_generation=connection_generation+1,credential_version=credential_version+1,
        connection_settings=CASE WHEN ${remoteId}::text IS NULL THEN connection_settings ELSE
          jsonb_set(COALESCE(connection_settings,'{}'::jsonb),'{remoteRevocationId}',to_jsonb(${remoteId}::text)) END,
        updated_at=now() WHERE id=${accountId} AND user_id=${actorId}
    `);
    if (row.is_default) {
      const next = (
        await tx.execute(sql`
        SELECT id FROM email_accounts WHERE user_id=${actorId} AND status='connected' AND NOT paused
          AND capabilities->'send'='true'::jsonb
        ORDER BY created_at,id LIMIT 1 FOR NO KEY UPDATE
      `)
      ).rows[0] as { id: string } | undefined;
      if (next !== undefined)
        await tx.execute(
          sql`UPDATE email_accounts SET is_default=true,updated_at=now() WHERE id=${next.id}`,
        );
    }
    signal.throwIfAborted();
    return ok(undefined);
  });
}
