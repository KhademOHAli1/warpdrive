import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, type Result } from "@/types/result";
import { withCalendarActor } from "../../calendarNativeAuthority";

export async function withCalendarDomainActor<T, E>(
  db: Db,
  session: NativeSessionRef,
  signal: AbortSignal,
  command: (tx: Db) => Promise<Result<T, E>>,
  denied: E,
): Promise<Result<T, E>> {
  const failure: { value: E | null } = { value: null };
  const current = await withCalendarActor(db, session, session.userId, signal, async (tx) => {
    const result = await command(tx);
    if (result.ok) return result;
    failure.value = result.error;
    return err(new AppError(ERROR_IDS.CALENDAR_ACCOUNT_INPUT_INVALID, "Calendar command denied"));
  });
  return current.ok ? current : err(failure.value ?? denied);
}
