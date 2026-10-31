"use server";

import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { type ActionResult, clientErr } from "@/types/actionResult";
import type { SendEmailOutcome } from "@/types/mail";
import { ok } from "@/types/result";
import { readOwnedSendStatus } from "./sendStatus";

const statusInput = z.strictObject({ accountId: z.uuid(), idempotencyKey: z.uuid() });

export async function getSendStatusAction(
  csrfToken: string | null,
  raw: unknown,
): Promise<ActionResult<SendEmailOutcome>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed"));
  const context = await createContext();
  if (!context.actor) return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "unauthenticated"));
  const input = statusInput.safeParse(raw);
  if (!input.success)
    return clientErr(new AppError(ERROR_IDS.GMAIL_SEND_INPUT_INVALID, "invalid send status input"));
  const result = await readOwnedSendStatus(db, {
    ...input.data,
    actorId: context.actor.id,
    signal: AbortSignal.timeout(10_000),
  });
  if (!result.ok) return clientErr(result.error);
  return result.value
    ? ok(result.value.outcome)
    : clientErr(new AppError(ERROR_IDS.GMAIL_OUTBOX_NOT_FOUND, "send attempt not found"));
}
