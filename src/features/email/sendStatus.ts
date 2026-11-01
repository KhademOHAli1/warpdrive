import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { SendEmailOutcome } from "@/types/mail";
import { err, ok, type Result } from "@/types/result";
import { draftSendOutcome, PUBLIC_SEND_ATTEMPT_FIELDS } from "./draftSendOutcome";
import { repairSmtpReceipt } from "./smtpOutbox";

export interface SendStatusArgs {
  actorId: string;
  accountId: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export async function readOwnedSendStatus(
  db: Db,
  args: SendStatusArgs,
): Promise<Result<{ outcome: SendEmailOutcome; provider: string } | null, AppError>> {
  args.signal.throwIfAborted();
  const row = (
    await db.execute(sql`SELECT a.provider,${sql.raw(PUBLIC_SEND_ATTEMPT_FIELDS)} AS receipt
    FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
    JOIN users u ON u.id=a.user_id WHERE s.account_id=${args.accountId}
      AND s.idempotency_key=${args.idempotencyKey} AND a.user_id=${args.actorId}
      AND u.is_active=true AND u.invited_at IS NULL`)
  ).rows[0] as { provider: string; receipt: unknown } | undefined;
  args.signal.throwIfAborted();
  if (!row) return ok(null);
  let outcome = draftSendOutcome(row.receipt);
  if (!outcome) return err(new AppError(ERROR_IDS.DB_WRITE_FAILED, "send receipt unavailable"));
  if (
    row.provider === "imap_smtp" &&
    outcome.messageId === undefined &&
    (outcome.deliveryOutcome?.state === "accepted" || outcome.deliveryOutcome?.state === "partial")
  ) {
    const repaired = await repairSmtpReceipt(db, args);
    if (repaired.ok) outcome = { ...repaired.value, attemptId: outcome.attemptId };
  }
  return ok({ outcome, provider: row.provider });
}
