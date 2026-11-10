import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import {
  type CurrentNativeActor,
  currentNativeActor,
  type NativeSessionRef,
} from "@/features/auth/currentNativeActor";
import { err, type Result } from "@/types/result";

class CalendarCommandRollback extends AppError {
  constructor(readonly failure: AppError) {
    super(ERROR_IDS.DB_WRITE_FAILED, "Calendar command rolled back");
  }
}
function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  return (
    (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((value) => b?.has(value) === true)
  );
}
function samePolicy(a: CurrentNativeActor, b: CurrentNativeActor): boolean {
  return (
    a.actor.id === b.actor.id &&
    a.actor.isActive === b.actor.isActive &&
    a.actor.type === b.actor.type &&
    a.primaryVisibilityGroupId === b.primaryVisibilityGroupId &&
    sameSet(a.actor.flags, b.actor.flags) &&
    sameSet(a.actor.groupIds, b.actor.groupIds) &&
    sameSet(a.actor.managedUserIds, b.actor.managedUserIds)
  );
}
function sessionDenied(): AppError {
  return new AppError(ERROR_IDS.AUTH_SESSION_DEAD, "Calendar session is no longer current");
}

// Interactive Calendar commands only. Async reminder workers use current active
// recipient authority instead; they must not depend on the author's old session.
// This outer fence is acquired before the callback can lock an activity/intent.
export async function withCalendarActor<T>(
  db: Db,
  who: NativeSessionRef,
  expectedActorId: string,
  signal: AbortSignal,
  command: (tx: Db, actor: CurrentNativeActor["actor"]) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  const expected = z.string().uuid().safeParse(expectedActorId);
  if (!expected.success)
    return err(
      new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Invalid Calendar actor precondition"),
    );
  if (expected.data.toLowerCase() !== who.userId.toLowerCase()) return err(sessionDenied());
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const current = await currentNativeActor(tx, who, signal);
      if (current === null) throw new CalendarCommandRollback(sessionDenied());
      let result: Result<T, AppError>;
      try {
        result = await command(tx, current.actor);
      } catch (error) {
        if (error instanceof AppError) throw new CalendarCommandRollback(error);
        throw error;
      }
      if (!result.ok) throw new CalendarCommandRollback(result.error);
      const final = await currentNativeActor(tx, who, signal);
      if (final === null || !samePolicy(current, final))
        throw new CalendarCommandRollback(sessionDenied());
      signal.throwIfAborted();
      return result;
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CalendarCommandRollback) return err(error.failure);
    // Unknown driver/commit failures are not proof that no event was saved.
    throw error;
  }
}
