import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  calendarReminderIntents,
  activityReminderSettings,
  calendars,
  reminderRebuilds,
} from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { setCalendarArchived, setCalendarMember, updateCalendar } from "./calendars";
import { setCalendarReminderDefaults } from "./personalReminderSettings";
import { processReminderRebuilds } from "./reminderRebuild";
import { activeReminders, queuedRebuilds, subscribedFixture } from "./reminderRebuild.test-helpers";
import {
  customDefaults,
  reminderActor,
  reminderFixture,
  sig,
} from "./reminderSettings.test-helpers";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

it.each([null, "freeBusy"] as const)(
  "rebuilds personal reminders after membership changes to %s and back",
  async (role) => {
    const { owner, reader, calendar, event } = await subscribedFixture(ctx.db);
    expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(1);
    await setCalendarMember(
      ctx.db,
      owner,
      { calendarId: calendar.id, userId: reader.id, role },
      sig(),
    );
    expect(await queuedRebuilds(ctx.db)).toContain(event.id);
    await processReminderRebuilds(ctx.db, sig());
    expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(0);
    await setCalendarMember(
      ctx.db,
      owner,
      { calendarId: calendar.id, userId: reader.id, role: "reader" },
      sig(),
    );
    expect(await queuedRebuilds(ctx.db)).toContain(event.id);
    await processReminderRebuilds(ctx.db, sig());
    expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(1);
    expect(await activeReminders(ctx.db, event.id, owner.id)).toHaveLength(1);
    expect(await processReminderRebuilds(ctx.db, sig())).toBe(0);
  },
);

it("cancels and restores assignment and personal reminders when their calendar is archived and restored", async () => {
  const { owner, reader, calendar, event } = await subscribedFixture(ctx.db);
  await setCalendarArchived(ctx.db, owner, { id: calendar.id, archived: true }, sig());
  expect(await queuedRebuilds(ctx.db)).toContain(event.id);
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, event.id)).toHaveLength(0);
  await setCalendarArchived(ctx.db, owner, { id: calendar.id, archived: false }, sig());
  expect(await queuedRebuilds(ctx.db)).toContain(event.id);
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, event.id, owner.id)).toHaveLength(1);
  expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(1);
});

it.each(["done", "deleted"] as const)(
  "still enqueues %s activities on archive so outstanding intents are cancelled",
  async (kind) => {
    const { owner, calendar, event } = await subscribedFixture(ctx.db);
    await ctx.db
      .update(activities)
      .set(kind === "done" ? { done: true } : { deletedAt: new Date() })
      .where(eq(activities.id, event.id));
    await ctx.db.delete(reminderRebuilds).where(eq(reminderRebuilds.activityId, event.id));
    expect(await activeReminders(ctx.db, event.id)).toHaveLength(2);
    await setCalendarArchived(ctx.db, owner, { id: calendar.id, archived: true }, sig());
    expect(await queuedRebuilds(ctx.db)).toContain(event.id);
    await processReminderRebuilds(ctx.db, sig());
    expect(await activeReminders(ctx.db, event.id)).toHaveLength(0);
    await setCalendarArchived(ctx.db, owner, { id: calendar.id, archived: false }, sig());
    await processReminderRebuilds(ctx.db, sig());
    expect(await activeReminders(ctx.db, event.id)).toHaveLength(0);
  },
);

it("rechecks recipients after calendar ownership changes and preserves authored zones on a calendar zone change", async () => {
  const { owner, reader, calendar, event } = await subscribedFixture(ctx.db);
  const nextOwner = await reminderActor(ctx.db);
  await ctx.db
    .update(calendars)
    .set({ ownerId: nextOwner.id })
    .where(eq(calendars.id, calendar.id));
  expect(await queuedRebuilds(ctx.db)).toContain(event.id);
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, event.id, owner.id)).toHaveLength(0);
  expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(1);
  await ctx.db.update(calendars).set({ ownerId: owner.id }).where(eq(calendars.id, calendar.id));
  await processReminderRebuilds(ctx.db, sig());
  const before = await activeReminders(ctx.db, event.id);
  await updateCalendar(ctx.db, owner, { id: calendar.id, timeZone: "UTC" }, sig());
  expect(await queuedRebuilds(ctx.db)).toContain(event.id);
  await processReminderRebuilds(ctx.db, sig());
  expect((await activeReminders(ctx.db, event.id)).map((row) => row.id).sort()).toEqual(
    before.map((row) => row.id).sort(),
  );
});

