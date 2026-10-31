import { sql } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { SendEmailOutcome } from "@/types/mail";
import { ok, type Result } from "@/types/result";
import { draftSendOutcome, PUBLIC_SEND_ATTEMPT_FIELDS } from "./draftSendOutcome";
import { disableTokens } from "./tracking";

export async function sendFailureOutcome(
  db: Db,
  args: { attemptId: string; accountId: string; signal: AbortSignal },
  error: AppError,
): Promise<Result<SendEmailOutcome, AppError>> {
  const review: SendEmailOutcome = {
    status: "needs_review",
    attemptId: args.attemptId,
    deliveryOutcome: { state: "unknown" },
  };
  try {
    const row = (
      await db.execute(sql`SELECT ${sql.raw(PUBLIC_SEND_ATTEMPT_FIELDS)} AS receipt,
      s.send_started_at,s.claim_token IS NOT NULL AS claimed FROM email_send_attempts s
      WHERE s.id=${args.attemptId} AND s.account_id=${args.accountId}`)
    ).rows[0] as
      | {
          receipt: unknown;
          send_started_at: unknown;
          claimed: boolean;
        }
      | undefined;
    args.signal.throwIfAborted();
    if (!row) return ok(review);
    const outcome = draftSendOutcome(row.receipt);
    const state = outcome?.deliveryOutcome?.state;
    if (
      row.send_started_at !== null ||
      state === "accepted" ||
      state === "partial" ||
      state === "unknown"
    )
      return ok({
        ...review,
        ...outcome,
        status: "needs_review",
        deliveryOutcome: outcome?.deliveryOutcome ?? review.deliveryOutcome,
      });
    if (row.claimed) return ok({ status: "pending", attemptId: args.attemptId });
    const changed =
      await db.execute(sql`UPDATE email_send_attempts SET status='failed',error_id=${error.id}
      WHERE id=${args.attemptId} AND account_id=${args.accountId} AND send_started_at IS NULL
        AND claim_token IS NULL AND (delivery_outcome->>'state' IS NULL OR delivery_outcome->>'state'='rejected') RETURNING id`);
    args.signal.throwIfAborted();
    if (changed.rows.length === 0) return ok({ status: "pending", attemptId: args.attemptId });
    await disableTokens(db, args.attemptId, args.signal);
    return ok({
      status: "failed",
      attemptId: args.attemptId,
      deliveryOutcome: { state: "rejected" },
    });
  } catch {
    args.signal.throwIfAborted();
    return ok(review);
  }
}
