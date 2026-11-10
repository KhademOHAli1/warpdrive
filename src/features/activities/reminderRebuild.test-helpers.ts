import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityReminderIntents, reminderRebuilds } from "@/db/schema";
import { setEventReminderSettings } from "./personalReminderSettings";
import { reminderFixture, sig } from "./reminderSettings.test-helpers";

export async function subscribedFixture(db: Db) {
  const fixture = await reminderFixture(db);
  const subscribed = await setEventReminderSettings(
    db,
    fixture.reader,
    {
      activityId: fixture.event.id,
      expectedRevision: 0,
      selection: { useDefault: true },
    },
    sig(),
  );
  if (!subscribed.ok) throw subscribed.error;
  return fixture;
}
export function activeReminders(db: Db, activityId: string, userId?: string) {
  return db
    .select()
    .from(activityReminderIntents)
    .where(
      and(
        eq(activityReminderIntents.activityId, activityId),
        userId === undefined ? undefined : eq(activityReminderIntents.assigneeId, userId),
        inArray(activityReminderIntents.state, ["pending", "dispatched"]),
      ),
    );
}
export async function queuedRebuilds(db: Db) {
  return (await db.select().from(reminderRebuilds)).map((row) => row.activityId);
}
