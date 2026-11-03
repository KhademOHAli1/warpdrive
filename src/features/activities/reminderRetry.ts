import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activities } from "@/db/schema/activities";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { resolveActivityVisibility } from "./visibility";

// Called inside the interactive native authority transaction. Retry keeps the
// same current generation: it cannot create an event or replay a known delivery.
export async function retryActivityReminder(
  db: Db,
  actor: PermSetUser,
  activityId: string,
  expectedGenerationId: string,
  signal: AbortSignal,
): Promise<Result<{ id: string }, AppError>> {
  return db.transaction(async (tx) => {
    const [activity] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), isNull(activities.deletedAt)))
      .for("update");
    if (activity === undefined)
      return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "Activity not found"));
    const vis = await resolveActivityVisibility(tx, activity, signal);
    if (vis === null || !canSee(actor, vis))
      return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "Activity not found"));
    if (!can(actor, "activity.edit", vis))
      return err(new AppError(ERROR_IDS.ACTIVITY_FORBIDDEN, "Reminder retry forbidden"));
    const [intent] = await tx
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, activityId))
      .for("update");
    signal.throwIfAborted();
    if (
      intent === undefined ||
      !intent.managed ||
      intent.version !== 1 ||
      intent.generationId !== expectedGenerationId.toLowerCase()
    )
      return err(new AppError(ERROR_IDS.ACTIVITY_REMINDER_STALE, "Reminder selection changed"));
    if (intent.status === "delivered") return ok({ id: activityId });
    if (
      activity.done ||
      activity.leadId !== null ||
      intent.status === "cancelled" ||
      intent.fireAt === null ||
      intent.outcomeReason === "event_finished"
    )
      return err(
        new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Reminder is not retryable"),
      );
    if (intent.status !== "pending") {
      await tx
        .update(activityReminderIntents)
        .set({
          status: "pending",
          attemptVersion: randomUUID(),
          nextAttemptAt: sql`clock_timestamp()`,
          lastErrorId: null,
          outcomeReason: null,
          outcomeAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(activityReminderIntents.activityId, activityId));
    }
    signal.throwIfAborted();
    return ok({ id: activityId });
  });
}
