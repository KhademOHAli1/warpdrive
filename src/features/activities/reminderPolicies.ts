import { and, eq, inArray } from "drizzle-orm";
import {
  type Activity,
  activityReminderSettings,
  calendarReminderDefaults,
  calendars,
} from "@/db/schema";
import { canSee } from "@/features/permissions/canSee";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { activityAccountPreferences } from "./accountTimeZone";
import { calendarActivityAccess } from "./calendarAccess";
import { type PersonalReminderPlan, personalReminderPolicyPlans } from "./reminderPolicyPlans";
import { resolveActivityVisibility } from "./visibility";

export type { PersonalReminderPlan } from "./reminderPolicyPlans";
export async function reminderFallbackTimeZone(
  tx: DbOrTx,
  row: Activity,
  signal: AbortSignal,
): Promise<string> {
  if (row.eventTimeZone !== null) return row.eventTimeZone;
  if (row.calendarId !== null) {
    const [calendar] = await tx
      .select({ timeZone: calendars.timeZone })
      .from(calendars)
      .where(eq(calendars.id, row.calendarId));
    signal.throwIfAborted();
    if (calendar !== undefined) return calendar.timeZone;
  }
  const preferences = await activityAccountPreferences(tx, row.assigneeId);
  signal.throwIfAborted();
  return preferences.timeZone;
}
export async function mayReceivePersonalReminder(
  tx: DbOrTx,
  row: Activity,
  userId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const actor = await hydrateActor(tx, userId, signal);
  if (actor === null) return false;
  const access = await calendarActivityAccess(tx, actor, row, signal, true);
  const visibility = await resolveActivityVisibility(tx, row, signal);
  return access?.read !== false && visibility !== null && canSee(actor, visibility);
}
export async function loadPersonalReminderPlans(
  tx: DbOrTx,
  row: Activity,
  signal: AbortSignal,
  automate = true,
): Promise<PersonalReminderPlan[]> {
  if (row.dueAt === null || row.done || row.deletedAt !== null) return [];
  const assignmentEnabled = automate && row.reminderAutomationEnabled !== false;
  if (assignmentEnabled) {
    await tx
      .insert(activityReminderSettings)
      .values({
        activityId: row.id,
        userId: row.assigneeId,
        source: "assignment",
        version: 0,
        timeZone: await reminderFallbackTimeZone(tx, row, signal),
      })
      .onConflictDoNothing({
        target: [activityReminderSettings.activityId, activityReminderSettings.userId],
      });
    signal.throwIfAborted();
  }
  const settings = await tx
    .select()
    .from(activityReminderSettings)
    .where(eq(activityReminderSettings.activityId, row.id));
  signal.throwIfAborted();
  const defaults =
    row.calendarId !== null && settings.length > 0
      ? await tx
          .select()
          .from(calendarReminderDefaults)
          .where(
            and(
              eq(calendarReminderDefaults.calendarId, row.calendarId),
              inArray(
                calendarReminderDefaults.userId,
                settings.map((entry) => entry.userId),
              ),
            ),
          )
      : [];
  signal.throwIfAborted();
  const plans: PersonalReminderPlan[] = [];
  for (const entry of settings) {
    if (entry.source === "assignment" && (!assignmentEnabled || entry.userId !== row.assigneeId))
      continue;
    if (!(await mayReceivePersonalReminder(tx, row, entry.userId, signal))) continue;
    const inherited = defaults.find((value) => value.userId === entry.userId);
    plans.push(...personalReminderPolicyPlans(row, entry, inherited));
  }
  return plans;
}
