import { z } from "zod";
import { personalReminderWriteSchema, reminderDefaultsSchema } from "./reminderPolicy";

export const calendarReminderWriteSchema = z.strictObject({
  calendarId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  defaults: reminderDefaultsSchema,
});
export const eventReminderWriteSchema = personalReminderWriteSchema.extend({
  activityId: z.uuid(),
});
export type CalendarReminderWrite = z.input<typeof calendarReminderWriteSchema>;
export type EventReminderWrite = z.input<typeof eventReminderWriteSchema>;
export type PersonalReminderWrite = z.output<typeof personalReminderWriteSchema>;
