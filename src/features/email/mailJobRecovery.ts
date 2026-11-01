import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import {
  EMAIL_JOB_RETRY_LIMIT,
  PGBOSS_QUEUE_EMAIL_SEND,
  PGBOSS_QUEUE_EMAIL_SYNC,
} from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { recoverNotificationMailJobs } from "./mailNotificationRecovery";
import { MAIL_RECEIPT_REPAIR_LIMIT, MAIL_RECOVERY_BATCH_SIZE } from "./mailRecoveryPolicy";

type Queue = Pick<PgBoss, "send">;
interface SendCandidate {
  id: string;
  account_id: string;
  idempotency_key: string;
  scheduled_at: string | null;
  repair: boolean;
}

export async function recoverMailJobs(
  db: Db,
  boss: Queue,
  signal: AbortSignal,
): Promise<{ syncQueued: number; sendQueued: number }> {
  return db.transaction(async (tx) => {
    signal.throwIfAborted();
    // Serialize this short local queue-repair pass across worker processes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('email.job-recovery'),0)`);
    const syncs = (
      await tx.execute(sql`SELECT a.id FROM email_accounts a JOIN users u ON u.id=a.user_id
      WHERE u.is_active AND u.invited_at IS NULL AND NOT a.paused AND a.status<>'disconnected'
        AND a.provider IN ('gmail','imap_smtp') AND NOT EXISTS(SELECT 1 FROM pgboss.job j
          WHERE j.name=${PGBOSS_QUEUE_EMAIL_SYNC} AND j.state IN ('created','retry','active')
            AND j.data->>'accountId'=a.id::text)
      ORDER BY a.created_at,a.id LIMIT ${MAIL_RECOVERY_BATCH_SIZE}`)
    ).rows as { id: string }[];
    let syncQueued = 0;
    for (const row of syncs) {
      signal.throwIfAborted();
      const id = await boss.send(
        PGBOSS_QUEUE_EMAIL_SYNC,
        { accountId: row.id },
        { singletonKey: row.id, retryLimit: EMAIL_JOB_RETRY_LIMIT, retryBackoff: true },
      );
      if (id !== null) syncQueued += 1;
    }
    const sends = (
      await tx.execute(sql`SELECT s.id,s.account_id,s.idempotency_key,s.scheduled_at,
      s.delivery_outcome->>'state' IN ('accepted','partial') AS repair
      FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id JOIN users u ON u.id=a.user_id
      WHERE u.is_active AND u.invited_at IS NULL AND a.provider IN ('gmail','imap_smtp')
        AND NOT (s.payload ? 'systemPurpose') AND s.notification_suppressed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name=${PGBOSS_QUEUE_EMAIL_SEND}
          AND j.state IN ('created','retry','active') AND j.data->>'accountId'=s.account_id::text
          AND j.data->>'idempotencyKey'=s.idempotency_key::text)
        AND ((a.provider='imap_smtp' AND s.delivery_outcome->>'state' IN ('accepted','partial')
          AND s.provider_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM email_messages m
            WHERE m.account_id=s.account_id AND m.provider_message_id=s.provider_message_id)
          AND coalesce((s.delivery_outcome->'repair'->>'attempts')::int,0)<${MAIL_RECEIPT_REPAIR_LIMIT}
          AND coalesce((s.delivery_outcome->'repair'->>'nextAt')::timestamptz,'-infinity'::timestamptz)<=now())
        OR (a.provider='gmail' AND a.status<>'disconnected' AND NOT a.paused
          AND s.connection_generation=a.connection_generation AND s.gmail_message_id IS NULL
          AND s.send_started_at IS NOT NULL AND s.status IN ('sending','failed'))
        OR (a.status<>'disconnected' AND NOT a.paused AND coalesce((a.capabilities->>'send')::boolean,true)
          AND s.send_started_at IS NULL AND (s.delivery_outcome->>'state' IS NULL OR s.delivery_outcome->>'state'='rejected') AND (s.status='pending' OR
            (s.status='sending' AND s.claimed_at<now()-(${CLAIM_LEASE_SECONDS}*interval '1 second')))))
      ORDER BY s.created_at,s.id LIMIT ${MAIL_RECOVERY_BATCH_SIZE}`)
    ).rows as unknown as SendCandidate[];
    let sendQueued = await recoverNotificationMailJobs(tx, boss, signal);
    for (const row of sends) {
      signal.throwIfAborted();
      if (row.repair)
        await tx.execute(sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(delivery_outcome,'{repair}',
        jsonb_build_object('attempts',coalesce((delivery_outcome->'repair'->>'attempts')::int,0)+1,
          'nextAt',now()+(60*power(2,coalesce((delivery_outcome->'repair'->>'attempts')::int,0)))*interval '1 second')) WHERE id=${row.id}`);
      else
        await tx.execute(sql`UPDATE email_send_attempts SET status='pending',claim_token=NULL,claimed_at=NULL
        WHERE id=${row.id} AND send_started_at IS NULL AND status='sending'
          AND claimed_at<now()-(${CLAIM_LEASE_SECONDS}*interval '1 second')`);
      const id = await boss.send(
        PGBOSS_QUEUE_EMAIL_SEND,
        { accountId: row.account_id, idempotencyKey: row.idempotency_key },
        {
          startAfter: !row.repair && row.scheduled_at !== null ? new Date(row.scheduled_at) : 0,
          singletonKey: row.idempotency_key,
          retryLimit: EMAIL_JOB_RETRY_LIMIT,
          retryBackoff: true,
        },
      );
      if (id !== null) sendQueued += 1;
    }
    signal.throwIfAborted();
    return { syncQueued, sendQueued };
  });
}
