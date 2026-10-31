import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { readGmailConnection, withGmailConnection } from "./gmailConnectionFence";

export async function isGmailSendCurrent(
  db: Db,
  accountId: string,
  generation: number | null | undefined,
  signal: AbortSignal,
  expectedGeneration?: number,
): Promise<boolean> {
  if (generation == null) return false;
  if (expectedGeneration !== undefined && generation !== expectedGeneration) return false;
  return (await readGmailConnection(db, accountId, signal, generation)) !== null;
}

export async function stampGmailSend(
  db: Db,
  attemptId: string,
  token: string,
  signal: AbortSignal,
  expectedGeneration?: number,
): Promise<boolean> {
  signal.throwIfAborted();
  const attempt = (
    await db.execute(
      sql`SELECT account_id,connection_generation FROM email_send_attempts WHERE id=${attemptId}`,
    )
  ).rows[0] as { account_id: string; connection_generation: number | null } | undefined;
  if (
    !attempt ||
    attempt.connection_generation === null ||
    (expectedGeneration !== undefined && expectedGeneration !== attempt.connection_generation)
  )
    return false;
  const result = await withGmailConnection(
    db,
    attempt.account_id,
    attempt.connection_generation,
    signal,
    async (tx) => {
      const stamped = await tx.execute(sql`UPDATE email_send_attempts s SET send_started_at=now()
      FROM email_accounts a WHERE s.id=${attemptId} AND s.claim_token=${token} AND s.send_started_at IS NULL
        AND s.payload_prepared=true AND s.account_id=a.id AND s.connection_generation=a.connection_generation
        AND coalesce((a.capabilities->>'send')::boolean,true)=true RETURNING s.id`);
      if (stamped.rows.length === 1)
        await tx.execute(sql`UPDATE email_tracking_tokens SET disabled=false
        WHERE send_attempt_id=${attemptId} AND message_id IS NULL`);
      return stamped.rows.length === 1;
    },
  );
  return result.ok && result.value;
}

export async function releaseUnsubmittedGmailClaim(
  db: Db,
  id: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  await db.execute(sql`UPDATE email_send_attempts SET claim_token=NULL,claimed_at=NULL,status='failed'
    WHERE id=${id} AND claim_token=${token} AND send_started_at IS NULL`);
  signal.throwIfAborted();
}
