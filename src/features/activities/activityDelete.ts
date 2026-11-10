import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activities } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { guardActivityMutation } from "./activityAccessGuard";
import { activityTransaction } from "./activityTransaction";
import { reconcileReminderIntent } from "./calendarReminderIntent";
import { recomputeDealActivityDates } from "./nextActivity";
import { cancelActivityReminder } from "./reminderIntent";

// Soft-delete: mirrors completeActivity's gate order (load -> visibility 404 -> permission 403 ->
// mutate), but gates on "activity.delete" instead of "activity.complete". Unlike edit/complete,
// delete has no assignee exception (see can.ts): only the owner (with activity.delete_own/_any)
// or an admin may delete.
export async function deleteActivity(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
  expectedVersion?: number,
): Promise<Result<{ id: string }, AppError>> {
  return activityTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), isNull(activities.deletedAt)))
      .for("no key update");

    if (current === undefined) {
      return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "activity not found", { id }));
    }

    const allowed = await guardActivityMutation(
      tx,
      actor,
      current,
      "activity.delete",
      signal,
      expectedVersion,
    );
    if (!allowed.ok) return allowed;
    const [row] = await tx
      .update(activities)
      .set({ deletedAt: new Date() })
      .where(eq(activities.id, id))
      .returning();

    if (row === undefined) {
      return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "activity delete returned no rows", {}));
    }

    await cancelActivityReminder(tx, row.id, signal);

    if (row.dealId !== null) {
      await recomputeDealActivityDates(tx, row.dealId, signal);
    }

    await reconcileReminderIntent(tx, row, signal);
    return ok({ id: row.id });
  });
}
