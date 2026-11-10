import { and, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Activity, activityReminderSettings, calendarReminderDefaults } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { nativeReminderOwnsActivity } from "./calendarReminderOwnership";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";
import { advanceReminderRuleActivations } from "./reminderRuleActivation";
import { assertReminderActivityReadable } from "./reminderSettingsAccess";
import type { CalendarReminderWrite, PersonalReminderWrite } from "./reminderSettingsSchemas";
import { reminderSettingsTimeZone } from "./reminderSettingsState";

function conflict() {
  return err(new AppError(ERROR_IDS.ACTIVITY_CONFLICT, "personal reminder revision changed"));
}
export async function writePersonalReminderSelection(
  tx: DbOrTx,
  actor: PermSetUser,
  row: Activity,
  input: PersonalReminderWrite,
  signal: AbortSignal,
): Promise<Result<{ revision: number }, AppError>> {
  // The caller holds the activity lock (or inserted it), matching delivery's lock order.
  const readable = await assertReminderActivityReadable(tx, actor, row, signal, true);
  if (!readable.ok) return readable;
  if (await nativeReminderOwnsActivity(tx, row.id, signal)) return conflict();
  const key = and(
    eq(activityReminderSettings.activityId, row.id),
    eq(activityReminderSettings.userId, actor.id),
  );
  const [current] = await tx.select().from(activityReminderSettings).where(key).for("update");
  signal.throwIfAborted();
  if ((current?.version ?? 0) !== input.expectedRevision) return conflict();
  const timeZone = await reminderSettingsTimeZone(tx, actor, row, current?.timeZone, signal);
  const values = {
    source: "personal" as const,
    useDefault: input.selection.useDefault,
    rules: input.selection.useDefault
      ? DEFAULT_REMINDER_RULES
      : { timed: input.selection.timed, allDay: input.selection.allDay },
    timeZone,
    updatedAt: new Date(),
    version: (current?.version ?? 0) + 1,
  };
  const [saved] =
    current === undefined
      ? await tx
          .insert(activityReminderSettings)
          .values({ ...values, activityId: row.id, userId: actor.id })
          .onConflictDoNothing()
          .returning()
      : await tx.update(activityReminderSettings).set(values).where(key).returning();
  signal.throwIfAborted();
  return saved === undefined ? conflict() : ok({ revision: saved.version });
}
export async function writeCalendarReminderDefaults(
  tx: DbOrTx,
  actor: PermSetUser,
  input: CalendarReminderWrite,
  signal: AbortSignal,
): Promise<Result<{ revision: number }, AppError>> {
  const key = and(
    eq(calendarReminderDefaults.calendarId, input.calendarId),
    eq(calendarReminderDefaults.userId, actor.id),
  );
  const [current] = await tx.select().from(calendarReminderDefaults).where(key).for("update");
  signal.throwIfAborted();
  if ((current?.version ?? 0) !== input.expectedRevision) return conflict();
  const now = new Date();
  const revision = (current?.version ?? 0) + 1;
  const values = {
    rules: input.defaults,
    ruleActivations: advanceReminderRuleActivations(
      current,
      input.defaults,
      revision,
      now.getTime(),
    ),
    version: revision,
    updatedAt: now,
  };
  const [saved] =
    current === undefined
      ? await tx
          .insert(calendarReminderDefaults)
          .values({ ...values, calendarId: input.calendarId, userId: actor.id })
          .onConflictDoNothing()
          .returning()
      : await tx.update(calendarReminderDefaults).set(values).where(key).returning();
  signal.throwIfAborted();
  return saved === undefined ? conflict() : ok({ revision: saved.version });
}
