import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { SendEmailOutcome } from "@/types/mail";
import { ok, type Result } from "@/types/result";
import { sendFailureOutcome } from "./sendFailureOutcome";
import { processSmtpSendAttempt } from "./smtpOutbox";
import type { SmtpOutboxArgs } from "./smtpOutboxTypes";

export async function sendIndependent(
  db: Db,
  args: SmtpOutboxArgs & { attemptId: string },
): Promise<Result<SendEmailOutcome, AppError>> {
  const result = await processSmtpSendAttempt(db, args);
  return result.ok
    ? ok({ ...result.value, attemptId: args.attemptId })
    : sendFailureOutcome(db, args, result.error);
}
