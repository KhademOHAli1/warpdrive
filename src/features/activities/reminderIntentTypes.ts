import { z } from "zod";
import { isTimeZone } from "@/features/i18n/preferences";

// Version 1 is deliberately in-app only. Missing selection is a legacy caller;
// explicit none is a user choice and must not fall through to legacy email.
export const activityReminderSelectionV1 = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("before_start"),
      channel: z.literal("in_app"),
      leadMinutes: z.literal(10),
    })
    .strict(),
  z
    .object({
      kind: z.literal("all_day_at"),
      channel: z.literal("in_app"),
      localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
]);
export type ActivityReminderSelectionV1 = z.infer<typeof activityReminderSelectionV1>;

export const activityReminderTimeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => !/^[+-]/.test(value) && isTimeZone(value), "Invalid IANA time zone");

export const activityReminderJobV1 = z
  .object({
    v: z.literal(1),
    activityId: z.string().uuid(),
    generationId: z.string().uuid(),
  })
  .strict();
export type ActivityReminderJobV1 = z.infer<typeof activityReminderJobV1>;

export const legacyActivityReminderNudge = z.object({ activityId: z.string().uuid() }).strict();

export const ACTIVITY_REMINDER_STATES = [
  "pending",
  "failed",
  "delivered",
  "suppressed",
  "cancelled",
] as const;
export type ActivityReminderState = (typeof ACTIVITY_REMINDER_STATES)[number];

export const ACTIVITY_REMINDER_OUTCOME_REASONS = [
  "disabled",
  "event_cancelled",
  "event_finished",
  "not_available",
  "invalid_schedule",
  "unsupported_parent",
] as const;
export type ActivityReminderOutcomeReason = (typeof ACTIVITY_REMINDER_OUTCOME_REASONS)[number];
