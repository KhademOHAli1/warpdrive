import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type Activity, activities } from "@/db/schema/activities";
import {
  type ActivityReminderIntent,
  activityReminderIntents,
} from "@/db/schema/activityReminderIntents";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { resolveDelivery } from "@/features/notifications/preferences";
import { createNotification } from "@/features/notifications/produce";
import { canSee } from "@/features/permissions/canSee";
import { hydrateActor } from "@/server/hydrateActor";
import { personalReminderOwnsAssignee } from "./calendarReminderOwnership";
import { activityParentRef } from "./notifyHelpers";
import { activityReminderDueState } from "./reminderEligibility";
import { cancelActivityReminder } from "./reminderIntent";
import {
  type ActivityReminderOutcomeReason,
  activityReminderSelectionV1,
} from "./reminderIntentTypes";
import { lockReminderParent, reminderDatabaseNow } from "./reminderLocks";
import { resolveActivityVisibility } from "./visibility";

export interface ActivityReminderWorkResult {
  state:
    | "missing"
    | "stale"
    | "not_due"
    | "cancelled"
    | "completed"
    | "delivered"
    | "suppressed"
    | "unsupported"
    | "legacy";
  legacyNotification?: { notificationId: string; recipientId: string };
  legacyReschedule?: { activityId: string; dueAt: Date };
}
class SuppressedReminderEffect extends AppError {
  constructor(readonly reason: ActivityReminderOutcomeReason) {
    super(ERROR_IDS.NOTIF_PRODUCE_FAILED, "Reminder no longer eligible at final checkpoint");
  }
}

async function currentRecipientAllowed(
  tx: Db,
  activity: Activity,
  signal: AbortSignal,
): Promise<boolean> {
  const recipient = await hydrateActor(tx, activity.assigneeId, signal);
  if (recipient === null) return false;
  const vis = await resolveActivityVisibility(tx, activity, signal);
  return vis !== null && canSee(recipient, vis);
}
async function managedEligibility(
  tx: Db,
  activity: Activity,
  intent: ActivityReminderIntent,
  signal: AbortSignal,
): Promise<ActivityReminderOutcomeReason | "not_due" | null> {
  if (activity.leadId !== null) return "unsupported_parent";
  const choice = activityReminderSelectionV1.safeParse(intent.selection);
  if (
    !choice.success ||
    choice.data.kind === "none" ||
    intent.fireAt === null ||
    intent.reminderTimeZone === null
  )
    return "invalid_schedule";
  if (!(await currentRecipientAllowed(tx, activity, signal))) return "not_available";
  const delivery = await resolveDelivery(tx, activity.assigneeId, "activity_reminder", signal);
  if (!delivery.inApp) return "not_available";
  const now = await reminderDatabaseNow(tx);
  const due = activityReminderDueState(
    activity,
    intent.fireAt,
    intent.eventTimeZone ?? intent.reminderTimeZone,
    now,
  );
  return due === "due" ? null : due;
}
async function setOutcome(
  tx: Db,
  activityId: string,
  status: "suppressed" | "delivered",
  reason: ActivityReminderOutcomeReason | null,
  notificationId: string | null,
): Promise<void> {
  await tx
    .update(activityReminderIntents)
    .set({
      status,
      outcomeReason: reason,
      notificationId,
      attemptCount: sql`${activityReminderIntents.attemptCount} + 1`,
      attemptVersion: randomUUID(),
      nextAttemptAt: null,
      lastErrorId: null,
      outcomeAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(activityReminderIntents.activityId, activityId));
}
function notificationInput(activity: Activity) {
  return {
    recipientId: activity.assigneeId,
    type: "activity_reminder" as const,
    ...activityParentRef(activity),
    actorId: null,
    payload: {
      activityId: activity.id,
      subject: activity.subject,
      dueAt: activity.dueAt?.toISOString() ?? null,
    },
  };
}
async function deliverManaged(
  tx: Db,
  activity: Activity,
  intent: ActivityReminderIntent,
  signal: AbortSignal,
): Promise<ActivityReminderWorkResult> {
  if (intent.status === "delivered") return { state: "completed" };
  if (intent.status === "cancelled") return { state: "cancelled" };
  if (intent.status === "suppressed") return { state: "suppressed" };
  const now = await reminderDatabaseNow(tx);
  if (intent.nextAttemptAt !== null && intent.nextAttemptAt.getTime() > now.getTime())
    return { state: "not_due" };
  await lockReminderParent(tx, activity, signal);
  // Covers an absent preference row as well as updates. This table-wide SHARE
  // lock can temporarily delay preference writes, with inherited tighter SQL/
  // lock deadlines; no queue/provider I/O occurs while it is held.
  await tx.execute(sql`LOCK TABLE notification_preferences IN SHARE MODE`);
  const eligibility = await managedEligibility(tx, activity, intent, signal);
  if (eligibility === "not_due") return { state: "not_due" };
  if (eligibility !== null) {
    await setOutcome(tx, activity.id, "suppressed", eligibility, null);
    return { state: "suppressed" };
  }
  const created = await createNotification(
    tx,
    {
      ...notificationInput(activity),
      payload: {
        ...notificationInput(activity).payload,
        reminderGenerationId: intent.generationId,
      },
    },
    signal,
  );
  if (!created.ok) throw created.error;
  if ("suppressed" in created.value) {
    await setOutcome(tx, activity.id, "suppressed", "not_available", null);
    return { state: "suppressed" };
  }
  await setOutcome(tx, activity.id, "delivered", null, created.value.notificationId);
  const final = await managedEligibility(tx, activity, intent, signal);
  if (final !== null)
    throw new SuppressedReminderEffect(final === "not_due" ? "invalid_schedule" : final);
  signal.throwIfAborted();
  return { state: "delivered" };
}

// Legacy is deliberately separate: existing email preference behavior remains,
// and no unproven historical notification is transferred into a native receipt.
async function deliverLegacy(
  tx: Db,
  activity: Activity,
  signal: AbortSignal,
): Promise<ActivityReminderWorkResult> {
  if (activity.dueAt === null) return { state: "cancelled" };
  const fireAt = new Date(activity.dueAt.getTime() - 10 * 60_000);
  const now = await reminderDatabaseNow(tx);
  if (now.getTime() < fireAt.getTime())
    return {
      state: "not_due",
      legacyReschedule: { activityId: activity.id, dueAt: activity.dueAt },
    };
  await lockReminderParent(tx, activity, signal);
  if (!(await currentRecipientAllowed(tx, activity, signal))) return { state: "suppressed" };
  const created = await createNotification(tx, notificationInput(activity), signal);
  if (!created.ok) throw created.error;
  if ("suppressed" in created.value) return { state: "suppressed" };
  return {
    state: "legacy",
    legacyNotification: {
      notificationId: created.value.notificationId,
      recipientId: activity.assigneeId,
    },
  };
}

async function recordDeferredOutcome(
  db: Db,
  activityId: string,
  generationId: string,
  attemptVersion: string,
  reason: ActivityReminderOutcomeReason | null,
): Promise<void> {
  const signal = AbortSignal.timeout(5000);
  await withCurrentAuthority(db, "read", signal, async (tx) => {
    const [activity] = await tx
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .for("update");
    if (activity === undefined || activity.done || activity.deletedAt !== null) return;
    const [intent] = await tx
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, activityId))
      .for("update");
    if (
      intent === undefined ||
      !intent.managed ||
      intent.version !== 1 ||
      intent.generationId !== generationId ||
      intent.attemptVersion !== attemptVersion ||
      intent.status === "delivered" ||
      intent.status === "cancelled" ||
      intent.status === "suppressed"
    )
      return;
    await tx
      .update(activityReminderIntents)
      .set({
        status: reason === null ? "failed" : "suppressed",
        outcomeReason: reason,
        lastErrorId: reason === null ? ERROR_IDS.NOTIF_PRODUCE_FAILED : null,
        attemptCount: sql`${activityReminderIntents.attemptCount} + 1`,
        attemptVersion: randomUUID(),
        nextAttemptAt: reason === null ? sql`clock_timestamp() + interval '30 seconds'` : null,
        outcomeAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(activityReminderIntents.activityId, activityId));
  });
}

