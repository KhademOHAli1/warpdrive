import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import type { SendPayload } from "./outboxClaim";
import { applyTrackingAndSignature } from "./sendHelpers";

// Preparing the durable snapshot is one transaction. Workers cannot claim it
// until the signature, tracking tokens and prepared body have all committed.
export async function prepareEnqueuedSend(
  db: Db,
  args: { attemptId: string; actorId: string; signal: AbortSignal },
): Promise<Result<{ body: string; scheduledAt: Date | null }, AppError>> {
  try {
    return await db.transaction(async (tx) => {
      args.signal.throwIfAborted();
      const row = (
        await tx.execute(sql`
        SELECT s.payload,s.payload_prepared,s.send_started_at,s.scheduled_at
        FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
        JOIN users u ON u.id=a.user_id
        WHERE s.id=${args.attemptId} AND a.user_id=${args.actorId} AND u.is_active=true AND u.invited_at IS NULL
        FOR UPDATE OF s
      `)
      ).rows[0] as
        | {
            payload: SendPayload;
            payload_prepared: boolean;
            send_started_at: unknown;
            scheduled_at: string | Date | null;
          }
        | undefined;
      args.signal.throwIfAborted();
      if (!row)
        return err(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "send attempt unavailable"));
      const scheduledAt = row.scheduled_at === null ? null : new Date(row.scheduled_at);
      if (row.payload_prepared) return ok({ body: row.payload.html, scheduledAt });
      if (row.send_started_at !== null)
        throw new AppError(
          ERROR_IDS.MAIL_SEND_UNKNOWN,
          "unprepared submitted attempt requires review",
        );
      const body = await applyTrackingAndSignature(tx, {
        attemptId: args.attemptId,
        actorId: args.actorId,
        signal: args.signal,
        sanitizedBody: row.payload.html,
        signatureId: row.payload.signatureId,
        trackOpens: row.payload.trackOpens ?? row.payload.trackingEnabled ?? false,
        trackLinks: row.payload.trackLinks ?? row.payload.trackingEnabled ?? false,
        recipient: row.payload.to[0] ?? "",
      });
      if (!body.ok) throw body.error;
      await tx.execute(
        sql`UPDATE email_send_attempts SET payload_prepared=true WHERE id=${args.attemptId}`,
      );
      args.signal.throwIfAborted();
      return ok({ body: body.value, scheduledAt });
    });
  } catch (error) {
    args.signal.throwIfAborted();
    return err(
      error instanceof AppError
        ? error
        : new AppError(ERROR_IDS.DB_WRITE_FAILED, "send preparation failed"),
    );
  }
}
