import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Activity } from "@/db/schema/activities";
import {
  type ActivityReminderIntent,
  activityReminderIntents,
} from "@/db/schema/activityReminderIntents";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import {
  type ActivityReminderOutcomeReason,
  type ActivityReminderSelectionV1,
  activityReminderSelectionV1,
  activityReminderTimeZone,
} from "./reminderIntentTypes";
import { resolveActivityReminderTime } from "./reminderTime";

export interface ActivityReminderMetadataWrite {
  selection?: ActivityReminderSelectionV1;
  eventTimeZone?: string;
  reminderTimeZone?: string;
}
interface PlannedReminder {
  managed: boolean;
  eventTimeZone: string | null;
  reminderTimeZone: string | null;
  selection: ActivityReminderSelectionV1;
  fireAt: Date | null;
  status: "pending" | "suppressed" | "cancelled";
  lastErrorId: string | null;
  outcomeReason: ActivityReminderOutcomeReason | null;
}

function invalidMetadata(message: string): never {
  throw new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, message);
}
function parsedZone(value: string): string {
  const parsed = activityReminderTimeZone.safeParse(value);
  return parsed.success ? parsed.data : invalidMetadata("Invalid authored reminder time zone");
}
function sameInstant(a: Date | null, b: Date | null): boolean {
  return a?.getTime() === b?.getTime();
}
function startChanged(before: Activity, after: Activity): boolean {
  return (
    !sameInstant(before.dueAt, after.dueAt) ||
    before.allDay !== after.allDay ||
    before.dueDate !== after.dueDate
  );
}
function selectedValue(
  current: ActivityReminderIntent | undefined,
  write: ActivityReminderMetadataWrite,
): ActivityReminderSelectionV1 {
  const parsed = activityReminderSelectionV1.safeParse(
    write.selection ?? current?.selection ?? { kind: "none" },
  );
  return parsed.success ? parsed.data : invalidMetadata("Unsupported reminder selection");
}
function currentIsSame(
  current: ActivityReminderIntent,
  plan: PlannedReminder,
  before: Activity | null,
  after: Activity,
): boolean {
  const stored = activityReminderSelectionV1.safeParse(current.selection);
  return (
    stored.success &&
    current.managed === plan.managed &&
    JSON.stringify(stored.data) === JSON.stringify(plan.selection) &&
    sameInstant(current.fireAt, plan.fireAt) &&
    current.reminderTimeZone === plan.reminderTimeZone &&
    before !== null &&
    before.assigneeId === after.assigneeId &&
    (current.status === "delivered" || before.done === after.done)
  );
}
function reminderPlan(
  current: ActivityReminderIntent | undefined,
  before: Activity | null,
  after: Activity,
  write: ActivityReminderMetadataWrite,
): PlannedReminder {
  const managed = current?.managed === true || write.selection !== undefined;
  const eventTimeZone =
    write.eventTimeZone !== undefined && (before === null || startChanged(before, after))
      ? parsedZone(write.eventTimeZone)
      : (current?.eventTimeZone ?? null);
  const selection = selectedValue(current, write);
  const reminderTimeZone =
    write.reminderTimeZone === undefined
      ? (current?.reminderTimeZone ?? (selection.kind === "none" ? null : eventTimeZone))
      : parsedZone(write.reminderTimeZone);
  return resolvePlanSchedule(after, write, { managed, eventTimeZone, reminderTimeZone, selection });
}
function resolvePlanSchedule(
  after: Activity,
  write: ActivityReminderMetadataWrite,
  metadata: Pick<PlannedReminder, "managed" | "eventTimeZone" | "reminderTimeZone" | "selection">,
): PlannedReminder {
  const { managed, selection, reminderTimeZone } = metadata;
  if (managed && selection.kind !== "none" && after.leadId !== null)
    invalidMetadata("Lead-linked events do not support native in-app reminders");
  const resolved = resolveActivityReminderTime(
    { ...after, reminderTimeZone },
    managed ? selection : { kind: "none" },
  );
  if (!resolved.ok && write.selection !== undefined)
    invalidMetadata(`Invalid reminder schedule: ${resolved.issue}`);
  // An older caller may clear a date or change event kind without knowing the
  // stored selection. Keep that selection, invalidate old work and expose its
  // cancellation/suppression instead of silently dropping it or blocking the edit.
  const fireAt = !resolved.ok || resolved.fireAt === null ? null : new Date(resolved.fireAt);
  const cancelled =
    !managed ||
    selection.kind === "none" ||
    after.done ||
    after.deletedAt !== null ||
    (!resolved.ok && resolved.issue === "missing_start");
  const status = cancelled ? "cancelled" : resolved.ok ? "pending" : "suppressed";
  const lastErrorId = status === "suppressed" ? ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID : null;
  const outcomeReason = planOutcomeReason(managed, selection, after, resolved.ok);
  return { ...metadata, fireAt, status, lastErrorId, outcomeReason };
}
function planOutcomeReason(
  managed: boolean,
  selection: ActivityReminderSelectionV1,
  after: Activity,
  validSchedule: boolean,
): ActivityReminderOutcomeReason | null {
  if (!managed) return null;
  if (selection.kind === "none") return "disabled";
  if (after.done || after.deletedAt !== null) return "event_cancelled";
  return validSchedule ? null : "invalid_schedule";
}
async function saveIntent(
  tx: DbOrTx,
  activityId: string,
  plan: PlannedReminder,
  signal: AbortSignal,
): Promise<ActivityReminderIntent> {
  const mutable = {
    ...plan,
    generationId: randomUUID(),
    notificationId: null,
    attemptCount: 0,
    attemptVersion: randomUUID(),
    nextAttemptAt: null,
    outcomeAt: plan.status === "pending" ? null : sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  };
  const [intent] = await tx
    .insert(activityReminderIntents)
    .values({
      activityId,
      version: 1,
      channel: "in_app",
      ...mutable,
    })
    .onConflictDoUpdate({
      target: activityReminderIntents.activityId,
      set: mutable,
    })
    .returning();
  if (intent === undefined) invalidMetadata("Reminder intent write returned no row");
  signal.throwIfAborted();
  return intent;
}
async function saveAuthoredZone(
  tx: DbOrTx,
  activityId: string,
  eventTimeZone: string | null,
  signal: AbortSignal,
): Promise<ActivityReminderIntent> {
  const [updated] = await tx
    .update(activityReminderIntents)
    .set({ eventTimeZone, updatedAt: sql`clock_timestamp()` })
    .where(eq(activityReminderIntents.activityId, activityId))
    .returning();
  if (updated === undefined) invalidMetadata("Reminder metadata update returned no row");
  signal.throwIfAborted();
  return updated;
}

