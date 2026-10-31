import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { SmtpAttempt } from "./smtpOutboxTypes";

export async function guardSmtpReceiptOwner(
  tx: DbOrTx,
  attempt: SmtpAttempt,
  signal: AbortSignal,
): Promise<boolean> {
  const owner = (
    await tx.execute(
      sql`SELECT is_active FROM users WHERE id=${attempt.owner_id} FOR NO KEY UPDATE`,
    )
  ).rows[0] as { is_active: boolean } | undefined;
  signal.throwIfAborted();
  if (owner?.is_active !== true) return false;
  const account = await tx.execute(sql`SELECT id FROM email_accounts WHERE id=${attempt.account_id}
    AND user_id=${attempt.owner_id} AND provider='imap_smtp' FOR NO KEY UPDATE`);
  signal.throwIfAborted();
  return account.rows.length === 1;
}
