import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Activity } from "@/db/schema";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { calendarActivityAccess, standaloneCalendarWriter } from "./calendarAccess";
import { resolveActivityVisibility } from "./visibility";
export async function guardActivityMutation(
  db: DbOrTx,
  actor: PermSetUser,
  current: Activity,
  action: "activity.edit" | "activity.delete" | "activity.complete",
  signal: AbortSignal,
  expectedVersion?: number,
): Promise<Result<undefined, AppError>> {
  const vis = await resolveActivityVisibility(db, current, signal);
  const access = await calendarActivityAccess(db, actor, current, signal, true);
  if (vis === null || !canSee(actor, vis) || access?.read === false)
    return err(
      new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "activity not found", { id: current.id }),
    );
  if (
    access?.write === false ||
    (!can(actor, action, vis) && !standaloneCalendarWriter(current, access))
  )
    return err(new AppError(ERROR_IDS.ACTIVITY_FORBIDDEN, "forbidden", { id: current.id }));
  if (expectedVersion !== undefined && expectedVersion !== current.version)
    return err(
      new AppError(ERROR_IDS.ACTIVITY_CONFLICT, "activity revision changed", { id: current.id }),
    );
  return ok(undefined);
}
