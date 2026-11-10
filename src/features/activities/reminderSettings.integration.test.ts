import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, activityReminderSettings, leads } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { setCalendarMember, updateCalendar } from "./calendars";
import {
  getCalendarReminderDefaults,
  getEventReminderSettings,
  setCalendarReminderDefaults,
  setEventReminderSettings,
} from "./personalReminderSettings";
import {
  customDefaults,
  reminderActor,
  reminderFixture,
  sig,
} from "./reminderSettings.test-helpers";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
const none = { useDefault: false as const, timed: [], allDay: [] };

it("lets readers save only their own subscription without changing the shared event revision", async () => {
  const { reader, event } = await reminderFixture(ctx.db);
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { selection: none, revision: 0, subscribed: false, timeZone: "Asia/Tehran" },
  });
  const selection = { useDefault: false as const, ...customDefaults };
  expect(
    await setEventReminderSettings(
      ctx.db,
      reader,
      { activityId: event.id, expectedRevision: 0, selection },
      sig(),
    ),
  ).toMatchObject({ ok: true, value: { selection, revision: 1, subscribed: true } });
  const [stored] = await ctx.db
    .select()
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.activityId, event.id),
        eq(activityReminderSettings.userId, reader.id),
      ),
    );
  expect(stored).toMatchObject({
    source: "personal",
    rules: customDefaults,
    timeZone: "Asia/Tehran",
  });
  const [shared] = await ctx.db.select().from(activities).where(eq(activities.id, event.id));
  expect(shared?.version).toBe(event.version);
});

it("converts an assignment setting to a personal setting without changing anyone else's rules", async () => {
  const { owner, event } = await reminderFixture(ctx.db);
  await ctx.db
    .insert(activityReminderSettings)
    .values({
      activityId: event.id,
      userId: owner.id,
      source: "assignment",
      useDefault: true,
      timeZone: "UTC",
      version: 7,
    })
    .onConflictDoUpdate({
      target: [activityReminderSettings.activityId, activityReminderSettings.userId],
      set: { source: "assignment", version: 7 },
    });
  expect(
    await setEventReminderSettings(
      ctx.db,
      owner,
      { activityId: event.id, expectedRevision: 7, selection: none },
      sig(),
    ),
  ).toMatchObject({ ok: true, value: { selection: none, revision: 8, subscribed: false } });
  const [stored] = await ctx.db
    .select()
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.activityId, event.id),
        eq(activityReminderSettings.userId, owner.id),
      ),
    );
  expect(stored).toMatchObject({
    source: "personal",
    useDefault: false,
    version: 8,
    timeZone: "Asia/Tehran",
  });
});

it("pins a legacy event fallback zone when personal settings are first saved", async () => {
  const { owner, reader, event, calendar } = await reminderFixture(ctx.db);
  await ctx.db.update(activities).set({ eventTimeZone: null }).where(eq(activities.id, event.id));
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { timeZone: "Europe/Berlin", revision: 0 },
  });
  expect(
    await setEventReminderSettings(
      ctx.db,
      reader,
      {
        activityId: event.id,
        expectedRevision: 0,
        selection: { useDefault: true },
      },
      sig(),
    ),
  ).toMatchObject({ ok: true, value: { timeZone: "Europe/Berlin" } });
  await updateCalendar(ctx.db, owner, { id: calendar.id, timeZone: "UTC" }, sig());
  expect(await getEventReminderSettings(ctx.db, reader, event.id, sig())).toMatchObject({
    ok: true,
    value: { timeZone: "Europe/Berlin" },
  });
});

