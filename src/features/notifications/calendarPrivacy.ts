import { eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { type Activity, activities, calendarReminderIntents } from "@/db/schema";
import { loadCalendarAccess } from "@/features/activities/calendarAccess";
import {
  admitReminderIntent,
  canUseLegacyReminderPolicy,
} from "@/features/activities/reminderAdmission";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";

interface ActivityNotification {
  type: string;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
}
interface ReminderReceiptNotification extends ActivityNotification {
  id: string;
  userId: string;
}

const activityIdSchema = z.uuid();
function activityId(row: ActivityNotification): string | null {
  if (row.type !== "activity_assigned" && row.type !== "activity_reminder") return null;
  const parsed = activityIdSchema.safeParse(
    "activityId" in row.payload
      ? row.payload.activityId
      : row.entityType === "activity"
        ? row.entityId
        : null,
  );
  return parsed.success ? parsed.data : null;
}

// Activity notification links still target the CRM parent. Calendar detail access is an
// additional gate, so a null parent must never turn a native event into a system notification.
export async function loadNotificationCalendarAccess(
  db: DbOrTx,
  actor: AuthUser,
  rows: ActivityNotification[],
  signal: AbortSignal,
): Promise<Map<string, boolean>> {
  signal.throwIfAborted();
  const ids = [
    ...new Set(
      rows.flatMap((row) => {
        const id = activityId(row);
        return id === null ? [] : [id];
      }),
    ),
  ];
  const result = new Map(ids.map((id) => [id, false]));
  if (ids.length === 0) return result;
  const activityRows = await db
    .select({
      id: activities.id,
      calendarId: activities.calendarId,
      deletedAt: activities.deletedAt,
    })
    .from(activities)
    .where(inArray(activities.id, ids));
  signal.throwIfAborted();
  const access = await loadCalendarAccess(
    db,
    actor,
    activityRows.filter((row) => row.calendarId !== null).map((row) => row.id),
    signal,
  );
  for (const row of activityRows) {
    result.set(
      row.id,
      row.deletedAt === null && (row.calendarId === null || access.get(row.id)?.read === true),
    );
  }
  return result;
}

export function hasNotificationCalendarAccess(
  row: ActivityNotification,
  access: Map<string, boolean>,
): boolean {
  const id = activityId(row);
  // Only a real, undeleted activity can establish the legacy no-calendar path.
  if (id !== null) return access.get(id) === true;
  return (
    (row.type !== "activity_assigned" && row.type !== "activity_reminder") ||
    (!("activityId" in row.payload) && row.entityType !== "activity")
  );
}

export async function canReadNotificationCalendar(
  db: DbOrTx,
  actor: AuthUser,
  row: ActivityNotification,
  signal: AbortSignal,
): Promise<boolean> {
  return hasNotificationCalendarAccess(
    row,
    await loadNotificationCalendarAccess(db, actor, [row], signal),
  );
}

function reminderIntentId(row: ActivityNotification): string | null | undefined {
  if (row.type !== "activity_reminder" || !("reminderIntentId" in row.payload)) return undefined;
  const parsed = activityIdSchema.safeParse(row.payload.reminderIntentId);
  return parsed.success ? parsed.data : null;
}

type Receipt = { intent: typeof calendarReminderIntents.$inferSelect; activity: Activity };
function receiptIndexes(receipts: Receipt[]) {
  const byId = new Map(receipts.map((receipt) => [receipt.intent.id, receipt]));
  const byNotification = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    if (receipt.intent.notificationId === null) continue;
    const candidates = byNotification.get(receipt.intent.notificationId) ?? [];
    candidates.push(receipt);
    byNotification.set(receipt.intent.notificationId, candidates);
  }
  return { byId, byNotification };
}

async function legacyReceiptAccess(
  db: DbOrTx,
  recipientId: string,
  row: ReminderReceiptNotification,
  channel: "inApp" | "email",
  activityRows: Map<string, Activity>,
  signal: AbortSignal,
): Promise<boolean> {
  const id = activityId(row);
  // Preserve the old genuinely unreferenced system notice, never a malformed reference.
  if (id === null) return !("activityId" in row.payload) && row.entityType !== "activity";
  const activity = activityRows.get(id);
  if (
    activity === undefined ||
    !(await canUseLegacyReminderPolicy(db, activity, recipientId, signal))
  )
    return false;
  // Disabling future reminders preserves unlinked inbox history. Queued email still needs a
  // provable current instant; a legacy all-day anchor cannot establish its original civil date.
  if (channel === "inApp") return true;
  return (
    activity.reminderAutomationEnabled &&
    !activity.allDay &&
    activity.deletedAt === null &&
    !activity.done &&
    activity.assigneeId === recipientId &&
    activity.dueAt !== null &&
    activity.dueAt.toISOString() === row.payload.dueAt
  );
}

