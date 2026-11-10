import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import type { AppContext } from "@/server/trpc/context";
import { err, type Result } from "@/types/result";
import { withCalendarActor } from "./calendarNativeAuthority";

export async function runCalendarSettingsCommand<T>(
  context: AppContext,
  signal: AbortSignal,
  command: (db: Db, actor: PermSetUser) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  signal.throwIfAborted();
  return context.actor === null || context.session === null
    ? err(new AppError(ERROR_IDS.AUTH_SESSION_DEAD, "Calendar session is unavailable"))
    : withCalendarActor(context.db, context.session, context.actor.id, signal, command);
}
