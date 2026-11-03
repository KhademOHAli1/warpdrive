import { sql } from "drizzle-orm";
import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withPrivateIntakeLocalReadLocks } from "./privateIntakeLocalReadLock";
import type { ReadIntentRemoteDispatch } from "./readIntentRemoteReceipt";
import {
  finishReadIntent,
  lockReadIntent,
  readIntentReceipt,
  sameReadIntentBinding,
} from "./readIntentStore";
import type { ReadIntentReceipt } from "./readIntentTypes";

// Only the server claimant possesses this token. Recording an observation can
// outlive request cancellation/revocation; it does not authorize a provider retry
// or a new marker write. Failed recording leaves the durable admission unresolved.
export async function recordReadIntentRemoteFailure(
  db: Db,
  dispatch: ReadIntentRemoteDispatch,
  errorId: ErrorId,
  attempted: boolean,
): Promise<ReadIntentReceipt | null> {
  const signal = AbortSignal.timeout(2000);
  try {
    return await withPrivateIntakeLocalReadLocks(db, signal, async (tx) => {
      const { binding } = dispatch;
      await tx.execute(sql`SELECT id FROM users WHERE id=${binding.actorId} FOR SHARE`);
      await tx.execute(sql`SELECT id FROM email_accounts WHERE id=${binding.accountId} FOR SHARE`);
      await tx.execute(sql`SELECT id FROM email_threads
        WHERE id=${binding.threadId} AND account_id=${binding.accountId} FOR SHARE`);
      signal.throwIfAborted();
      const intent = await lockReadIntent(tx, dispatch.key, signal);
      if (
        intent === null ||
        intent.dispatchClaim !== dispatch.claim ||
        !sameReadIntentBinding(intent, binding)
      )
        return null;
      if (intent.state !== "admitted") return readIntentReceipt(intent);
      const disposition = attempted
        ? {
            state: "unknown" as const,
            errorId:
              errorId === ERROR_IDS.MAIL_WRITE_PARTIAL
                ? ERROR_IDS.MAIL_WRITE_PARTIAL
                : ERROR_IDS.MAIL_WRITE_UNKNOWN,
          }
        : { state: "denied" as const, errorId };
      const finished = await finishReadIntent(
        tx,
        dispatch.key,
        dispatch.claim,
        disposition,
        signal,
      );
      return finished === null ? null : readIntentReceipt(finished);
    });
  } catch {
    return null;
  }
}
