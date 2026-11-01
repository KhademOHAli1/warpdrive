import { sql } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { ok, type Result } from "@/types/result";
import { storeNotificationGmailCopy } from "./notificationGmailCopy";
import { notificationGmailAckMatches } from "./notificationGmailReceipt";

// A canonical API receipt is sufficient for local repair. Credential resolution
// would make an already accepted message depend on a live provider connection.
export async function repairKnownNotificationGmail(
  db: Db,
  args: { accountId: string; idempotencyKey: string; signal: AbortSignal },
): Promise<Result<{ status: "sent" }, AppError> | null> {
  args.signal.throwIfAborted();
  const receipt = (
    await db.execute(sql`SELECT s.gmail_message_id FROM email_send_attempts s
      JOIN email_accounts a ON a.id=s.account_id
      WHERE s.account_id=${args.accountId} AND s.idempotency_key=${args.idempotencyKey}
        AND s.status='sent' AND ${notificationGmailAckMatches()}`)
  ).rows[0] as { gmail_message_id: string } | undefined;
  args.signal.throwIfAborted();
  if (receipt === undefined) return null;
  const copied = await storeNotificationGmailCopy(db, {
    ...args,
    gmailMessageId: receipt.gmail_message_id,
  });
  return copied.ok ? ok({ status: "sent" }) : copied;
}
