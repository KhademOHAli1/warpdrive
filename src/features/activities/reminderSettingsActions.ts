"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { toClientResult } from "@/types/actionResult";
import { setCalendarReminderDefaults, setEventReminderSettings } from "./personalReminderSettings";
import type { CalendarReminderWrite, EventReminderWrite } from "./reminderSettingsSchemas";

export async function setCalendarReminderDefaultsAction(
  input: CalendarReminderWrite,
  csrfToken: string | null = null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  return toClientResult(
    await setCalendarReminderDefaults(db, actor, input, AbortSignal.timeout(10_000)),
  );
}
export async function setEventReminderSettingsAction(
  input: EventReminderWrite,
  csrfToken: string | null = null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  return toClientResult(
    await setEventReminderSettings(db, actor, input, AbortSignal.timeout(10_000)),
  );
}
