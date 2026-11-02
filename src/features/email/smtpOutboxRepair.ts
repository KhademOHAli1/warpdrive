import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, type Result } from "@/types/result";
import { repairAcceptedSmtpCopy } from "./smtpOutboxAccepted";
import { loadSmtpAttempt } from "./smtpOutboxRepo";
import type { SmtpSendOutcome } from "./smtpOutboxTypes";

// Internal worker repair consumes a durable receipt, without reopening provider credentials or connections.
export async function repairSmtpReceipt(
  db: Db,
  args: {
    accountId: string;
    idempotencyKey: string;
    signal: AbortSignal;
  },
): Promise<Result<SmtpSendOutcome, AppError>> {
  try {
    args.signal.throwIfAborted();
    const active =
      (
        await db.execute(sql`SELECT a.id FROM email_accounts a JOIN users u ON u.id=a.user_id
      WHERE a.id=${args.accountId} AND a.provider='imap_smtp' AND u.is_active=true AND u.invited_at IS NULL`)
      ).rows.length === 1;
    args.signal.throwIfAborted();
    if (!active)
      return err(
        new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "SMTP receipt owner is unavailable"),
      );
    const attempt = await loadSmtpAttempt(db, args.accountId, args.idempotencyKey, args.signal);
    const state = attempt?.delivery_outcome?.state;
    if (attempt === undefined || (state !== "accepted" && state !== "partial"))
      return err(
        new AppError(ERROR_IDS.MAIL_SEND_UNKNOWN, "SMTP acceptance has not been established"),
      );
    return await repairAcceptedSmtpCopy(db, attempt, args.signal, true);
  } catch (error) {
    args.signal.throwIfAborted();
    return err(
      error instanceof AppError
        ? error
        : new AppError(ERROR_IDS.DB_WRITE_FAILED, "SMTP receipt repair failed"),
    );
  }
}
