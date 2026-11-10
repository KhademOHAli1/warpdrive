import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type Activity, activities } from "@/db/schema/activities";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { guardActivityMutation } from "./activityAccessGuard";
import { updateActivity } from "./activityUpdate";
import {
  calendarReschedulePatch,
  calendarScheduleMatches,
  calendarScheduleSnapshot,
} from "./calendarReschedulePlan";
import { type CalendarRescheduleValue, calendarRescheduleInput } from "./calendarRescheduleSchemas";
import { verifyCalendarUndo } from "./calendarRescheduleUndo";
import { readActivityReminderView } from "./reminderReadModel";

function persistedSchedule(current: Activity): CalendarRescheduleValue {
  if (current.dueAt === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Moved event lost its date");
  return { id: current.id, ...calendarScheduleSnapshot({ ...current, dueAt: current.dueAt }) };
}

export async function rescheduleCalendarEvent(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
  sessionId?: string,
): Promise<Result<CalendarRescheduleValue, AppError>> {
  signal.throwIfAborted();
  const parsed = calendarRescheduleInput.safeParse(raw);
  if (!parsed.success)
    return err(
      new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Invalid calendar reschedule"),
    );
  const input = parsed.data;
  const target = input.target;
  const undo = "undo" in target ? target.undo : undefined;
  if (
    "undo" in target &&
    (sessionId === undefined ||
      !verifyCalendarUndo(
        {
          actorId: actor.id,
          sessionId,
          id: input.id,
          timeZone: input.timeZone,
          expected: input.expected,
          original: target.undo,
        },
        target.token,
      ))
  ) {
    return err(new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Invalid calendar undo"));
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, input.id), isNull(activities.deletedAt)))
      .for("no key update");
    signal.throwIfAborted();
    if (current === undefined)
      return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "Activity not found"));
    const allowed = await guardActivityMutation(tx, actor, current, "activity.edit", signal);
    if (!allowed.ok) return allowed;
    // Keep this comparison inside the row lock. Calling updateActivity alone after
    // an unlocked read would let a later drop overwrite an intervening move.
    if (!calendarScheduleMatches(current, input.expected))
      return err(new AppError(ERROR_IDS.ACTIVITY_SCHEDULE_STALE, "Activity schedule changed"));
    let patch: ReturnType<typeof calendarReschedulePatch>;
    try {
      patch =
        "undo" in target
          ? {
              dueAt: target.undo.dueAt,
              endAt: target.undo.endAt,
              allDay: target.undo.allDay,
              authoredTimeZone: input.timeZone,
            }
          : calendarReschedulePatch(input.expected, target, input.timeZone);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return err(
        new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Invalid calendar reschedule target"),
      );
    }
    if (patch === null) return ok(persistedSchedule(current));
    const reminder = await readActivityReminderView(tx, current.id, signal);
    const result = await updateActivity(
      tx,
      actor,
      {
        id: current.id,
        ...patch,
        expectedReminderGeneration: reminder.reminder?.generationId ?? null,
      },
      signal,
      undo === undefined
        ? undefined
        : {
            calendarUndo: {
              dueDate: undo.dueDate,
              endDate: undo.endDate,
              durationMinutes: undo.durationMinutes,
            },
          },
    );
    if (!result.ok) return result;
    return ok(persistedSchedule(result.value));
  });
}
