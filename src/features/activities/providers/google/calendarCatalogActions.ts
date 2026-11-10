"use server";

import { z } from "zod";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { ClientError } from "@/types/actionResult";
import { calendarDeploymentConfig } from "./authorizationDeployment";
import { googleCalendarSelectionInput } from "./calendarBindingAccess";
import { setGoogleCalendarSelection } from "./calendarBindings";
import { discoverGoogleCalendarCatalog } from "./calendarCatalog";
import { withCalendarDomainActor } from "./calendarDomainAuthority";
import type {
  GoogleCalendarCatalog,
  GoogleCalendarSelection,
} from "./catalogContracts";
import { rethrowGoogleAbort } from "./errors";

type CatalogActionResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };
const discoveryInput = z.strictObject({ accountId: z.uuid() });

function failure(id: string): { ok: false; error: ClientError } {
  return { ok: false, error: { id } };
}

export async function discoverGoogleCalendarsAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<CatalogActionResult<GoogleCalendarCatalog>> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const csrf = await guardCsrf(csrfToken);
    signal.throwIfAborted();
    if (!csrf.ok) return failure(ERROR_IDS.AUTH_STATE_MISMATCH);
    const ctx = await createContext();
    signal.throwIfAborted();
    if (ctx.actor === null || ctx.session === null) return failure(ERROR_IDS.AUTH_SESSION_DEAD);
    const parsed = discoveryInput.safeParse(raw);
    if (!parsed.success) return failure(ERROR_IDS.CALENDAR_CATALOG_INPUT_INVALID);
    const config = calendarDeploymentConfig(env);
    if (config === null) return failure(ERROR_IDS.CALENDAR_CATALOG_FAILED);
    const result = await discoverGoogleCalendarCatalog(
      ctx.db,
      ctx.actor.id,
      parsed.data.accountId,
      config,
      signal,
      { nativeSession: ctx.session },
    );
    signal.throwIfAborted();
    return result.ok
      ? { ok: true, data: result.value }
      : failure(
          result.error.kind === "conflict"
            ? ERROR_IDS.CALENDAR_CATALOG_CONFLICT
            : ERROR_IDS.CALENDAR_CATALOG_FAILED,
        );
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return failure(ERROR_IDS.CALENDAR_CATALOG_FAILED);
  }
}

export async function setGoogleCalendarSelectionAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<CatalogActionResult<GoogleCalendarSelection>> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const csrf = await guardCsrf(csrfToken);
    signal.throwIfAborted();
    if (!csrf.ok) return failure(ERROR_IDS.AUTH_STATE_MISMATCH);
    const ctx = await createContext();
    signal.throwIfAborted();
    if (ctx.actor === null || ctx.session === null) return failure(ERROR_IDS.AUTH_SESSION_DEAD);
    const parsed = googleCalendarSelectionInput.safeParse(raw);
    if (!parsed.success) return failure(ERROR_IDS.CALENDAR_BINDING_INPUT_INVALID);
    if (parsed.data.selected && calendarDeploymentConfig(env) === null)
      return failure(ERROR_IDS.CALENDAR_BINDING_FAILED);
    const userId = ctx.actor.id;
    const result = await withCalendarDomainActor(
      ctx.db,
      ctx.session,
      signal,
      (db) => setGoogleCalendarSelection(db, userId, parsed.data, signal),
      { kind: "unauthorized" },
    );
    signal.throwIfAborted();
    return result.ok
      ? { ok: true, data: result.value }
      : failure(
          result.error.kind === "conflict"
            ? ERROR_IDS.CALENDAR_BINDING_CONFLICT
            : ERROR_IDS.CALENDAR_BINDING_FAILED,
        );
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return failure(ERROR_IDS.CALENDAR_BINDING_FAILED);
  }
}
