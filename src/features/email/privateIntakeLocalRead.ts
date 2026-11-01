import { and, asc, eq, ne, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailThreads } from "@/db/schema/email";
import { emailPrivateIntake } from "@/db/schema/emailPrivateIntake";
import { emailThreadReads } from "@/db/schema/emailReads";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationReader } from "./deliveryObservationAuthority";
import { lockDeliveryObservationAccount } from "./deliveryObservationScope";

interface PrivateIntakeReadInput {
  actorId: string;
  accountId: string;
  threadId: string;
  read: boolean;
}

// A private copy has an independent local read preference. Hold current reader,
// mailbox, thread and intake authority until that preference commits. Credentials
// and remote flags are deliberately outside this transaction and this operation.
export function markPrivateIntakeLocalRead(
  db: Db,
  args: PrivateIntakeReadInput,
  signal: AbortSignal,
): Promise<Result<{ threadId: string }, AppError>> {
  signal.throwIfAborted();
  const missing = () => err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
  return db.transaction(
    async (tx) => {
      if (!(await lockDeliveryObservationReader(tx, args.actorId, signal))) return missing();
      if (!(await lockDeliveryObservationAccount(tx, args.actorId, args.accountId, signal)))
        return missing();
      const [thread] = await tx
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(and(eq(emailThreads.id, args.threadId), eq(emailThreads.accountId, args.accountId)))
        .for("share");
      signal.throwIfAborted();
      if (thread === undefined) return missing();
      const held = await tx
        .select({ id: emailPrivateIntake.id })
        .from(emailPrivateIntake)
        .where(
          and(
            eq(emailPrivateIntake.accountId, args.accountId),
            eq(emailPrivateIntake.baselineThreadId, args.threadId),
            ne(emailPrivateIntake.intakeState, "confirmed_notification"),
          ),
        )
        .orderBy(asc(emailPrivateIntake.id))
        .for("share");
      signal.throwIfAborted();
      if (held.length === 0) return missing();
      if (args.read)
        await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
          SELECT id,${args.actorId},GREATEST(clock_timestamp(),last_message_at)
          FROM email_threads WHERE id=${args.threadId} AND account_id=${args.accountId}
          ON CONFLICT (thread_id,user_id) DO UPDATE
          SET read_at=GREATEST(email_thread_reads.read_at,EXCLUDED.read_at)`);
      else
        await tx
          .delete(emailThreadReads)
          .where(
            and(
              eq(emailThreadReads.threadId, args.threadId),
              eq(emailThreadReads.userId, args.actorId),
            ),
          );
      signal.throwIfAborted();
      return ok({ threadId: args.threadId });
    },
    { isolationLevel: "read committed" },
  );
}
