import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export async function refreshImapThreadReadState(
  tx: DbOrTx,
  accountId: string,
  ownerId: string,
  threadIds: string[],
  signal: AbortSignal,
): Promise<void> {
  for (const threadId of new Set(threadIds)) {
    const [state] = (
      await tx.execute(sql`
      SELECT t.id,t.last_message_at,
        EXISTS(SELECT 1 FROM email_messages m JOIN mail_message_locators l
          ON l.message_id=m.id AND l.account_id=m.account_id
          WHERE m.thread_id=t.id AND m.account_id=${accountId} AND l.active=true) AS active,
        EXISTS(SELECT 1 FROM email_messages m JOIN mail_message_locators l
          ON l.message_id=m.id AND l.account_id=m.account_id
          WHERE m.thread_id=t.id AND m.account_id=${accountId} AND l.active=true AND m.direction='inbound'
            AND NOT EXISTS(SELECT 1 FROM unnest(l.flags) flag WHERE lower(flag)=lower(${"\\Seen"}))) AS unread
      FROM email_threads t WHERE t.id=${threadId} AND t.account_id=${accountId}
    `)
    ).rows as { id: string; last_message_at: Date | null; active: boolean; unread: boolean }[];
    signal.throwIfAborted();
    if (state === undefined) continue;
    await tx.execute(sql`UPDATE email_threads SET trashed_at=CASE WHEN remote_trashed_at IS NOT NULL
      THEN COALESCE(trashed_at,remote_trashed_at) ELSE ${state.active ? null : new Date()}::timestamptz END,updated_at=now()
      WHERE id=${threadId} AND account_id=${accountId}`);
    if (state.active && state.unread)
      await tx.execute(
        sql`DELETE FROM email_thread_reads WHERE thread_id=${threadId} AND user_id=${ownerId}`,
      );
    else if (state.active)
      await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
        VALUES (${threadId},${ownerId},GREATEST(now(),${state.last_message_at}))
        ON CONFLICT (thread_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at`);
    signal.throwIfAborted();
  }
}