it("consumes direct legacy rebuilds without adopting reminders on date or assignee changes", async () => {
  const { owner, reader, input } = await reminderFixture(ctx.db);
  const signal = sig();
  const [legacy] = await ctx.db
    .insert(activities)
    .values({
      typeId: input.typeId,
      ownerId: owner.id,
      assigneeId: owner.id,
      subject: "Direct CRM activity",
      dueAt: new Date(input.dueAt),
    })
    .returning();
  signal.throwIfAborted();
  if (legacy === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "legacy seed absent");
  expect(legacy.reminderEngine).toBe("legacy");
  const states = [
    { dueAt: new Date(input.dueAt), assigneeId: owner.id },
    { dueAt: new Date("2030-03-22T10:00:00Z"), assigneeId: owner.id },
    { dueAt: new Date("2030-03-22T10:00:00Z"), assigneeId: reader.id },
  ];
  for (const [index, expected] of states.entries()) {
    if (index > 0) {
      await ctx.db.update(activities).set(expected).where(eq(activities.id, legacy.id));
      signal.throwIfAborted();
    }
    expect(await queuedRebuilds(ctx.db)).toContain(legacy.id);
    signal.throwIfAborted();
    expect(await processReminderRebuilds(ctx.db, signal)).toBe(1);
    expect(await queuedRebuilds(ctx.db)).not.toContain(legacy.id);
    signal.throwIfAborted();
    const [current, settings, intents] = await Promise.all([
      ctx.db
        .select({
          reminderEngine: activities.reminderEngine,
          dueAt: activities.dueAt,
          assigneeId: activities.assigneeId,
        })
        .from(activities)
        .where(eq(activities.id, legacy.id)),
      ctx.db
        .select()
        .from(activityReminderSettings)
        .where(eq(activityReminderSettings.activityId, legacy.id)),
      ctx.db
        .select()
        .from(calendarReminderIntents)
        .where(eq(calendarReminderIntents.activityId, legacy.id)),
    ]);
    signal.throwIfAborted();
    expect(current).toEqual([{ reminderEngine: "legacy", ...expected }]);
    expect(settings).toEqual([]);
    expect(intents).toEqual([]);
  }
});

it("replaces reminders for intent-owned direct writes while respecting automatic reminder suppression", async () => {
  const { owner, reader, input } = await reminderFixture(ctx.db);
  const [native] = await ctx.db
    .insert(activities)
    .values({
      typeId: input.typeId,
      reminderEngine: "intent",
      ownerId: owner.id,
      assigneeId: owner.id,
      subject: "Direct intent-owned CRM activity",
      dueAt: new Date(input.dueAt),
    })
    .returning();
  if (native === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "intent-owned seed absent");
  expect(await queuedRebuilds(ctx.db)).toContain(native.id);
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, native.id, owner.id)).toHaveLength(1);
  const moved = new Date("2030-03-22T10:00:00Z");
  await ctx.db.update(activities).set({ dueAt: moved }).where(eq(activities.id, native.id));
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, native.id, owner.id)).toMatchObject([{ dueAt: moved }]);
  await ctx.db
    .update(activities)
    .set({ assigneeId: reader.id })
    .where(eq(activities.id, native.id));
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, native.id, owner.id)).toHaveLength(0);
  expect(await activeReminders(ctx.db, native.id, reader.id)).toHaveLength(1);
  const disabled = await createActivity(ctx.db, owner, { ...input, calendarId: null }, sig(), {
    scheduleReminder: false,
  });
  if (!disabled.ok) throw disabled.error;
  await ctx.db
    .update(activities)
    .set({ dueAt: moved, assigneeId: reader.id })
    .where(eq(activities.id, disabled.value.id));
  await processReminderRebuilds(ctx.db, sig());
  expect(await activeReminders(ctx.db, disabled.value.id)).toHaveLength(0);
});

it("rebuilds inherited default changes in bounded batches without losing a later activity", async () => {
  const { owner, reader, calendar, input } = await reminderFixture(ctx.db);
  const rows = await ctx.db
    .insert(activities)
    .values(
      Array.from({ length: 101 }, () => ({
        typeId: input.typeId,
        reminderEngine: "intent" as const,
        ownerId: owner.id,
        assigneeId: owner.id,
        subject: "Batch reminder",
        dueAt: new Date(input.dueAt),
        calendarId: calendar.id,
      })),
    )
    .returning();
  await ctx.db.insert(activityReminderSettings).values(
    rows.map((row) => ({
      activityId: row.id,
      userId: reader.id,
      source: "personal" as const,
      useDefault: true,
      timeZone: "UTC",
    })),
  );
  expect(await processReminderRebuilds(ctx.db, sig())).toBe(100);
  expect(await processReminderRebuilds(ctx.db, sig())).toBe(1);
  expect(
    await setCalendarReminderDefaults(
      ctx.db,
      reader,
      { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
      sig(),
    ),
  ).toMatchObject({ ok: true });
  expect(await queuedRebuilds(ctx.db)).toHaveLength(101);
  expect(await processReminderRebuilds(ctx.db, sig())).toBe(100);
  expect(await queuedRebuilds(ctx.db)).toHaveLength(1);
  const active = () =>
    ctx.db
      .select()
      .from(calendarReminderIntents)
      .where(
        and(
          eq(calendarReminderIntents.assigneeId, reader.id),
          inArray(calendarReminderIntents.state, ["pending", "dispatched"]),
        ),
      );
  expect((await active()).filter((row) => row.defaultsVersion === 1)).toHaveLength(100);
  expect(await processReminderRebuilds(ctx.db, sig())).toBe(1);
  expect(await queuedRebuilds(ctx.db)).toEqual([]);
  expect(await active()).toHaveLength(101);
  expect(
    (await active()).every((row) => row.defaultsVersion === 1 && row.inApp && !row.email),
  ).toBe(true);
});
