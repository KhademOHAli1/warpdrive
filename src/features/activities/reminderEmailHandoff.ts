import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { EMAIL_NOTIFICATION_QUEUE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { calendarReminderIntents } from "@/db/schema";
import { resolveDelivery } from "@/features/notifications/preferences";
import { admitReminderIntent } from "./reminderAdmission";
import { lockReminderActivity } from "./reminderLock";

// Called only after the notification transaction commits. The stable notification UUID
// makes enqueue-before-marker recovery idempotent even after a completed queue job.
export async function handoffReminderEmail(
  db: Db,
  boss: PgBoss,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  const [snapshot] = await db
    .select({ activityId: calendarReminderIntents.activityId })
    .from(calendarReminderIntents)
    .where(eq(calendarReminderIntents.id, id));
  signal.throwIfAborted();
  if (snapshot === undefined) return;
  await db.transaction(async (tx) => {
    // Match event writes and delivery: activity, calendar, then receipt.
    const activity = await lockReminderActivity(tx, snapshot.activityId, signal);
    const [intent] = await tx
      .select()
      .from(calendarReminderIntents)
      .where(
        and(
          eq(calendarReminderIntents.id, id),
          eq(calendarReminderIntents.state, "delivered"),
          isNull(calendarReminderIntents.emailEnqueuedAt),
        ),
      )
      .for("update");
    signal.throwIfAborted();
    if (intent?.notificationId == null) return;
    const preference = await resolveDelivery(tx, intent.assigneeId, "activity_reminder", signal);
    const eligible =
      activity !== undefined &&
      intent.email &&
      (await admitReminderIntent(tx, activity, intent, signal, "email"));
    if (eligible && preference.email) {
      await boss.send(
        EMAIL_NOTIFICATION_QUEUE,
        { notificationId: intent.notificationId },
        { id: intent.notificationId },
      );
      signal.throwIfAborted();
    }
    await tx
      .update(calendarReminderIntents)
      // A current policy denial did not enqueue mail. Clear its stale channel so
      // a later deliberate opt-in can reopen handoff on this same receipt.
      .set({ emailEnqueuedAt: new Date(), ...(!eligible ? { email: false } : {}) })
      .where(eq(calendarReminderIntents.id, id));
    signal.throwIfAborted();
  });
}
