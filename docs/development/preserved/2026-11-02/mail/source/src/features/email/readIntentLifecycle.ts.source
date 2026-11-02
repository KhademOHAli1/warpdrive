import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationSession } from "./deliveryObservationAuthority";
import type { MailboxActorSession } from "./mailConnectionSchemas";
import { withPrivateIntakeLocalReadLocks } from "./privateIntakeLocalReadLock";
import { lockReadIntentScope } from "./readIntentScope";
import {
  cancelPreparedReadIntent,
  loadReadIntent,
  lockReadIntent,
  prepareReadIntent,
  readIntentReceipt,
} from "./readIntentStore";
import type { ReadIntentPreparation, ReadIntentReceipt } from "./readIntentTypes";

export interface ReadIntentActor {
  actor: AuthUser;
  session: MailboxActorSession;
}

const missing = () => err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));

export function prepareThreadReadIntent(
  db: Db,
  args: ReadIntentActor & { threadId: string; read: boolean },
  signal: AbortSignal,
): Promise<Result<ReadIntentPreparation, AppError>> {
  return withPrivateIntakeLocalReadLocks(db, signal, async (tx) => {
    if (
      args.session.actorId !== args.actor.id ||
      !(await lockDeliveryObservationSession(tx, args.session, signal))
    )
      return missing();
    const scope = await lockReadIntentScope(
      tx,
      { actor: args.actor, threadId: args.threadId, desiredRead: args.read },
      signal,
    );
    if (!scope.ok) return scope;
    const prepared = await prepareReadIntent(tx, scope.value.binding, signal);
    if (prepared === null)
      return err(new AppError(ERROR_IDS.DB_WRITE_FAILED, "Read preparation not confirmed"));
    return ok({ kind: prepared.kind, readIntent: readIntentReceipt(prepared.intent) });
  });
}

export function reconcileThreadReadIntent(
  db: Db,
  args: ReadIntentActor & { threadId: string; operationId: string },
  signal: AbortSignal,
): Promise<Result<ReadIntentReceipt, AppError>> {
  return withPrivateIntakeLocalReadLocks(db, signal, async (tx) => {
    if (
      args.session.actorId !== args.actor.id ||
      !(await lockDeliveryObservationSession(tx, args.session, signal))
    )
      return missing();
    const key = {
      actorId: args.actor.id,
      threadId: args.threadId,
      operationId: args.operationId,
    };
    // This first observation holds no evidence-row lock. Parent authority is
    // locked before the exact operation row, matching the existing lock order.
    const observed = await loadReadIntent(tx, key, signal);
    if (observed === null) return missing();
    const scope = await lockReadIntentScope(
      tx,
      { actor: args.actor, threadId: args.threadId, desiredRead: observed.desiredRead },
      signal,
    );
    if (!scope.ok) return scope;
    const intent = await lockReadIntent(tx, key, signal);
    if (intent === null) return missing();
    if (intent.state !== "prepared") return ok(readIntentReceipt(intent));
    // Cancellation fences an execute request that has not acquired admission.
    // An admitted/unknown operation is never cancelled or replayed here.
    const cancelled = await cancelPreparedReadIntent(tx, key, signal);
    if (cancelled === null)
      return err(new AppError(ERROR_IDS.DB_WRITE_FAILED, "Read cancellation not confirmed"));
    return ok(readIntentReceipt(cancelled));
  });
}
