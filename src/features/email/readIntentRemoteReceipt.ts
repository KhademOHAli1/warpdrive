import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { lockDeliveryObservationSession } from "./deliveryObservationAuthority";
import type { ImapNetworkOutcome, ImapThreadOperation } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ReadIntentAdmission } from "./readIntentExecution";
import { readIntentRemoteSessionCurrent } from "./readIntentRemoteSession";
import { lockReadIntentScope } from "./readIntentScope";
import {
  finishReadIntent,
  loadReadIntent,
  lockReadIntent,
  type ReadIntentDisposition,
  readIntentReceipt,
  sameReadIntentBinding,
} from "./readIntentStore";
import type { ReadIntentReceipt } from "./readIntentTypes";

export type ReadIntentRemoteDispatch = Extract<ReadIntentAdmission, { kind: "remote" }>;

export function readIntentRemoteRuntimeMatches(
  dispatch: ReadIntentRemoteDispatch,
  runtime: ImapConnectionRuntime,
  threadId: string,
  operation: ImapThreadOperation,
): boolean {
  return (
    dispatch.key.threadId === threadId &&
    runtime.accountId === dispatch.binding.accountId &&
    runtime.ownerId === dispatch.binding.mailboxOwnerId &&
    runtime.generation === dispatch.binding.connectionGeneration &&
    operation.kind === "read" &&
    operation.read === dispatch.binding.desiredRead
  );
}

// Durable admission alone cannot authorize I/O after runtime loading. Reobserve
// native session authority for every mutation without holding auth/evidence locks.
export async function readIntentRemoteCurrent(
  tx: DbOrTx,
  dispatch: ReadIntentRemoteDispatch,
  signal: AbortSignal,
): Promise<boolean> {
  const intent = await loadReadIntent(tx, dispatch.key, signal);
  if (
    intent === null ||
    intent.state !== "admitted" ||
    intent.dispatchClaim !== dispatch.claim ||
    !sameReadIntentBinding(intent, dispatch.binding)
  )
    return false;
  return readIntentRemoteSessionCurrent(tx, dispatch, signal);
}

// Called after the last provider operation, before local marker persistence.
// Session -> parents -> intent matches the preparation/local commit lock order.
export async function lockReadIntentRemoteOutcome(
  tx: DbOrTx,
  dispatch: ReadIntentRemoteDispatch,
  signal: AbortSignal,
): Promise<boolean> {
  if (!(await lockDeliveryObservationSession(tx, dispatch.session, signal))) return false;
  const scope = await lockReadIntentScope(
    tx,
    {
      actor: dispatch.actor,
      threadId: dispatch.key.threadId,
      desiredRead: dispatch.binding.desiredRead,
    },
    signal,
  );
  if (!scope.ok || !sameReadIntentBinding(scope.value.binding, dispatch.binding)) return false;
  const intent = await lockReadIntent(tx, dispatch.key, signal);
  return intent?.state === "admitted" && intent.dispatchClaim === dispatch.claim;
}

function networkDisposition(outcome: ImapNetworkOutcome): ReadIntentDisposition {
  if (outcome.failure === null) return { state: "applied" };
  if (
    outcome.confirmed.length === 0 &&
    (outcome.failure.kind === "read_only" || outcome.failure.kind === "unsupported")
  )
    return { state: "denied", errorId: ERROR_IDS.MAIL_CAPABILITY_DENIED };
  return {
    state: "unknown",
    errorId:
      outcome.confirmed.length > 0 ? ERROR_IDS.MAIL_WRITE_PARTIAL : ERROR_IDS.MAIL_WRITE_UNKNOWN,
  };
}

export async function finishReadIntentRemoteOutcome(
  tx: DbOrTx,
  dispatch: ReadIntentRemoteDispatch,
  outcome: ImapNetworkOutcome,
  signal: AbortSignal,
): Promise<ReadIntentReceipt> {
  const finished = await finishReadIntent(
    tx,
    dispatch.key,
    dispatch.claim,
    networkDisposition(outcome),
    signal,
  );
  if (finished === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Read outcome lost its dispatch claim");
  return readIntentReceipt(finished);
}
