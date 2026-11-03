import { and, asc, eq, ne, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { emailThreads } from "@/db/schema/email";
import { emailPrivateIntake } from "@/db/schema/emailPrivateIntake";
import { emailThreadReads } from "@/db/schema/emailReads";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ReadIntentBinding } from "./readIntentTypes";

// The caller has locked the session and scope parents. Lock every held ledger
// row before the operation row, so canonical confirmation cannot race a marker.
export async function lockReadIntentPrivateRows(
  tx: DbOrTx,
  binding: ReadIntentBinding,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (!binding.privateCopy) return true;
  const held = await tx
    .select({ id: emailPrivateIntake.id })
    .from(emailPrivateIntake)
    .where(
      and(
        eq(emailPrivateIntake.accountId, binding.accountId),
        eq(emailPrivateIntake.baselineThreadId, binding.threadId),
        ne(emailPrivateIntake.intakeState, "confirmed_notification"),
      ),
    )
    .orderBy(asc(emailPrivateIntake.id))
    .for("share");
  signal.throwIfAborted();
  return held.length > 0;
}

// This leaf never opens a transaction. Admission, marker and applied receipt
// must commit together in the transaction that owns the parent/evidence locks.
export async function applyReadIntentLocalMarker(
  tx: DbOrTx,
  binding: ReadIntentBinding,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (binding.readMode !== "local")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Remote read cannot use a local marker");
  if (!binding.desiredRead) {
    await tx
      .delete(emailThreadReads)
      .where(
        and(
          eq(emailThreadReads.threadId, binding.threadId),
          eq(emailThreadReads.userId, binding.actorId),
        ),
      );
  } else if (binding.privateCopy) {
    // Keep the private-intake statement and database-clock watermark semantics.
    await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
        SELECT id,${binding.actorId},GREATEST(clock_timestamp(),last_message_at)
        FROM email_threads WHERE id=${binding.threadId} AND account_id=${binding.accountId}
        ON CONFLICT (thread_id,user_id) DO UPDATE
        SET read_at=GREATEST(email_thread_reads.read_at,EXCLUDED.read_at)`);
  } else {
    const readAt = sql`GREATEST(now(), (SELECT ${emailThreads.lastMessageAt}
      FROM ${emailThreads} WHERE ${emailThreads.id}=${binding.threadId}))`;
    await tx
      .insert(emailThreadReads)
      .values({ threadId: binding.threadId, userId: binding.actorId, readAt })
      .onConflictDoUpdate({
        target: [emailThreadReads.threadId, emailThreadReads.userId],
        set: { readAt: sql`GREATEST(${emailThreadReads.readAt}, EXCLUDED.read_at)` },
      });
  }
  signal.throwIfAborted();
}
