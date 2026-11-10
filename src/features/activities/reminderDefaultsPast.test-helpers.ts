import { and, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { calendarReminderIntents, activityTypes, emailAccounts, notifications } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { runEmailNotificationJob, type SendFn } from "@/features/notifications/email/job";
import { setPreference } from "@/features/notifications/preferences";
import type { PermSetUser } from "@/features/permissions/effective";
import type { TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { createCalendar, setCalendarMember } from "./calendars";
import { setCalendarReminderDefaults, setEventReminderSettings } from "./personalReminderSettings";
import { deliverReminderIntent } from "./calendarReminderDelivery";
import { dispatchReminderIntents } from "./reminderOutbox";
import type { ReminderDefaults } from "./reminderPolicy";
import { createActivity } from "./repo";

export const sig = () => AbortSignal.timeout(15_000);
export const timedRules = (minutes: number, email = true): ReminderDefaults => ({
  timed: [
    { method: "notification", minutesBefore: minutes },
    ...(email ? [{ method: "email" as const, minutesBefore: minutes }] : []),
  ],
  allDay: [],
});
export const noRules: ReminderDefaults = { timed: [], allDay: [] };
function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "past-default fixture missing");
  return value;
}
async function actor(db: Db) {
  const user = await seedUser(db);
  const permissions: PermSetUser = {
    id: user.id,
    type: "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  return { user, permissions };
}
export async function saveDefaults(
  db: Db,
  who: PermSetUser,
  calendarId: string,
  revision: number,
  defaults: ReminderDefaults,
) {
  const result = await setCalendarReminderDefaults(
    db,
    who,
    { calendarId, expectedRevision: revision, defaults },
    sig(),
  );
  if (!result.ok) throw result.error;
  return result.value;
}
export async function pastFixture(
  db: Db,
  options: {
    dueMinutes?: number;
    initial?: ReminderDefaults;
    subscribed?: boolean;
    allDay?: boolean;
    implicitDefaults?: boolean;
  } = {},
) {
  const now = new Date();
  const owner = await actor(db);
  const other = await actor(db);
  const recipient = options.subscribed === true ? other : owner;
  const created = await createCalendar(
    db,
    owner.permissions,
    { name: "Past default integrity", timeZone: "UTC" },
    sig(),
  );
  if (!created.ok) throw created.error;
  const shared = await setCalendarMember(
    db,
    owner.permissions,
    {
      calendarId: created.value.id,
      userId: other.user.id,
      role: options.subscribed === true ? "reader" : "editor",
    },
    sig(),
  );
  if (!shared.ok) throw shared.error;
  if (options.implicitDefaults !== true)
    await saveDefaults(
      db,
      recipient.permissions,
      created.value.id,
      0,
      options.initial ?? timedRules(10),
    );
  const type = required(
    (await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting")))[0],
  );
  const civilDate = now.toISOString().slice(0, 10);
  const dueAt =
    options.allDay === true
      ? `${civilDate}T00:00:00.000Z`
      : new Date(now.getTime() + (options.dueMinutes ?? 60) * 60_000).toISOString();
  const event = await createActivity(
    db,
    owner.permissions,
    {
      typeId: type.id,
      subject: "Default cutoff target",
      calendarId: created.value.id,
      eventTimeZone: "UTC",
      dueAt,
      ...(options.allDay === true ? { allDay: true, dueDate: civilDate } : {}),
    },
    sig(),
  );
  if (!event.ok) throw event.error;
  if (options.subscribed === true) {
    const subscribed = await setEventReminderSettings(
      db,
      recipient.permissions,
      { activityId: event.value.id, expectedRevision: 0, selection: { useDefault: true } },
      sig(),
    );
    if (!subscribed.ok) throw subscribed.error;
  }
  await db
    .insert(emailAccounts)
    .values({ userId: recipient.user.id, emailAddress: recipient.user.email, status: "connected" });
  await setPreference(
    db,
    recipient.user.id,
    "activity_reminder",
    { inApp: true, email: true },
    sig(),
  );
  const send = vi
    .fn<SendFn>()
    .mockResolvedValue(ok({ gmailMessageId: "synthetic-default-cutoff" }));
  return {
    now,
    owner: owner.permissions,
    editor: other.permissions,
    recipient: recipient.permissions,
    calendar: created.value,
    event: event.value,
    send,
  };
}
export type PastFixture = Awaited<ReturnType<typeof pastFixture>>;
export function targetIntents(db: Db, f: PastFixture) {
  return db
    .select()
    .from(calendarReminderIntents)
    .where(
      and(
        eq(calendarReminderIntents.activityId, f.event.id),
        eq(calendarReminderIntents.assigneeId, f.recipient.id),
      ),
    );
}
export function targetNotes(db: Db, f: PastFixture) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, f.recipient.id),
        sql`${notifications.payload}->>'activityId' = ${f.event.id}`,
      ),
    );
}
export async function queueRows(ctx: TestDb, queue: string, ids: string[]) {
  return (
    await ctx.pool.query<{ id: string }>(
      "SELECT id FROM pgboss.job WHERE name=$1 AND id::text=ANY($2::text[]) ORDER BY id",
      [queue, ids],
    )
  ).rows;
}
export async function evidence(ctx: TestDb, f: PastFixture) {
  const intents = await targetIntents(ctx.db, f);
  const notes = await targetNotes(ctx.db, f);
  return {
    ids: intents.map((row) => row.id).sort(),
    noteIds: notes.map((row) => row.id).sort(),
    reminderJobs: await queueRows(
      ctx,
      PGBOSS_QUEUE_ACTIVITY_REMINDER,
      intents.map((row) => row.id),
    ),
    emailJobs: await queueRows(
      ctx,
      EMAIL_NOTIFICATION_QUEUE,
      notes.map((row) => row.id),
    ),
    sends: f.send.mock.calls.length,
  };
}
export async function drainTarget(ctx: TestDb, boss: PgBoss, f: PastFixture) {
  await dispatchReminderIntents(ctx.db, boss, sig());
  for (const intent of await targetIntents(ctx.db, f)) {
    if (
      (intent.state === "pending" || intent.state === "dispatched") &&
      intent.fireAt.getTime() <= Date.now()
    )
      await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), boss);
  }
  for (const job of await boss.fetch<{ notificationId: string }>(EMAIL_NOTIFICATION_QUEUE, {
    batchSize: 100,
  })) {
    const sent = await runEmailNotificationJob(ctx.db, job.data, sig(), { send: f.send });
    if (!sent.ok) throw sent.error;
    await boss.complete(EMAIL_NOTIFICATION_QUEUE, job);
  }
}
