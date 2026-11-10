import { eq } from "drizzle-orm";
import { activities, calendars } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export async function lockReminderActivity(tx: DbOrTx, activityId: string, signal: AbortSignal) {
  const [activity] = await tx
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .for("no key update");
  signal.throwIfAborted();
  if (activity?.calendarId != null) {
    await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.id, activity.calendarId))
      .for("share");
    signal.throwIfAborted();
  }
  return activity;
}
