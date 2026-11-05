import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { calendarScheduleSnapshot } from "./calendarReschedulePlan";
import type { CalendarScheduleSnapshot } from "./calendarRescheduleSchemas";

interface CalendarUndoBinding {
  actorId: string;
  sessionId: string;
  id: string;
  timeZone: string;
  expected: CalendarScheduleSnapshot;
  original: CalendarScheduleSnapshot;
}

export function signCalendarUndo(binding: CalendarUndoBinding): string {
  const key = createHmac("sha256", env.AUTH_SECRET || env.TOKEN_ENCRYPTION_KEY)
    .update("warpdrive-calendar-undo-v1")
    .digest();
  const payload = JSON.stringify([
    binding.actorId.toLowerCase(),
    binding.sessionId,
    binding.id.toLowerCase(),
    binding.timeZone,
    calendarScheduleSnapshot(binding.expected),
    calendarScheduleSnapshot(binding.original),
  ]);
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function verifyCalendarUndo(binding: CalendarUndoBinding, token: string): boolean {
  const expected = Buffer.from(signCalendarUndo(binding));
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
