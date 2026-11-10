import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { REMINDER_LEAD_MINUTES } from "@/constants/jobNames";
import { instantCivilDate } from "@/lib/zonedDateTime";

export const REMINDER_MAX_ROWS = 5;
export const REMINDER_MAX_MINUTES = 28 * 24 * 60;
export const REMINDER_MAX_DAYS = 28;
const method = z.enum(["notification", "email"]);
export const timedReminderRuleSchema = z.strictObject({
  method,
  minutesBefore: z.number().int().min(0).max(REMINDER_MAX_MINUTES),
});
export const allDayReminderRuleSchema = z.strictObject({
  method,
  daysBefore: z.number().int().min(0).max(REMINDER_MAX_DAYS),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
const uniqueRules = <T>(rules: T[]) =>
  new Set(rules.map((rule) => JSON.stringify(rule))).size === rules.length;
export const reminderDefaultsSchema = z.strictObject({
  timed: z.array(timedReminderRuleSchema).max(REMINDER_MAX_ROWS).refine(uniqueRules),
  allDay: z.array(allDayReminderRuleSchema).max(REMINDER_MAX_ROWS).refine(uniqueRules),
});
export const reminderSelectionSchema = z.discriminatedUnion("useDefault", [
  z.strictObject({ useDefault: z.literal(true) }),
  reminderDefaultsSchema.extend({ useDefault: z.literal(false) }),
]);
export const personalReminderWriteSchema = z.strictObject({
  selection: reminderSelectionSchema,
  expectedRevision: z.number().int().nonnegative().default(0),
});
export type TimedReminderRule = z.infer<typeof timedReminderRuleSchema>;
export type AllDayReminderRule = z.infer<typeof allDayReminderRuleSchema>;
export type ReminderDefaults = z.infer<typeof reminderDefaultsSchema>;
export type ReminderSelection = z.infer<typeof reminderSelectionSchema>;
export const DEFAULT_REMINDER_RULES: ReminderDefaults = {
  timed: [
    { method: "notification", minutesBefore: REMINDER_LEAD_MINUTES },
    { method: "email", minutesBefore: REMINDER_LEAD_MINUTES },
  ],
  allDay: [
    { method: "notification", daysBefore: 0, time: "09:00" },
    { method: "email", daysBefore: 0, time: "09:00" },
  ],
};
export interface ReminderEventTime {
  dueAt: Date | null;
  allDay: boolean;
  dueDate: string | null;
  timeZone: string;
}
export interface PlannedReminder {
  fireAt: Date;
  inApp: boolean;
  email: boolean;
}
export function planReminders(
  event: ReminderEventTime,
  rules: ReminderDefaults,
): PlannedReminder[] {
  if (event.dueAt === null) return [];
  const grouped = new Map<number, PlannedReminder>();
  const add = (fireAt: number, method: "notification" | "email") => {
    const entry = grouped.get(fireAt) ?? { fireAt: new Date(fireAt), inApp: false, email: false };
    if (method === "notification") entry.inApp = true;
    else entry.email = true;
    grouped.set(fireAt, entry);
  };
  if (event.allDay) {
    const day = Temporal.PlainDate.from(
      event.dueDate ?? instantCivilDate(event.dueAt, event.timeZone),
    );
    for (const rule of rules.allDay) {
      // Automatic reminders move forward through gaps and choose the earlier fold. Event
      // creation still rejects nonexistent wall times; a reminder cannot break its save.
      const local = day.subtract({ days: rule.daysBefore }).toPlainDateTime(rule.time);
      add(
        local.toZonedDateTime(event.timeZone, { disambiguation: "compatible" }).epochMilliseconds,
        rule.method,
      );
    }
  } else {
    for (const rule of rules.timed)
      add(event.dueAt.getTime() - rule.minutesBefore * 60_000, rule.method);
  }
  return [...grouped.values()].sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

export function reminderTemporalSignature(row: {
  dueAt: Date | null;
  allDay: boolean;
  dueDate: string | null;
  eventTimeZone: string | null;
}): string {
  return JSON.stringify([
    row.dueAt?.toISOString() ?? null,
    row.allDay,
    row.dueDate,
    row.eventTimeZone,
  ]);
}