export async function processActivityReminder(
  db: Db,
  activityId: string,
  expectedGenerationId: string | undefined,
  signal: AbortSignal,
): Promise<ActivityReminderWorkResult> {
  const matched: { generationId: string | null; attemptVersion: string | null } = {
    generationId: null,
    attemptVersion: null,
  };
  try {
    return await withCurrentAuthority<ActivityReminderWorkResult>(
      db,
      "read",
      signal,
      async (tx) => {
        const [activity] = await tx
          .select()
          .from(activities)
          .where(eq(activities.id, activityId))
          .for("update");
        if (activity === undefined) return { state: "missing" };
        const [intent] = await tx
          .select()
          .from(activityReminderIntents)
          .where(eq(activityReminderIntents.activityId, activityId))
          .for("update");
        if (
          expectedGenerationId !== undefined &&
          (intent === undefined ||
            !intent.managed ||
            intent.generationId !== expectedGenerationId.toLowerCase() ||
            intent.version !== 1)
        )
          return { state: "stale" };
        if (intent !== undefined && (intent.version !== 1 || intent.channel !== "in_app"))
          return { state: "unsupported" };
        if (activity.done || activity.deletedAt !== null) {
          await cancelActivityReminder(tx, activity.id, signal);
          return { state: "cancelled" };
        }
        if (intent?.managed === true) {
          matched.generationId = intent.generationId;
          matched.attemptVersion = intent.attemptVersion;
          return deliverManaged(tx, activity, intent, signal);
        }
        if (
          activity.reminderEngine === "intent" ||
          (await personalReminderOwnsAssignee(tx, activity.id, activity.assigneeId, signal))
        )
          return { state: "cancelled" };
        return deliverLegacy(tx, activity, signal);
      },
    );
  } catch (error) {
    const { generationId, attemptVersion } = matched;
    if (generationId !== null && attemptVersion !== null) {
      try {
        await recordDeferredOutcome(
          db,
          activityId,
          generationId,
          attemptVersion,
          error instanceof SuppressedReminderEffect ? error.reason : null,
        );
      } catch {
        console.warn("Reminder outcome could not be recorded; durable generation retained");
      }
    }
    if (error instanceof SuppressedReminderEffect) return { state: "suppressed" };
    throw error;
  }
}