it("keeps explicit none distinct from defaults and rejects stale or concurrent settings revisions", async () => {
  const { reader, event } = await reminderFixture(ctx.db);
  const writes = await Promise.all(
    [none, { useDefault: true as const }].map((selection) =>
      setEventReminderSettings(
        ctx.db,
        reader,
        { activityId: event.id, expectedRevision: 0, selection },
        sig(),
      ),
    ),
  );
  expect(writes.filter((r) => r.ok)).toHaveLength(1);
  expect(writes.filter((r) => !r.ok && r.error.id === ERROR_IDS.ACTIVITY_CONFLICT)).toHaveLength(1);
  const saved = await setEventReminderSettings(
    ctx.db,
    reader,
    { activityId: event.id, expectedRevision: 1, selection: none },
    sig(),
  );
  expect(saved).toMatchObject({
    ok: true,
    value: { selection: none, subscribed: false, revision: 2 },
  });
});

it.each(["freeBusy", "revoked", "private", "outsider"] as const)(
  "denies %s event settings without revealing the stored revision",
  async (kind) => {
    const { owner, reader, calendar, event } = await reminderFixture(
      ctx.db,
      kind === "freeBusy" ? "freeBusy" : "reader",
      kind === "private" ? "private" : "default",
    );
    if (kind === "revoked")
      await setCalendarMember(
        ctx.db,
        owner,
        { calendarId: calendar.id, userId: reader.id, role: null },
        sig(),
      );
    const actor = kind === "outsider" ? await reminderActor(ctx.db) : reader;
    expect(await getEventReminderSettings(ctx.db, actor, event.id, sig())).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
    });
    expect(
      await setEventReminderSettings(
        ctx.db,
        actor,
        { activityId: event.id, expectedRevision: 99, selection: none },
        sig(),
      ),
    ).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
    });
  },
);

it("rejects caller-selected recipients and free/busy calendar defaults", async () => {
  const { owner, reader, event, calendar } = await reminderFixture(ctx.db, "freeBusy");
  expect(await getCalendarReminderDefaults(ctx.db, reader, calendar.id, sig())).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
  });
  expect(
    await setCalendarReminderDefaults(
      ctx.db,
      reader,
      { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
      sig(),
    ),
  ).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
  });
  expect(
    await setEventReminderSettings(
      ctx.db,
      owner,
      {
        activityId: event.id,
        userId: reader.id,
        expectedRevision: 0,
        selection: none,
      },
      sig(),
    ),
  ).toMatchObject({ ok: false, error: { id: ERROR_IDS.ACTIVITY_UPDATE_INPUT_INVALID } });
});

it("requires full CRM activity visibility as well as a calendar read grant", async () => {
  const { owner, reader, input } = await reminderFixture(ctx.db);
  const [lead] = await ctx.db
    .insert(leads)
    .values({ ownerId: owner.id, title: "Owner only", visibilityLevel: "owner" })
    .returning();
  expect(lead).toBeDefined();
  if (lead === undefined) return;
  const event = await createActivity(ctx.db, owner, { ...input, leadId: lead.id }, sig());
  if (!event.ok) throw event.error;
  expect(await getEventReminderSettings(ctx.db, reader, event.value.id, sig())).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
  });
  expect(
    await setEventReminderSettings(
      ctx.db,
      reader,
      { activityId: event.value.id, expectedRevision: 0, selection: { useDefault: true } },
      sig(),
    ),
  ).toMatchObject({ ok: false, error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND } });
});

it("respects disabled assignment automation but permits an explicit personal reminder", async () => {
  const { owner, input } = await reminderFixture(ctx.db);
  const created = await createActivity(ctx.db, owner, { ...input, calendarId: null }, sig(), {
    scheduleReminder: false,
  });
  if (!created.ok) throw created.error;
  expect(await getEventReminderSettings(ctx.db, owner, created.value.id, sig())).toMatchObject({
    ok: true,
    value: { selection: none, subscribed: false, revision: 0 },
  });
  expect(
    await setEventReminderSettings(
      ctx.db,
      owner,
      { activityId: created.value.id, expectedRevision: 0, selection: { useDefault: true } },
      sig(),
    ),
  ).toMatchObject({
    ok: true,
    value: { selection: { useDefault: true }, subscribed: true, revision: 1 },
  });
});
