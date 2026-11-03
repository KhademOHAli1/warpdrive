"use server";

import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { reconcileThreadImapOperation } from "@/features/email/imapThreadOperationsQueue";
import { readIntentActionActor } from "@/features/email/readIntentActionContext";
import { executeThreadReadIntent } from "@/features/email/readIntents";
import type { ReadActionValue } from "@/features/email/readIntentTypes";
import { SIG } from "@/features/identity/actions/sig";
import { type ActionResult, toClientResult } from "@/types/actionResult";
import { err, type Result } from "@/types/result";

const readInput = z.strictObject({
  threadId: z.string().uuid(),
  operationId: z.string().uuid(),
});

async function markRead(
  csrfToken: string | null,
  rawInput: unknown,
  read: boolean,
): Promise<Result<ReadActionValue, AppError>> {
  const who = await readIntentActionActor(csrfToken);
  if (!who.ok) return who;
  const parsed = readInput.safeParse(rawInput);
  if (!parsed.success)
    return err(
      new AppError(ERROR_IDS.GMAIL_READ_INPUT_INVALID, "invalid input", {
        issues: parsed.error.issues,
      }),
    );
  const signal = SIG();
  let result: Result<ReadActionValue, AppError>;
  try {
    result = await executeThreadReadIntent(
      db,
      {
        ...who.value,
        threadId: parsed.data.threadId,
        operationId: parsed.data.operationId,
        read,
      },
      signal,
    );
  } catch (error) {
    if (error instanceof AppError && error.id === ERROR_IDS.DB_WRITE_FAILED) return err(error);
    throw error;
  }
  if (
    !result.ok &&
    (result.error.id === ERROR_IDS.MAIL_WRITE_UNKNOWN ||
      result.error.id === ERROR_IDS.MAIL_WRITE_PARTIAL)
  )
    await reconcileThreadImapOperation(db, who.value.actor.id, parsed.data.threadId, signal);
  return result;
}

export async function markThreadReadAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<ReadActionValue>> {
  return toClientResult(await markRead(csrfToken, rawInput, true));
}

export async function markThreadUnreadAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<ReadActionValue>> {
  return toClientResult(await markRead(csrfToken, rawInput, false));
}
