import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { isMailConnectionCurrent } from "./mailConnectionRuntime";
import { privateIntakeBlocksQueuedSend } from "./privateIntakeDispatchFence";
import { repairAcceptedSmtpCopy } from "./smtpOutboxAccepted";
import { abandonSmtpClaim, claimSmtpAttempt, loadSmtpAttempt } from "./smtpOutboxRepo";
import { submitClaimedSmtpAttempt } from "./smtpOutboxSubmit";
import type { SmtpAttempt, SmtpOutboxArgs, SmtpSendOutcome } from "./smtpOutboxTypes";

export { repairSmtpReceipt } from "./smtpOutboxRepair";
export type { SmtpSendOutcome } from "./smtpOutboxTypes";

function inProgressOutcome(attempt: SmtpAttempt): SmtpSendOutcome {
  const leased =
    attempt.status === "sending" &&
    attempt.claim_token !== null &&
    attempt.claimed_at !== null &&
    Date.now() - attempt.claimed_at.getTime() < CLAIM_LEASE_SECONDS * 1000;
  return leased
    ? { status: "pending" }
    : { status: "needs_review", deliveryOutcome: { state: "unknown" } };
}

async function runSmtpAttempt(
  db: Db,
  args: SmtpOutboxArgs,
): Promise<Result<SmtpSendOutcome, AppError>> {
  args.signal.throwIfAborted();
  const attempt = await loadSmtpAttempt(db, args.accountId, args.idempotencyKey, args.signal);
  if (attempt === undefined)
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "SMTP attempt not found"));
  if (args.runtime.accountId !== args.accountId || args.runtime.ownerId !== attempt.owner_id)
    return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Mailbox identity changed"));
  const receipt = attempt.delivery_outcome;
  if (attempt.send_started_at !== null && receipt?.state === "unknown")
    return ok(inProgressOutcome(attempt));
  if (receipt?.state === "unknown")
    return ok({ status: "needs_review", deliveryOutcome: { state: "unknown" } });
  if (receipt?.state === "accepted" || receipt?.state === "partial")
    return repairAcceptedSmtpCopy(db, attempt, args.signal);
  if (attempt.send_started_at !== null) return ok(inProgressOutcome(attempt));
  if (
    !(await isMailConnectionCurrent(db, args.runtime, args.signal)) ||
    attempt.connection_generation !== args.runtime.generation
  )
    return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Mailbox connection changed"));
  const token = await claimSmtpAttempt(db, attempt.id, args.signal);
  if (token === null) return ok({ status: "pending" });
  return runLeasedSmtpAttempt(db, args, attempt.id, token);
}

async function runLeasedSmtpAttempt(
  db: Db,
  args: SmtpOutboxArgs,
  attemptId: string,
  token: string,
): Promise<Result<SmtpSendOutcome, AppError>> {
  try {
    const attempt = await loadSmtpAttempt(db, args.accountId, args.idempotencyKey, args.signal);
    if (attempt === undefined)
      return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "Claimed SMTP attempt missing"));
    if (attempt.send_started_at !== null)
      return ok({ status: "needs_review", deliveryOutcome: { state: "unknown" } });
    return await submitClaimedSmtpAttempt(db, args, attempt, token);
  } catch (error) {
    try {
      // Cancellation must release the durable lease even though its request signal has ended.
      await abandonSmtpClaim(db, attemptId, token, AbortSignal.timeout(5000));
    } catch {
      // An unavailable database leaves the lease as the conservative recovery fallback.
    }
    throw error;
  }
}

export async function processSmtpSendAttempt(
  db: Db,
  args: SmtpOutboxArgs,
): Promise<Result<SmtpSendOutcome, AppError>> {
  try {
    if (await privateIntakeBlocksQueuedSend(db, args))
      return err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
    return await runSmtpAttempt(db, args);
  } catch (error) {
    args.signal.throwIfAborted();
    return err(
      error instanceof AppError
        ? error
        : new AppError(ERROR_IDS.DB_WRITE_FAILED, "SMTP attempt could not be recorded"),
    );
  }
}
