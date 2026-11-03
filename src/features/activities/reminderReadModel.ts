import { eq } from "drizzle-orm";
import { z } from "zod";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import {
  ACTIVITY_REMINDER_OUTCOME_REASONS,
  ACTIVITY_REMINDER_STATES,
  type ActivityReminderOutcomeReason,
  type ActivityReminderSelectionV1,
  type ActivityReminderState,
  activityReminderSelectionV1,
  activityReminderTimeZone,
} from "./reminderIntentTypes";

export interface ActivityReminderView {
  generationId: string;
  selection: ActivityReminderSelectionV1 | null;
  reminderTimeZone: string | null;
  status: ActivityReminderState | "unsupported";
  fireAt: string | null;
  outcomeReason: ActivityReminderOutcomeReason | null;
  retryable: boolean;
}
export interface ActivityReminderMetadataView {
  authoredTimeZone: string | null;
  reminder: ActivityReminderView | null;
}
function knownZone(value: string | null): string | null {
  const parsed = activityReminderTimeZone.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function finiteInstant(value: Date | null): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

// Call only after the activity's own visibility gate. The selected native read
// keeps the activity shared row lock while collecting this current status.
// Receipt notification IDs and internal failure strings are not a public DTO.
export async function readActivityReminderView(
  db: DbOrTx,
  activityId: string,
  signal: AbortSignal,
): Promise<ActivityReminderMetadataView> {
  signal.throwIfAborted();
  const [row] = await db
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activityId));
  signal.throwIfAborted();
  if (row === undefined) return { authoredTimeZone: null, reminder: null };
  const authoredTimeZone = knownZone(row.eventTimeZone);
  if (row.version === 1 && !row.managed) return { authoredTimeZone, reminder: null };
  const selection = activityReminderSelectionV1.safeParse(row.selection);
  const state = z.enum(ACTIVITY_REMINDER_STATES).safeParse(row.status);
  const fireAt = finiteInstant(row.fireAt);
  const reminderTimeZone = knownZone(row.reminderTimeZone);
  const needsSchedule = state.success && state.data !== "cancelled" && state.data !== "suppressed";
  const supported =
    row.version === 1 &&
    row.channel === "in_app" &&
    (!needsSchedule || (fireAt !== null && reminderTimeZone !== null));
  const status = supported && state.success && selection.success ? state.data : "unsupported";
  const reason = z.enum(ACTIVITY_REMINDER_OUTCOME_REASONS).safeParse(row.outcomeReason);
  const outcomeReason = reason.success ? reason.data : null;
  return {
    authoredTimeZone,
    reminder: {
      generationId: row.generationId,
      selection: supported && selection.success && state.success ? selection.data : null,
      reminderTimeZone,
      status,
      fireAt,
      outcomeReason,
      retryable:
        (status === "failed" || status === "suppressed") &&
        fireAt !== null &&
        outcomeReason !== "event_finished" &&
        outcomeReason !== "unsupported_parent",
    },
  };
}
