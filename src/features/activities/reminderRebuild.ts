import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities, calendars, reminderRebuilds } from "@/db/schema";
import { reconcileReminderIntent } from "./calendarReminderIntent";

const REBUILD_BATCH_SIZE = 100;
export async function processReminderRebuilds(db: Db, signal: AbortSignal): Promise<number> {
  const rows = await db
    .select({ activityId: reminderRebuilds.activityId })
    .from(reminderRebuilds)
    .orderBy(reminderRebuilds.touchedAt)
    .limit(REBUILD_BATCH_SIZE);
  signal.throwIfAborted();
  let count = 0;
  for (const pending of rows) {
    await db.transaction(async (tx) => {
      // Activity first matches every writer and its AFTER trigger; locking the dirty row
      // first could deadlock against a CRM write that is currently enqueueing this ID.
      const [row] = await tx
        .select()
        .from(activities)
        .where(eq(activities.id, pending.activityId))
        .for("no key update", { skipLocked: true });
      signal.throwIfAborted();
      if (row === undefined) return;
      // ACL triggers hold the calendar lock before enqueueing this dirty row.
      if (row.calendarId !== null) {
        await tx
          .select({ id: calendars.id })
          .from(calendars)
          .where(eq(calendars.id, row.calendarId))
          .for("share");
        signal.throwIfAborted();
      }
      const [request] = await tx
        .select()
        .from(reminderRebuilds)
        .where(eq(reminderRebuilds.activityId, row.id))
        .for("update", { skipLocked: true });
      signal.throwIfAborted();
      if (request === undefined) return;
      await reconcileReminderIntent(tx, row, signal);
      count += 1;
    });
  }
  return count;
}
