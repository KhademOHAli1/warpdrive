import type { AppError } from "@/constants/errorIds";
import type { Activity } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { ok, type Result } from "@/types/result";
import { reconcileReminderIntent } from "./reminderIntent";
import type { PersonalReminderWrite } from "./reminderSettingsSchemas";
import { writePersonalReminderSelection } from "./reminderSettingsWrite";

// The activity transaction owns both the optional personal write and its durable plan.
export async function applyActivityReminders(
  tx: DbOrTx,
  actor: PermSetUser,
  row: Activity,
  input: PersonalReminderWrite | undefined,
  signal: AbortSignal,
  automate = true,
): Promise<Result<void, AppError>> {
  if (input !== undefined) {
    const personal = await writePersonalReminderSelection(tx, actor, row, input, signal);
    if (!personal.ok) return personal;
  }
  await reconcileReminderIntent(tx, row, signal, automate);
  return ok(undefined);
}
