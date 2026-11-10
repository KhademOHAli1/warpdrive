"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { toClientResult } from "@/types/actionResult";
import { runCalendarSettingsCommand } from "./calendarSettingsCommand";
import { setCalendarReminderDefaults, setEventReminderSettings } from "./personalReminderSettings";
import type { CalendarReminderWrite, EventReminderWrite } from "./reminderSettingsSchemas";

export async function setCalendarReminderDefaultsAction(
  input: CalendarReminderWrite,
  csrfToken: string | null = null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const context = await createContext();
  if (context.actor === null)
    return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const signal = AbortSignal.timeout(10_000);
  return toClientResult(
    await runCalendarSettingsCommand(context, signal, (db, actor) =>
      setCalendarReminderDefaults(db, actor, input, signal),
    ),
  );
}
export async function setEventReminderSettingsAction(
  input: EventReminderWrite,
  csrfToken: string | null = null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const context = await createContext();
  if (context.actor === null)
    return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const signal = AbortSignal.timeout(10_000);
  return toClientResult(
    await runCalendarSettingsCommand(context, signal, (db, actor) =>
      setEventReminderSettings(db, actor, input, signal),
    ),
  );
}
