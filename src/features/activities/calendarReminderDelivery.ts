import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Db } from "@/db/client";
import { calendarReminderIntents } from "@/db/schema";
import { createNotification } from "@/features/notifications/produce";
import { activityParentRef } from "./notifyHelpers";
import { admitReminderIntent } from "./reminderAdmission";
import { handoffReminderEmail } from "./reminderEmailHandoff";
import { lockReminderActivity } from "./reminderLock";

const reminderJobData = z.object({ intentId: z.uuid() });

export async function deliverReminderIntent(
  db: Db,
  data: unknown,
  signal: AbortSignal,
  boss: PgBoss | null,
): Promise<void> {
  signal.throwIfAborted();
  // Old activity-only queue payloads lack a due snapshot. Never deliver them against
  // a possibly rescheduled event. Migration backfill restores future reminder intent.
  const parsed = reminderJobData.safeParse(data);
  if (!parsed.success) return;
  const id = parsed.data.intentId;
  const [snapshot] = await db
    .select()
    .from(calendarReminderIntents)
    .where(eq(calendarReminderIntents.id, id));
  signal.throwIfAborted();
  if (snapshot === undefined) return;
  await db.transaction(async (tx) => {
    // Match event-mutation lock order so completion/rescheduling/revocation serialize.
    const activity = await lockReminderActivity(tx, snapshot.activityId, signal);
    const [intent] = await tx
      .select()
      .from(calendarReminderIntents)
      .where(eq(calendarReminderIntents.id, id))
      .for("update");
    signal.throwIfAborted();
    if (intent === undefined || intent.state === "cancelled" || intent.state === "delivered")
      return;
    if (activity === undefined || !(await admitReminderIntent(tx, activity, intent, signal))) {
      await tx
        .update(calendarReminderIntents)
        .set({ state: "cancelled", cancelledAt: new Date() })
        .where(eq(calendarReminderIntents.id, id));
      signal.throwIfAborted();
      return;
    }
    if (intent.fireAt.getTime() > Date.now()) return;
    const parent = activityParentRef(activity);
    const produced = await createNotification(
      tx,
      {
        recipientId: intent.assigneeId,
        type: "activity_reminder",
        actorId: null,
        entityType: parent.entityType,
        entityId: parent.entityId,
        payload: {
          activityId: activity.id,
          reminderIntentId: intent.id,
          subject: activity.subject,
          dueAt: intent.dueAt.toISOString(),
        },
      },
      signal,
    );
    if (!produced.ok) throw produced.error;
    const suppressed = "suppressed" in produced.value;
    await tx
      .update(calendarReminderIntents)
      .set({
        state: suppressed ? "cancelled" : "delivered",
        deliveredAt: suppressed ? null : new Date(),
        cancelledAt: suppressed ? new Date() : null,
        notificationId: "notificationId" in produced.value ? produced.value.notificationId : null,
      })
      .where(eq(calendarReminderIntents.id, id));
    signal.throwIfAborted();
  });
  if (boss !== null) await handoffReminderEmail(db, boss, id, signal);
}
