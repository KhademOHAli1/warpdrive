import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import { EMAIL_JOB_RETRY_LIMIT, EMAIL_NOTIFICATION_QUEUE } from "@/constants/jobNames";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { MAIL_RECEIPT_REPAIR_LIMIT, MAIL_RECOVERY_BATCH_SIZE } from "./mailRecoveryPolicy";
import { notificationGmailAckMatches } from "./notificationGmailReceipt";

interface NotificationRecoveryRow {
  id: string;
  notification_id: string;
  repair: boolean;
}

// Use the same immutable intent and notification consumer after a lost queue job.
// The consumer rechecks opt-out/visibility and owns the final emailed marker.
export async function recoverNotificationMailJobs(
  tx: DbOrTx,
  boss: Pick<PgBoss, "send">,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  const rows = (
    await tx.execute(sql`SELECT s.id,s.idempotency_key AS notification_id,
      a.provider='imap_smtp' AND s.delivery_outcome->>'state'='accepted' AS repair
      FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
      LEFT JOIN notifications n ON n.id=s.idempotency_key
      WHERE a.provider IN ('gmail','imap_smtp') AND s.thread_id IS NULL
        AND s.notification_suppressed_at IS NULL
        AND s.payload->'systemPurpose'=jsonb_build_object('version',1,'kind','notification',
          'notificationId',s.idempotency_key::text,'recipientUserId',a.user_id::text)
        AND (n.id IS NULL OR (n.user_id=a.user_id AND n.email_sent_at IS NULL))
        AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name=${EMAIL_NOTIFICATION_QUEUE}
          AND j.state IN ('created','retry','active')
          AND j.data->>'notificationId'=s.idempotency_key::text)
        AND ((s.send_started_at IS NULL
          AND (s.delivery_outcome IS NULL OR s.delivery_outcome->>'state'='rejected')
          AND (s.status='pending' OR (s.status='sending'
            AND s.claimed_at<now()-(${CLAIM_LEASE_SECONDS}*interval '1 second'))))
          OR (s.status='sent' AND ${notificationGmailAckMatches()})
          OR (a.provider='gmail' AND s.gmail_message_id IS NULL AND s.send_started_at IS NOT NULL
            AND s.status IN ('sending','failed'))
          OR (a.provider='imap_smtp' AND s.delivery_outcome->>'state'='accepted'
            AND coalesce((s.delivery_outcome->'repair'->>'attempts')::int,0)<${MAIL_RECEIPT_REPAIR_LIMIT}
            AND coalesce((s.delivery_outcome->'repair'->>'nextAt')::timestamptz,'-infinity'::timestamptz)<=now()))
      ORDER BY s.created_at,s.id LIMIT ${MAIL_RECOVERY_BATCH_SIZE}`)
  ).rows as unknown as NotificationRecoveryRow[];
  signal.throwIfAborted();
  let queued = 0;
  for (const row of rows) {
    signal.throwIfAborted();
    if (row.repair)
      await tx.execute(sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(delivery_outcome,'{repair}',
        jsonb_build_object('attempts',coalesce((delivery_outcome->'repair'->>'attempts')::int,0)+1,
          'nextAt',now()+(60*power(2,coalesce((delivery_outcome->'repair'->>'attempts')::int,0)))*interval '1 second'))
        WHERE id=${row.id}`);
    const id = await boss.send(
      EMAIL_NOTIFICATION_QUEUE,
      { notificationId: row.notification_id },
      {
        singletonKey: row.notification_id,
        retryLimit: EMAIL_JOB_RETRY_LIMIT,
        retryBackoff: true,
      },
    );
    signal.throwIfAborted();
    if (id !== null) queued += 1;
  }
  return queued;
}
