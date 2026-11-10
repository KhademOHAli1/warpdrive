import { afterAll, beforeAll, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { calendarReminderDefaults, emailAccounts, reminderRebuilds } from "@/db/schema";
import { setPreference } from "@/features/notifications/preferences";
import { makeTestDb } from "@/test/db";
import {
  getCalendarReminderDefaults,
  getEventReminderSettings,
  setCalendarReminderDefaults,
  setEventReminderSettings,
} from "./personalReminderSettings";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";
import { customDefaults, reminderFixture, sig } from "./reminderSettings.test-helpers";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});

it("reads without creating preferences and keeps calendar defaults personal to each reader", async () => {
  const { owner, reader, calendar } = await reminderFixture(ctx.db);
  const before = await ctx.db.select().from(calendarReminderDefaults);
  expect(await getCalendarReminderDefaults(ctx.db, reader, calendar.id, sig())).toMatchObject({
    ok: true,
    value: { defaults: DEFAULT_REMINDER_RULES, revision: 0, emailCapability: "mailboxMissing" },
  });
  expect(await ctx.db.select().from(calendarReminderDefaults)).toEqual(before);
  const saved = await setCalendarReminderDefaults(
    ctx.db,
    reader,
    { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
    sig(),
  );
  expect(saved).toMatchObject({ ok: true, value: { defaults: customDefaults, revision: 1 } });
  expect(await getCalendarReminderDefaults(ctx.db, owner, calendar.id, sig())).toMatchObject({
    ok: true,
    value: { defaults: DEFAULT_REMINDER_RULES, revision: 0 },
  });
});

it("allows exactly one personal calendar-default write for an absent revision", async () => {
  const { reader, calendar } = await reminderFixture(ctx.db);
  const writes = await Promise.all(
    [customDefaults, DEFAULT_REMINDER_RULES].map((defaults) =>
      setCalendarReminderDefaults(
        ctx.db,
        reader,
        { calendarId: calendar.id, expectedRevision: 0, defaults },
        sig(),
      ),
    ),
  );
  expect(writes.filter((r) => r.ok)).toHaveLength(1);
  expect(writes.filter((r) => !r.ok && r.error.id === ERROR_IDS.ACTIVITY_CONFLICT)).toHaveLength(1);
  expect(await getCalendarReminderDefaults(ctx.db, reader, calendar.id, sig())).toMatchObject({
    ok: true,
    value: { revision: 1 },
  });
});

it("rebuilds inherited future reminders durably when personal calendar defaults change", async () => {
  const { owner, reader, event, calendar, input } = await reminderFixture(ctx.db);
  const other = await createActivity(ctx.db, owner, { ...input, subject: "Explicit rules" }, sig());
  if (!other.ok) throw other.error;
  await setEventReminderSettings(
    ctx.db,
    reader,
    { activityId: event.id, expectedRevision: 0, selection: { useDefault: true } },
    sig(),
  );
  await setEventReminderSettings(
    ctx.db,
    reader,
    {
      activityId: other.value.id,
      expectedRevision: 0,
      selection: { useDefault: false, ...customDefaults },
    },
    sig(),
  );
  await ctx.db.delete(reminderRebuilds);
  expect(
    await setCalendarReminderDefaults(
      ctx.db,
      reader,
      { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
      sig(),
    ),
  ).toMatchObject({ ok: true });
  expect((await ctx.db.select().from(reminderRebuilds)).map((r) => r.activityId)).toEqual([
    event.id,
  ]);
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { defaults: customDefaults, selection: { useDefault: true }, revision: 1 },
  });
  expect(await getEventReminderSettings(ctx.db, reader, other.value.id, sig())).toMatchObject({
    ok: true,
    value: { selection: { useDefault: false, ...customDefaults }, revision: 1 },
  });
});

it("reports connected mailbox capability and honors the user's global email opt-out", async () => {
  const { reader, event } = await reminderFixture(ctx.db);
  await ctx.db.insert(emailAccounts).values({
    userId: reader.id,
    emailAddress: `${reader.id}@reminders.invalid`,
    status: "connected",
  });
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { emailCapability: "available" },
  });
  await setPreference(ctx.db, reader.id, "activity_reminder", { inApp: true, email: false }, sig());
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { emailCapability: "channelDisabled" },
  });
});

import { sql } from "drizzle-orm";

it("fails closed when stored calendar defaults have malformed rule JSON", async () => {
  const { reader, calendar } = await reminderFixture(ctx.db);
  await setCalendarReminderDefaults(
    ctx.db,
    reader,
    { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
    sig(),
  );
  await ctx.db.execute(
    sql`UPDATE calendar_reminder_defaults SET rules = '{"timed":"invalid"}'::jsonb WHERE calendar_id = ${calendar.id} AND user_id = ${reader.id}`,
  );
  expect(await getCalendarReminderDefaults(ctx.db, reader, calendar.id, sig())).toMatchObject({
    ok: true,
    value: { defaults: { timed: [], allDay: [] }, revision: 1 },
  });
});

it("fails closed when stored custom event rules are malformed instead of enabling default channels", async () => {
  const { reader, event } = await reminderFixture(ctx.db);
  await setEventReminderSettings(
    ctx.db,
    reader,
    {
      activityId: event.id,
      expectedRevision: 0,
      selection: { useDefault: false, ...customDefaults },
    },
    sig(),
  );
  await ctx.db.execute(
    sql`UPDATE activity_reminder_settings SET rules = '{"allDay":[]}'::jsonb WHERE activity_id = ${event.id} AND user_id = ${reader.id}`,
  );
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: {
      selection: { useDefault: false, timed: [], allDay: [] },
      subscribed: false,
      revision: 1,
    },
  });
});