async function receiptAccess(
  db: DbOrTx,
  recipientId: string,
  row: ReminderReceiptNotification,
  channel: "inApp" | "email",
  indexes: ReturnType<typeof receiptIndexes>,
  activityRows: Map<string, Activity>,
  signal: AbortSignal,
): Promise<boolean> {
  if (row.userId !== recipientId) return false;
  const ref = reminderIntentId(row);
  if (ref === null) return false;
  const backlinks = indexes.byNotification.get(row.id) ?? [];
  if (backlinks.length > 1) return false;
  if (ref === undefined && backlinks.length === 0)
    return legacyReceiptAccess(db, recipientId, row, channel, activityRows, signal);
  const receipt = ref === undefined ? backlinks[0] : indexes.byId.get(ref);
  if (
    receipt === undefined ||
    (backlinks.length === 1 && backlinks[0]?.intent.id !== receipt.intent.id)
  )
    return false;
  const { intent, activity } = receipt;
  if (
    intent.assigneeId !== recipientId ||
    intent.notificationId !== row.id ||
    intent.state !== "delivered" ||
    !intent[channel] ||
    activityId(row) !== intent.activityId ||
    row.payload.dueAt !== intent.dueAt.toISOString()
  )
    return false;
  return admitReminderIntent(db, activity, intent, signal, channel);
}

// Old queue payloads lack an intent ID, but their database backlink is still authoritative.
// Resolve it before compatibility checks so a cancelled or mismatched receipt cannot fall back.
async function loadReminderReceiptAccess(
  db: DbOrTx,
  recipientId: string,
  rows: ReminderReceiptNotification[],
  channel: "inApp" | "email",
  signal: AbortSignal,
): Promise<Map<string, boolean>> {
  signal.throwIfAborted();
  const reminders = rows.filter((row) => row.type === "activity_reminder");
  const access = new Map(reminders.map((row) => [row.id, false]));
  const valid = reminders.filter((row) => activityIdSchema.safeParse(row.id).success);
  if (valid.length === 0) return access;
  const ids = [
    ...new Set(
      valid.flatMap((row) => {
        const id = reminderIntentId(row);
        return typeof id === "string" ? [id] : [];
      }),
    ),
  ];
  const receipts = await db
    .select({ intent: calendarReminderIntents, activity: activities })
    .from(calendarReminderIntents)
    .innerJoin(activities, eq(activities.id, calendarReminderIntents.activityId))
    .where(
      or(
        inArray(calendarReminderIntents.id, ids),
        inArray(
          calendarReminderIntents.notificationId,
          valid.map((row) => row.id),
        ),
      ),
    );
  signal.throwIfAborted();
  const activityIds = [
    ...new Set(
      valid.flatMap((row) => {
        const id = activityId(row);
        return id === null ? [] : [id];
      }),
    ),
  ];
  const current =
    activityIds.length === 0
      ? []
      : await db.select().from(activities).where(inArray(activities.id, activityIds));
  signal.throwIfAborted();
  const activityRows = new Map(current.map((activity) => [activity.id, activity]));
  const indexes = receiptIndexes(receipts);
  for (const row of valid)
    access.set(
      row.id,
      await receiptAccess(db, recipientId, row, channel, indexes, activityRows, signal),
    );
  return access;
}

export async function loadNotificationReminderAccess(
  db: DbOrTx,
  recipientId: string,
  rows: ReminderReceiptNotification[],
  signal: AbortSignal,
): Promise<Map<string, boolean>> {
  return loadReminderReceiptAccess(db, recipientId, rows, "inApp", signal);
}

export function hasNotificationReminderAccess(
  row: ReminderReceiptNotification,
  access: Map<string, boolean>,
): boolean {
  return row.type !== "activity_reminder" || access.get(row.id) === true;
}

// A queued email can outlive the reminder intent. Re-read the due snapshot and recipient
// immediately before delivery so old reminders cannot follow a reschedule or reassignment.
export async function canDeliverActivityReminder(
  db: DbOrTx,
  recipientId: string,
  row: ReminderReceiptNotification,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (row.type !== "activity_reminder") return true;
  return (
    (await loadReminderReceiptAccess(db, recipientId, [row], "email", signal)).get(row.id) === true
  );
}
