"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { afterCalendarCommit } from "./calendarAfterCommit";
import { withCalendarActor } from "./calendarNativeAuthority";
import { readCalendarRequestSession } from "./calendarRequestSession";
import { rescheduleCalendarEvent } from "./calendarReschedule";
import { calendarScheduleMatches } from "./calendarReschedulePlan";
import {
  type CalendarRescheduleActionResult,
  calendarRescheduleEnvelopeV1,
} from "./calendarRescheduleSchemas";
import { signCalendarUndo } from "./calendarRescheduleUndo";

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
  const input = parsed.data.activity;
  const result = await withCalendarActor(
    db,
    who,
    parsed.data.expectedActorId,
    signal,
    (tx, actor) => rescheduleCalendarEvent(tx, actor, input, signal, who.sessionId),
  );
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  afterCalendarCommit(result.value.id);
  if ("undo" in input.target || calendarScheduleMatches(result.value, input.expected))
    return { ok: true, value: result.value };
  return {
    ok: true,
    value: result.value,
    undoToken: signCalendarUndo({
      actorId: who.userId,
      sessionId: who.sessionId,
      id: result.value.id,
      timeZone: input.timeZone,
      expected: result.value,
      original: input.expected,
    }),
  };
}
