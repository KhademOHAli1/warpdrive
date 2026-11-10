"use server";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import {
  createCalendar,
  setCalendarArchived,
  setCalendarMember,
  updateCalendar,
} from "./calendars";

export async function createCalendarAction(
  input: { name: string; timeZone: string },
  csrfToken: string | null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await createCalendar(db, actor, input, AbortSignal.timeout(10_000));
  return result.ok
    ? { ok: true as const, value: { id: result.value.id } }
    : { ok: false as const, error: { id: result.error.id } };
}
export async function setCalendarMemberAction(
  input: { calendarId: string; userId: string; role: "reader" | "editor" | "freeBusy" | null },
  csrfToken: string | null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await setCalendarMember(db, actor, input, AbortSignal.timeout(10_000));
  return result.ok ? { ok: true as const } : { ok: false as const, error: { id: result.error.id } };
}

export async function updateCalendarAction(
  input: { id: string; name?: string; timeZone?: string },
  csrfToken: string | null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await updateCalendar(db, actor, input, AbortSignal.timeout(10_000));
  return result.ok
    ? { ok: true as const, value: { id: result.value.id } }
    : { ok: false as const, error: { id: result.error.id } };
}
export async function setCalendarArchivedAction(
  input: { id: string; archived: boolean },
  csrfToken: string | null,
) {
  if (!(await guardCsrf(csrfToken)).ok) return { ok: false as const, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false as const, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await setCalendarArchived(db, actor, input, AbortSignal.timeout(10_000));
  return result.ok ? { ok: true as const } : { ok: false as const, error: { id: result.error.id } };
}
