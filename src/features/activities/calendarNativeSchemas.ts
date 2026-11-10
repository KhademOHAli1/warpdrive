import { z } from "zod";
import { completeActivityInput } from "./completeActivityInput";
import { activityReminderSelectionV1, activityReminderTimeZone } from "./reminderIntentTypes";
import { activityCreateInput, activityUpdateInput } from "./schemas";

const actor = { v: z.literal(1), expectedActorId: z.string().uuid() };
export const calendarCreateEnvelopeV1 = z.strictObject({
  ...actor,
  activity: activityCreateInput
    .safeExtend({
      authoredTimeZone: activityReminderTimeZone,
      reminder: activityReminderSelectionV1.optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.reminder !== undefined ||
        (value.calendarId !== null && value.personalReminders !== undefined),
      { message: "Choose one explicit reminder owner" },
    ),
});
export const calendarEditEnvelopeV1 = z.strictObject({
  ...actor,
  activity: activityUpdateInput
    .safeExtend({
      expectedReminderGeneration: z.string().uuid().nullable(),
    })
    .strict(),
});
export const calendarCompleteEnvelopeV1 = z.strictObject({
  ...actor,
  activity: completeActivityInput,
});
export const calendarReadEnvelopeV1 = z.strictObject({ ...actor, activityId: z.string().uuid() });
export const calendarRetryEnvelopeV1 = z.strictObject({
  ...actor,
  activityId: z.string().uuid(),
  expectedGenerationId: z.string().uuid(),
});

export type CalendarCreateEnvelopeV1 = z.input<typeof calendarCreateEnvelopeV1>;
export type CalendarEditEnvelopeV1 = z.input<typeof calendarEditEnvelopeV1>;
