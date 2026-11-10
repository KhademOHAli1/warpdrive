import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { SendEmailOutcome } from "@/types/mail";
import {
  readWorkflowEmailSendMailbox,
  type WorkflowEmailSendPlan,
  workflowEmailSendRequestDigest,
} from "./workflowEmailSendPlan";
import {
  consumeWorkflowExternalEffectDispatch,
  isFreshWorkflowExternalEffectDispatch,
} from "./workflowExternalEffect";
import type { WorkflowExternalEffectCompletion } from "./workflowExternalEffectContract";

export interface WorkflowEmailSendNativeRequest {
  readonly dispatchAttemptId: string;
  readonly plan: WorkflowEmailSendPlan;
}

export type WorkflowEmailSendNativeOutcome =
  | { disposition: "receipt"; outcome: SendEmailOutcome }
  | { disposition: "not_submitted" }
  | { disposition: "unknown" };

// A MAIL-owned implementation binds the immutable plan to a purpose-marked
// outbox row and fences both submission paths. Ordinary outbox recovery and
// interactive replay must not submit that row. There is no ordinary-send fallback.
export type WorkflowEmailSendNative = (
  db: Db,
  request: WorkflowEmailSendNativeRequest,
  signal: AbortSignal,
) => Promise<WorkflowEmailSendNativeOutcome>;

function notSent(errorId: ErrorId): WorkflowExternalEffectCompletion {
  return { state: "not_sent", errorId };
}

function unknownDelivery(): WorkflowExternalEffectCompletion {
  return { state: "unknown", errorId: ERROR_IDS.MAIL_SEND_UNKNOWN };
}

function projectDelivery(result: WorkflowEmailSendNativeOutcome): WorkflowExternalEffectCompletion {
  if (result.disposition === "not_submitted") return notSent(ERROR_IDS.MAIL_SEND_REJECTED);
  if (result.disposition === "unknown") return unknownDelivery();
  const evidence = result.outcome.deliveryOutcome?.state;
  if (evidence === "partial") return { state: "complete", errorId: ERROR_IDS.MAIL_WRITE_PARTIAL };
  if (evidence === "rejected") return notSent(ERROR_IDS.MAIL_SEND_REJECTED);
  if (evidence === "accepted" || (evidence === undefined && result.outcome.status === "sent"))
    return { state: "complete", output: { status: "accepted" } };
  return unknownDelivery();
}

async function submitNative(
  db: Db,
  request: WorkflowEmailSendNativeRequest,
  sendNative: WorkflowEmailSendNative,
  signal: AbortSignal,
): Promise<WorkflowExternalEffectCompletion> {
  try {
    return projectDelivery(await sendNative(db, request, signal));
  } catch {
    // The provider may have accepted. Never retry a submission from an error,
    // and never persist an exception that may contain mail or credential data.
    return unknownDelivery();
  }
}

async function checkCurrentMailbox(db: Db, plan: WorkflowEmailSendPlan, signal: AbortSignal) {
  try {
    const current = await readWorkflowEmailSendMailbox(db, plan.accountId, plan.actorId, signal);
    return current?.provider === plan.provider &&
      current.connectionGeneration === plan.connectionGeneration
      ? null
      : ERROR_IDS.MAIL_CONNECTION_CHANGED;
  } catch {
    return ERROR_IDS.WORKFLOW_WRITE_FAILED;
  }
}

export async function dispatchWorkflowEmailSend(
  db: Db,
  dispatch: unknown,
  plan: WorkflowEmailSendPlan,
  sendNative: WorkflowEmailSendNative | undefined,
  signal: AbortSignal,
): Promise<WorkflowExternalEffectCompletion> {
  if (signal.aborted || "rollback" in db) return notSent(ERROR_IDS.WORKFLOW_DENIED);
  if (sendNative === undefined) return notSent(ERROR_IDS.WORKFLOW_NOT_READY);
  if (
    !isFreshWorkflowExternalEffectDispatch(dispatch) ||
    dispatch.requestDigest !== plan.requestDigest ||
    dispatch.requestDigest !== workflowEmailSendRequestDigest(plan)
  )
    return notSent(ERROR_IDS.WORKFLOW_CONFLICT);
  const mailboxError = await checkCurrentMailbox(db, plan, signal);
  if (mailboxError !== null) return notSent(mailboxError);
  if (signal.aborted || !consumeWorkflowExternalEffectDispatch(dispatch))
    return notSent(ERROR_IDS.WORKFLOW_DENIED);
  return submitNative(db, { dispatchAttemptId: dispatch.executionKey, plan }, sendNative, signal);
}
