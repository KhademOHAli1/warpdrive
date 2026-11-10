import { and, eq, inArray } from "drizzle-orm";
import { type Activity, calendarReminderIntents, reminderRebuilds } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { nativeReminderOwnsActivity } from "./calendarReminderOwnership";
import { loadPersonalReminderPlans, type PersonalReminderPlan } from "./reminderPolicies";
import { reminderTemporalSignature } from "./reminderPolicy";
import { reminderPlanChannelEligible } from "./reminderPolicyPlans";

type Intent = typeof calendarReminderIntents.$inferSelect;
function sameMoment(intent: Intent, plan: PersonalReminderPlan, row: Activity, signature: string) {
  return (
    intent.assigneeId === plan.recipientId &&
    intent.dueAt.getTime() === row.dueAt?.getTime() &&
    intent.fireAt.getTime() === plan.fireAt.getTime() &&
    (intent.eventSignature === signature || intent.eventSignature === "") &&
    (intent.settingsId === plan.settingsId || intent.settingsId === null)
  );
}
export async function reconcileReminderIntent(
  tx: DbOrTx,
  row: Activity,
  signal: AbortSignal,
  enabled = true,
): Promise<void> {
  signal.throwIfAborted();
  // A rebuild from an old writer does not authorize adopting its delivery engine.
  if (await nativeReminderOwnsActivity(tx, row.id, signal)) {
    await tx
      .update(calendarReminderIntents)
      .set({ state: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(calendarReminderIntents.activityId, row.id),
          inArray(calendarReminderIntents.state, ["pending", "dispatched"]),
        ),
      );
    await tx.delete(reminderRebuilds).where(eq(reminderRebuilds.activityId, row.id));
    signal.throwIfAborted();
    return;
  }
  const plans = await loadPersonalReminderPlans(
    tx,
    row,
    signal,
    enabled && row.reminderEngine === "intent",
  );
  const active = await tx
    .select()
    .from(calendarReminderIntents)
    .where(
      and(
        eq(calendarReminderIntents.activityId, row.id),
        inArray(calendarReminderIntents.state, ["pending", "dispatched", "delivered"]),
      ),
    )
    .for("update");
  signal.throwIfAborted();
  const signature = reminderTemporalSignature(row);
  const retained = new Set<string>();
  for (const plan of plans) {
    const previous = active.find(
      (intent) => !retained.has(intent.id) && sameMoment(intent, plan, row, signature),
    );
    const channels = {
      inApp: reminderPlanChannelEligible(plan, "inApp", previous),
      email: reminderPlanChannelEligible(plan, "email", previous),
    };
    // A bulk defaults edit can remove an existing channel, but a newly introduced
    // past rule must not mint work or borrow a delivered receipt's eligibility.
    if (!channels.inApp && !channels.email && previous?.state !== "delivered") continue;
    const snapshot = {
      settingsId: plan.settingsId,
      settingsVersion: plan.settingsVersion,
      defaultsVersion: plan.defaultsVersion,
      eventSignature: signature,
      ...channels,
    };
    if (previous !== undefined) {
      retained.add(previous.id);
      // Only an eligible channel addition may reopen post-commit email handoff.
      await tx
        .update(calendarReminderIntents)
        .set({
          ...snapshot,
          ...(channels.email && !previous.email ? { emailEnqueuedAt: null } : {}),
        })
        .where(eq(calendarReminderIntents.id, previous.id));
    } else if (row.dueAt !== null) {
      await tx.insert(calendarReminderIntents).values({
        ...snapshot,
        activityId: row.id,
        assigneeId: plan.recipientId,
        dueAt: row.dueAt,
        fireAt: plan.fireAt,
      });
    }
    signal.throwIfAborted();
  }
  const cancelled = active.filter((intent) => !retained.has(intent.id)).map((intent) => intent.id);
  if (cancelled.length > 0) {
    await tx
      .update(calendarReminderIntents)
      .set({ state: "cancelled", cancelledAt: new Date() })
      .where(inArray(calendarReminderIntents.id, cancelled));
    signal.throwIfAborted();
  }
  await tx.delete(reminderRebuilds).where(eq(reminderRebuilds.activityId, row.id));
  signal.throwIfAborted();
}
