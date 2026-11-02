import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  admitNotificationSubmission,
  notificationAdmissionContended,
} from "@/features/notifications/email/notificationAdmission";
import { guardImapConnection } from "./imapSyncGuard";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";
import { privateIntakeBlocksThread } from "./privateIntakeRestrictions";
import type { SmtpAttempt, SmtpReceipt } from "./smtpOutboxTypes";

export async function loadSmtpAttempt(
  db: Db,
  accountId: string,
  key: string,
  signal: AbortSignal,
): Promise<SmtpAttempt | undefined> {
  const result =
    await db.execute(sql`SELECT s.*,a.email_address AS from_email,a.user_id AS owner_id,
    m.id AS message_id,p.rfc_message_id AS in_reply_to,p."references" AS parent_references
    FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
    LEFT JOIN email_messages m ON m.account_id=s.account_id AND m.provider_message_id=s.provider_message_id
    LEFT JOIN LATERAL (SELECT rfc_message_id,"references" FROM email_messages
      WHERE account_id=s.account_id AND thread_id=s.thread_id
      ORDER BY sent_at DESC NULLS LAST,created_at DESC LIMIT 1) p ON true
    WHERE s.account_id=${accountId} AND s.idempotency_key=${key} AND a.provider='imap_smtp'`);
  signal.throwIfAborted();
  const row = result.rows[0] as
    | (Omit<SmtpAttempt, "claimed_at" | "send_started_at" | "sent_at"> & {
        claimed_at: string | Date | null;
        send_started_at: string | Date | null;
        sent_at: string | Date | null;
      })
    | undefined;
  if (row === undefined) return undefined;
  return {
    ...row,
    claimed_at: timestamp(row.claimed_at),
    send_started_at: timestamp(row.send_started_at),
    sent_at: timestamp(row.sent_at),
  };
}

export async function stampSmtpSubmission(
  db: Db,
  args: {
    attempt: SmtpAttempt;
    runtime: ImapConnectionRuntime;
    token: string;
    receipt: SmtpReceipt;
    signal: AbortSignal;
  },
): Promise<boolean> {
  try {
    return await db.transaction(
      async (tx) => {
        await lockMailRemoteWrites(tx, args.runtime.accountId, args.signal);
        const admission = await admitNotificationSubmission(tx, {
          accountId: args.runtime.accountId,
          attemptId: args.attempt.id,
          signal: args.signal,
        });
        if (admission !== "ordinary" && admission !== "admitted") return false;
        if (!(await guardImapConnection(tx, args.runtime, args.signal))) return false;
        const result = await tx.execute(sql`UPDATE email_send_attempts s
      SET send_started_at=now(),delivery_outcome=${JSON.stringify(args.receipt)}::jsonb
      WHERE s.id=${args.attempt.id} AND s.account_id=${args.runtime.accountId}
        AND connection_generation=${args.runtime.generation} AND claim_token=${args.token}
        AND status='sending' AND send_started_at IS NULL AND payload_prepared=true AND payload=${JSON.stringify(args.attempt.payload)}::jsonb
        AND NOT ${privateIntakeBlocksThread(sql`s.account_id`, sql`s.thread_id`)}
      RETURNING s.id`);
        if (result.rows.length === 1)
          await tx.execute(sql`UPDATE email_tracking_tokens SET disabled=false
      WHERE send_attempt_id=${args.attempt.id} AND message_id IS NULL`);
        args.signal.throwIfAborted();
        return result.rows.length === 1;
      },
      { isolationLevel: "read committed" },
    );
  } catch (error) {
    args.signal.throwIfAborted();
    // The failed NOWAIT transaction has rolled back before deferring this attempt.
    if (notificationAdmissionContended(error)) return false;
    throw error;
  }
}

export async function releaseSmtpClaim(
  db: Db,
  id: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  await db.execute(sql`UPDATE email_send_attempts SET status='failed',claim_token=NULL,claimed_at=NULL
    WHERE id=${id} AND claim_token=${token} AND send_started_at IS NULL`);
  signal.throwIfAborted();
}

export async function checkpointSmtpReceipt(
  db: Db,
  args: {
    attemptId: string;
    token: string;
    receipt: SmtpReceipt;
    retrySafe: boolean;
    signal: AbortSignal;
  },
): Promise<void> {
  const accepted = args.receipt.state === "accepted" || args.receipt.state === "partial";
  const status =
    args.receipt.state === "accepted"
      ? "sent"
      : args.receipt.state === "rejected"
        ? "failed"
        : "needs_review";
  await db.transaction(async (tx) => {
    const changed =
      await tx.execute(sql`UPDATE email_send_attempts SET status=${status}::email_send_status,
    delivery_outcome=${JSON.stringify(args.receipt)}::jsonb,
    provider_message_id=${accepted ? `smtp:${args.attemptId}` : null},
    sent_at=CASE WHEN ${accepted} THEN now() ELSE sent_at END,
    send_started_at=CASE WHEN ${args.retrySafe} THEN NULL ELSE send_started_at END,
    claim_token=NULL,claimed_at=NULL,error_id=${accepted ? null : args.retrySafe ? ERROR_IDS.MAIL_SEND_REJECTED : ERROR_IDS.MAIL_SEND_UNKNOWN}
    WHERE id=${args.attemptId} AND claim_token=${args.token} RETURNING id`);
    if (changed.rows.length === 1 && args.receipt.state === "rejected")
      await tx.execute(
        sql`UPDATE email_tracking_tokens SET disabled=true WHERE send_attempt_id=${args.attemptId}`,
      );
    args.signal.throwIfAborted();
  });
}

export async function claimSmtpAttempt(
  db: Db,
  id: string,
  signal: AbortSignal,
): Promise<string | null> {
  const token = randomUUID();
  const result = await db.execute(sql`UPDATE email_send_attempts
    SET claim_token=${token},claimed_at=now(),status='sending'
    WHERE id=${id} AND send_started_at IS NULL AND payload_prepared=true
      AND (status IN ('pending','failed') OR (status='sending' AND claimed_at < now()-(${CLAIM_LEASE_SECONDS}*interval '1 second')))
      AND (scheduled_at IS NULL OR scheduled_at<=now()) RETURNING id`);
  signal.throwIfAborted();
  return result.rows.length === 1 ? token : null;
}

function timestamp(value: string | Date | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

export async function abandonSmtpClaim(
  db: Db,
  id: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  await db.execute(sql`UPDATE email_send_attempts SET
    status=CASE WHEN send_started_at IS NULL THEN 'failed'::email_send_status ELSE 'needs_review'::email_send_status END,
    claim_token=NULL,claimed_at=NULL,
    error_id=CASE WHEN send_started_at IS NULL THEN error_id ELSE ${ERROR_IDS.MAIL_SEND_UNKNOWN} END
    WHERE id=${id} AND claim_token=${token}`);
  signal.throwIfAborted();
}
