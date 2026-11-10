import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityTypes,
  calendarReminderIntents,
  leads,
  notifications,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { getFeed } from "@/features/notifications/feed";
import { createNotification } from "@/features/notifications/produce";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { calendarRange } from "./calendar";
import { handleCalendarReminderJob as handleReminderJob } from "./calendarReminders";
import { createCalendar, setCalendarMember } from "./calendars";
import { getActivityForEdit } from "./getForEdit";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
const signal = () => AbortSignal.timeout(10_000);
const range = { from: new Date("2027-03-21T00:00Z"), to: new Date("2027-03-22T00:00Z") };
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
async function actor(): Promise<PermSetUser> {
  const user = await seedUser(ctx.db);
  return { id: user.id, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() };
}
async function fixture(role: "reader" | "editor" = "reader") {
  const owner = await actor();
  const member = await actor();
  const calendar = await createCalendar(
    ctx.db,
    owner,
    { name: "Shared", timeZone: "UTC" },
    signal(),
  );
  if (!calendar.ok) throw calendar.error;
  await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: calendar.value.id, userId: member.id, role },
    signal(),
  );
  const [lead] = await ctx.db
    .insert(leads)
    .values({ title: "Private lead", ownerId: owner.id, visibilityLevel: "owner" })
    .returning();
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (lead === undefined || type === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "lead or meeting seed absent");
  const input = {
    typeId: type.id,
    subject: "Confidential activity",
    leadId: lead.id,
    calendarId: calendar.value.id,
    dueAt: "2027-03-21T09:00:00Z",
    durationMinutes: 60,
  };
  const created = await createActivity(ctx.db, owner, input, signal());
  if (!created.ok) throw created.error;
  return { owner, member, calendar: calendar.value, activity: created.value, input };
}

it.each(["reader", "editor"] as const)(
  "does not grant lead-only activity details through a calendar %s membership",
  async (role) => {
    const { member, activity } = await fixture(role);
    expect((await getActivityForEdit(ctx.db, member, activity.id, signal())).ok).toBe(false);
    const rows = await calendarRange(ctx.db, member, range, signal());
    expect(rows.filter((row) => row.busyOnly !== true).map((row) => row.id)).not.toContain(
      activity.id,
    );
    expect(JSON.stringify(rows)).not.toContain(activity.subject);
  },
);

it("does not let a broad activity edit permission turn a calendar grant into CRM visibility", async () => {
  const { member, activity } = await fixture("editor");
  const result = await updateActivity(
    ctx.db,
    { ...member, flags: new Set(["activity.edit_any"]) },
    { id: activity.id, subject: "Denied", expectedVersion: activity.version },
    signal(),
  );
  expect(!result.ok && result.error.id).toBe(ERROR_IDS.ACTIVITY_NOT_FOUND);
  const [row] = await ctx.db.select().from(activities).where(eq(activities.id, activity.id));
  expect(row?.subject).toBe(activity.subject);
  expect(row?.version).toBe(activity.version);
});

it("denies activity-gated notification production and stored notification reads to unrelated calendar readers", async () => {
  const { member, activity } = await fixture();
  const notification = {
    type: "activity_assigned" as const,
    entityType: "activity",
    entityId: activity.id,
    actorId: null,
    payload: { activityId: activity.id, subject: activity.subject },
  };
  expect(
    await createNotification(ctx.db, { ...notification, recipientId: member.id }, signal()),
  ).toEqual({ ok: true, value: { suppressed: true } });
  await ctx.db.insert(notifications).values({ ...notification, userId: member.id });
  expect(await getFeed(ctx.db, member, 20, signal())).toEqual([]);
});

it("keeps standalone shared events readable while preserving legacy lead assignee access", async () => {
  const { owner, member, input } = await fixture();
  const standalone = await createActivity(ctx.db, owner, { ...input, leadId: null }, signal());
  if (!standalone.ok) throw standalone.error;
  expect((await getActivityForEdit(ctx.db, member, standalone.value.id, signal())).ok).toBe(true);
  const legacy = await createActivity(
    ctx.db,
    owner,
    { ...input, calendarId: null, assigneeId: member.id },
    signal(),
  );
  if (!legacy.ok) throw legacy.error;
  const editable = await getActivityForEdit(ctx.db, member, legacy.value.id, signal());
  expect(editable.ok && editable.value.canEdit).toBe(true);
  const row = (await calendarRange(ctx.db, member, range, signal())).find(
    (activity) => activity.id === legacy.value.id,
  );
  expect(row).toMatchObject({ subject: input.subject, leadId: null, leadTitle: null });
  expect(
    (await updateActivity(ctx.db, member, { id: legacy.value.id, location: "Berlin" }, signal()))
      .ok,
  ).toBe(true);
});

it("retains native lead assignee reminders only while current calendar detail access permits them", async () => {
  const { owner, member, calendar, input } = await fixture();
  const created = await createActivity(
    ctx.db,
    owner,
    { ...input, assigneeId: member.id, dueAt: new Date(Date.now() + 5 * 60_000).toISOString() },
    signal(),
  );
  if (!created.ok) throw created.error;
  const [intent] = await ctx.db
    .select()
    .from(calendarReminderIntents)
    .where(eq(calendarReminderIntents.activityId, created.value.id));
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "reminder seed absent");
  const editable = await getActivityForEdit(ctx.db, member, created.value.id, signal());
  expect(editable.ok && editable.value.canEdit).toBe(false);
  await handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), null);
  expect(await getFeed(ctx.db, member, 20, signal())).toHaveLength(1);
  await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: calendar.id, userId: member.id, role: null },
    signal(),
  );
  expect((await getActivityForEdit(ctx.db, member, created.value.id, signal())).ok).toBe(false);
  expect(await getFeed(ctx.db, member, 20, signal())).toEqual([]);
});
