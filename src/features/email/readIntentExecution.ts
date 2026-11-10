import { randomUUID } from "node:crypto";
import { AppError, ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationSession } from "./deliveryObservationAuthority";
import type { MailboxActorSession } from "./mailConnectionSchemas";
import { withPrivateIntakeLocalReadLocks } from "./privateIntakeLocalReadLock";
import type { ReadIntentActor } from "./readIntentLifecycle";
import { applyReadIntentLocalMarker, lockReadIntentPrivateRows } from "./readIntentLocalMarker";
import { lockReadIntentScope } from "./readIntentScope";
import {
  admitReadIntent,
  cancelPreparedReadIntent,
  denyPreparedReadIntent,
  finishReadIntent,
  lockReadIntent,
  type ReadIntentKey,
  readIntentReceipt,
  sameReadIntentBinding,
} from "./readIntentStore";
import type { ReadActionValue, ReadIntentBinding, StoredReadIntent } from "./readIntentTypes";

export type ReadIntentAdmission =
  | { kind: "settled"; result: Result<ReadActionValue, AppError> }
  | {
      kind: "remote";
      key: ReadIntentKey;
      claim: string;
      binding: ReadIntentBinding;
      actor: AuthUser;
      session: MailboxActorSession;
    };

const settled = (result: Result<ReadActionValue, AppError>): ReadIntentAdmission => ({
  kind: "settled",
  result,
});
const rejected = (id: ErrorId, message: string) => settled(err(new AppError(id, message)));
const missing = () => rejected(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found");

function recordedResult(intent: StoredReadIntent): ReadIntentAdmission | null {
  switch (intent.state) {
    case "prepared":
      return null;
    case "applied":
      return settled(ok({ threadId: intent.threadId, readIntent: readIntentReceipt(intent) }));
    case "admitted":
    case "unknown":
      return rejected(ERROR_IDS.MAIL_WRITE_UNKNOWN, "Read operation outcome is unconfirmed");
    case "cancelled":
      return rejected(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Read preparation is no longer active");
    case "denied":
      return rejected(intent.errorId ?? ERROR_IDS.MAIL_CAPABILITY_DENIED, "Read operation denied");
  }
}

async function denyMismatchedReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  intent: StoredReadIntent,
  signal: AbortSignal,
): Promise<ReadIntentAdmission> {
  if (intent.state === "prepared") {
    const denied = await denyPreparedReadIntent(
      tx,
      key,
      ERROR_IDS.GMAIL_READ_INPUT_INVALID,
      signal,
    );
    if (denied === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Locked read preparation was not denied");
  }
  return rejected(ERROR_IDS.GMAIL_READ_INPUT_INVALID, "Read intent does not match input");
}

export function admitThreadReadIntent(
  db: Db,
  args: ReadIntentActor & { threadId: string; operationId: string; read: boolean },
  signal: AbortSignal,
): Promise<ReadIntentAdmission> {
  signal.throwIfAborted();
  // The claim is server-owned and remains identifiable after an uncertain COMMIT.
  const claim = randomUUID();
  const key = {
    actorId: args.actor.id,
    threadId: args.threadId,
    operationId: args.operationId,
  };
  // The wrapper exposes a remote descriptor only after the owning COMMIT ACK.
  // A failed or uncertain claim commit throws and cannot reach provider dispatch.
  return withPrivateIntakeLocalReadLocks<ReadIntentAdmission>(db, signal, async (tx) => {
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
    if (!scope.ok) return settled(scope);
    const privateRowsCurrent = await lockReadIntentPrivateRows(tx, scope.value.binding, signal);
    const intent = await lockReadIntent(tx, key, signal);
    if (intent === null) return missing();

    if (intent.desiredRead !== args.read) return denyMismatchedReadIntent(tx, key, intent, signal);
    const recorded = recordedResult(intent);
    if (recorded !== null) return recorded;

    if (!privateRowsCurrent || !sameReadIntentBinding(intent, scope.value.binding)) {
      const denied = await denyPreparedReadIntent(
        tx,
        key,
        ERROR_IDS.MAIL_CONNECTION_CHANGED,
        signal,
      );
      if (denied === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Changed read preparation was not denied");
      return rejected(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Read preparation scope changed");
    }
    const admitted = await admitReadIntent(tx, key, claim, signal);
    if (admitted === null) {
      // The database admission cutoff is authoritative, including lock waits.
      const cancelled = await cancelPreparedReadIntent(tx, key, signal);
      if (cancelled === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Expired read preparation was not cancelled");
      return rejected(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Read preparation expired");
    }
    if (admitted.readMode === "imap")
      return {
        kind: "remote",
        key,
        claim,
        binding: scope.value.binding,
        actor: scope.value.actor,
        session: { ...args.session },
      };

    await applyReadIntentLocalMarker(tx, admitted, signal);
    const applied = await finishReadIntent(tx, key, claim, { state: "applied" }, signal);
    // Returning an error here would commit an unreceipted marker. Throw so the
    // owning runner rolls back admission, marker and receipt as one operation.
    if (applied === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Local read marker has no applied receipt");
    return settled(ok({ threadId: applied.threadId, readIntent: readIntentReceipt(applied) }));
  });
}
