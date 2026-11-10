"use server";

import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { ClientError } from "@/types/actionResult";
import { disconnectCalendarProviderAccount } from "./accounts";
import { withCalendarDomainActor } from "./calendarDomainAuthority";
import { rethrowGoogleAbort } from "./errors";

type DisconnectResult = { ok: true } | { ok: false; error: ClientError };
const accountIdSchema = z.uuid();

export async function disconnectGoogleCalendarAction(
  accountId: string,
  csrfToken: string | null = null,
): Promise<DisconnectResult> {
  if (!(await guardCsrf(csrfToken)).ok)
    return { ok: false, error: { id: ERROR_IDS.AUTH_STATE_MISMATCH } };
  const ctx = await createContext();
  if (ctx.actor === null || ctx.session === null)
    return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const parsed = accountIdSchema.safeParse(accountId);
  if (!parsed.success)
    return { ok: false, error: { id: ERROR_IDS.CALENDAR_ACCOUNT_INPUT_INVALID } };
  const signal = AbortSignal.timeout(10_000);
  try {
    const userId = ctx.actor.id;
    const result = await withCalendarDomainActor(
      ctx.db,
      ctx.session,
      signal,
      (db) => disconnectCalendarProviderAccount(db, userId, parsed.data, signal),
      { kind: "unauthorized" },
    );
    if (result.ok) return { ok: true };
    return {
      ok: false,
      error: {
        id:
          result.error.kind === "not_found"
            ? ERROR_IDS.CALENDAR_ACCOUNT_NOT_FOUND
            : ERROR_IDS.CALENDAR_ACCOUNT_DISCONNECT_FAILED,
      },
    };
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return { ok: false, error: { id: ERROR_IDS.CALENDAR_ACCOUNT_DISCONNECT_FAILED } };
  }
}
