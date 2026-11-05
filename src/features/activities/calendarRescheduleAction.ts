"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { afterCalendarCommit } from "./calendarAfterCommit";
import { withCalendarActor } from "./calendarNativeAuthority";
import { readCalendarRequestSession } from "./calendarRequestSession";
import { rescheduleCalendarEvent } from "./calendarReschedule";
import {
  type CalendarRescheduleActionResult,
  calendarRescheduleEnvelopeV1,
} from "./calendarRescheduleSchemas";

export async function rescheduleCalendarEventAction(
  raw: unknown,
  csrfToken: string | null,
): Promise<CalendarRescheduleActionResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const parsed = calendarRescheduleEnvelopeV1.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID } };
  const signal = SIG();
  const who = await readCalendarRequestSession(db, signal);
  if (who === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await withCalendarActor(
    db,
    who,
    parsed.data.expectedActorId,
    signal,
    (tx, actor) => rescheduleCalendarEvent(tx, actor, parsed.data.activity, signal),
  );
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  afterCalendarCommit(result.value.id);
  return { ok: true, value: result.value };
}