// Caller owns the actual activity row lock/insert in this same transaction.
// When current authority is checked, its outer shared fence precedes that lock.
// This helper never acquires an authority fence after an activity/intent lock.
export async function synchronizeActivityReminder(
  tx: DbOrTx,
  before: Activity | null,
  after: Activity,
  write: ActivityReminderMetadataWrite,
  signal: AbortSignal,
): Promise<ActivityReminderIntent | null> {
  signal.throwIfAborted();
  const [current] = await tx
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, after.id))
    .for("update");
  if (current !== undefined && current.version !== 1)
    invalidMetadata("Unsupported reminder protocol version");
  if (
    current === undefined &&
    write.selection === undefined &&
    write.eventTimeZone === undefined &&
    write.reminderTimeZone === undefined
  )
    return null;
  const plan = reminderPlan(current, before, after, write);
  if (current !== undefined && currentIsSame(current, plan, before, after))
    return current.eventTimeZone === plan.eventTimeZone
      ? current
      : saveAuthoredZone(tx, after.id, plan.eventTimeZone, signal);
  return saveIntent(tx, after.id, plan, signal);
}

// Complete/delete callers already hold the activity row. Delivery that committed
// first remains delivered; a later cancellation cannot claim it was never shown.
export async function cancelActivityReminder(
  tx: DbOrTx,
  activityId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const [current] = await tx
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activityId))
    .for("update");
  if (current === undefined || !current.managed || current.version !== 1) return;
  if (current.status === "delivered" || current.status === "cancelled") return;
  await tx
    .update(activityReminderIntents)
    .set({
      generationId: randomUUID(),
      status: "cancelled",
      nextAttemptAt: null,
      lastErrorId: null,
      outcomeReason: "event_cancelled",
      outcomeAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(activityReminderIntents.activityId, activityId));
  signal.throwIfAborted();
}

// Optional for existing domain callers, mandatory for the selected Calendar edit
// envelope. Caller has already locked and visibility/permission-gated the event.
export async function assertActivityReminderGeneration(
  tx: DbOrTx,
  activityId: string,
  expected: string | null | undefined,
  signal: AbortSignal,
): Promise<Result<undefined, AppError>> {
  if (expected === undefined) return ok(undefined);
  const [current] = await tx
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activityId))
    .for("update");
  signal.throwIfAborted();
  const actual =
    current !== undefined && (current.managed || current.version !== 1)
      ? current.generationId
      : null;
  if ((expected?.toLowerCase() ?? null) !== actual)
    return err(new AppError(ERROR_IDS.ACTIVITY_REMINDER_STALE, "Reminder selection changed"));
  return ok(undefined);
}
