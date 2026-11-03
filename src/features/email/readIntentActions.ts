"use server";

import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { SIG } from "@/features/identity/actions/sig";
import { type ActionResult, toClientResult } from "@/types/actionResult";
import { err } from "@/types/result";
import { readIntentActionActor } from "./readIntentActionContext";
import { prepareThreadReadIntent, reconcileThreadReadIntent } from "./readIntentLifecycle";
import type { ReadIntentPreparation, ReadIntentReceipt } from "./readIntentTypes";

const preparationInput = z.strictObject({ threadId: z.guid(), read: z.boolean() });
const reconciliationInput = z.strictObject({ threadId: z.guid(), operationId: z.guid() });

export async function prepareThreadReadIntentAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<ReadIntentPreparation>> {
  const who = await readIntentActionActor(csrfToken);
  if (!who.ok) return toClientResult<ReadIntentPreparation>(who);
  const parsed = preparationInput.safeParse(rawInput);
  if (!parsed.success)
    return toClientResult<ReadIntentPreparation>(
      err(new AppError(ERROR_IDS.GMAIL_READ_INPUT_INVALID, "invalid read preparation")),
    );
  try {
    return toClientResult(
      await prepareThreadReadIntent(db, { ...who.value, ...parsed.data }, SIG()),
    );
  } catch (error) {
    if (error instanceof AppError) return toClientResult<ReadIntentPreparation>(err(error));
    throw error;
  }
}

export async function reconcileThreadReadIntentAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<ReadIntentReceipt>> {
  const who = await readIntentActionActor(csrfToken);
  if (!who.ok) return toClientResult<ReadIntentReceipt>(who);
  const parsed = reconciliationInput.safeParse(rawInput);
  if (!parsed.success)
    return toClientResult<ReadIntentReceipt>(
      err(new AppError(ERROR_IDS.GMAIL_READ_INPUT_INVALID, "invalid read reconciliation")),
    );
  try {
    return toClientResult(
      await reconcileThreadReadIntent(db, { ...who.value, ...parsed.data }, SIG()),
    );
  } catch (error) {
    if (error instanceof AppError) return toClientResult<ReadIntentReceipt>(err(error));
    throw error;
  }
}
