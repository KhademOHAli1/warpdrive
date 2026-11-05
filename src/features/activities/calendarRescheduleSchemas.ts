import { z } from "zod";
import { activityReminderTimeZone } from "./reminderIntentTypes";

// The calendar's complete source timing is a compare-and-swap precondition, not
// an editable copy of the record. No subject, participants or CRM links are accepted.
export const calendarScheduleSnapshotV1 = z.strictObject({
  dueAt: z.string().datetime(),
  endAt: z.string().datetime().nullable(),
  allDay: z.boolean(),
  dueDate: z.string().date().nullable(),
  endDate: z.string().date().nullable(),
  durationMinutes: z.number().int().nullable(),
});
const calendarMoveTarget = z.strictObject({
  date: z.string().date(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
const calendarResizeTarget = z.strictObject({
  edge: z.enum(["start", "end"]),
  date: z.string().date(),
  time: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/),
});
const calendarUndoTarget = z.strictObject({
  undo: calendarScheduleSnapshotV1,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const calendarRescheduleInput = z.strictObject({
  id: z.string().uuid(),
  expected: calendarScheduleSnapshotV1,
  timeZone: activityReminderTimeZone,
  target: z.union([calendarMoveTarget, calendarResizeTarget, calendarUndoTarget]),
});
export const calendarRescheduleEnvelopeV1 = z.strictObject({
  v: z.literal(1),
  expectedActorId: z.string().uuid(),
  activity: calendarRescheduleInput,
});

export type CalendarScheduleSnapshot = z.infer<typeof calendarScheduleSnapshotV1>;
export type CalendarRescheduleMoveTarget = z.infer<typeof calendarMoveTarget>;
export type CalendarRescheduleResizeTarget = z.infer<typeof calendarResizeTarget>;
export type CalendarRescheduleUndoTarget = z.infer<typeof calendarUndoTarget>;
export type CalendarRescheduleInput = z.infer<typeof calendarRescheduleInput>;
export type CalendarRescheduleEnvelope = z.infer<typeof calendarRescheduleEnvelopeV1>;
export interface CalendarRescheduleValue extends CalendarScheduleSnapshot {
  id: string;
}
export type CalendarRescheduleActionResult =
  | { ok: true; value: CalendarRescheduleValue; undoToken?: string }
  | { ok: false; error: { id: string } };
