import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { activities, calendarMembers, organizations } from "@/db/schema";
import { loadNotificationCalendarAccess } from "@/features/notifications/calendarPrivacy";
import { makeTestDb } from "@/test/db";
import { listActivityRows } from "../../activityRows";
import { updateActivity } from "../../activityUpdate";
import { calendarRange } from "../../calendar";
import { calendarActivityAccess, calendarReaders, loadCalendarAccess } from "../../calendarAccess";
import {
  createCalendar,
  listCalendars,
  setCalendarArchived,
  setCalendarMember,
  updateCalendar,
} from "../../calendars";
import { getActivityForEdit } from "../../getForEdit";
import { getEventReminderSettings } from "../../personalReminderSettings";
import { completeActivity, createActivity } from "../../repo";
import { activityListFilter } from "../../schemas";
import {
  nativeSourceFixture,
  providerSourceFixture,
  sourceGuardSignal as signal,
  sourceGuardOk,
  sourceMutation,
  sourceRows,
} from "./calendarSourceGuard.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

it.each(["create", "edit", "complete", "delete", "moveOut", "moveIn"])(
  "denies generic %s on provider calendars for both native owner and admin",
  async (kind) => {
    const fixture = await providerSourceFixture(ctx);
    const before = await sourceRows(ctx, fixture);
    for (const actor of [fixture.owner, fixture.admin])
      expect((await sourceMutation(ctx, fixture, actor, kind)).ok).toBe(false);
    expect(await sourceRows(ctx, fixture)).toEqual(before);
  },
);

it.each(["metadata", "membership", "archive"])(
  "denies native calendar %s mutations without erasing provider source identity",
  async (kind) => {
    const fixture = await providerSourceFixture(ctx);
    const before = await sourceRows(ctx, fixture);
    const result =
      kind === "metadata"
        ? await updateCalendar(
            ctx.db,
            fixture.owner,
            { id: fixture.calendar.id, name: "Forbidden", timeZone: "UTC" },
            signal(),
          )
        : kind === "membership"
          ? await setCalendarMember(
              ctx.db,
              fixture.owner,
              { calendarId: fixture.calendar.id, userId: fixture.admin.id, role: "editor" },
              signal(),
            )
          : await setCalendarArchived(
              ctx.db,
              fixture.owner,
              { id: fixture.calendar.id, archived: true },
              signal(),
            );
    expect(result.ok).toBe(false);
    expect(await sourceRows(ctx, fixture)).toEqual(before);
    expect(await ctx.db.select().from(calendarMembers)).toHaveLength(0);
  },
);

it("hides provider calendars from both ordinary and archived-inclusive native lists", async () => {
  const fixture = await providerSourceFixture(ctx);
  for (const actor of [fixture.owner, fixture.admin])
    for (const includeArchived of [false, true])
      expect(
        (await listCalendars(ctx.db, actor, signal(), includeArchived)).map((row) => row.id),
      ).not.toContain(fixture.calendar.id);
  expect((await listCalendars(ctx.db, fixture.owner, signal())).map((row) => row.id)).toContain(
    fixture.nativeCalendar.id,
  );
});

it("fails closed on scalar access, batch access and calendar reader grants before projection exists", async () => {
  const fixture = await providerSourceFixture(ctx);
  for (const actor of [fixture.owner, fixture.admin]) {
    expect(await calendarActivityAccess(ctx.db, actor, fixture.event, signal())).toEqual({
      read: false,
      write: false,
      freeBusy: false,
    });
    expect(
      (await loadCalendarAccess(ctx.db, actor, [fixture.event.id], signal())).get(fixture.event.id),
    ).toEqual({ read: false, write: false, freeBusy: false });
  }
  expect(
    (await calendarReaders(ctx.db, [fixture.event.id], signal())).get(fixture.event.id) ?? [],
  ).toEqual([]);
});

it("hides latent provider activities from editor, table, calendar, notification and reminder reads", async () => {
  const fixture = await providerSourceFixture(ctx);
  const range = { from: new Date("2027-03-21T00:00:00Z"), to: new Date("2027-03-22T00:00:00Z") };
  for (const actor of [fixture.owner, fixture.admin]) {
    expect((await getActivityForEdit(ctx.db, actor, fixture.event.id, signal())).ok).toBe(false);
    expect(
      (await listActivityRows(ctx.db, actor, activityListFilter.parse({}), signal())).map(
        (row) => row.id,
      ),
    ).not.toContain(fixture.event.id);
    expect(
      (await calendarRange(ctx.db, actor, range, signal())).map((row) => row.id),
    ).not.toContain(fixture.event.id);
    expect((await getEventReminderSettings(ctx.db, actor, fixture.event.id, signal())).ok).toBe(
      false,
    );
    const notices = await loadNotificationCalendarAccess(
      ctx.db,
      actor,
      [
        {
          type: "activity_reminder",
          entityType: "activity",
          entityId: fixture.event.id,
          payload: { activityId: fixture.event.id },
        },
      ],
      signal(),
    );
    expect(notices.get(fixture.event.id)).toBe(false);
  }
});

it("does not allow a provider calendar to become primary at the database boundary", async () => {
  const fixture = await nativeSourceFixture(ctx);
  await expect(
    ctx.pool.query("UPDATE calendars SET source = 'provider', is_primary = true WHERE id = $1", [
      fixture.calendar.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});

it("cannot create provider source authority through the public native calendar API", async () => {
  const fixture = await nativeSourceFixture(ctx);
  const input = { name: "Injected source", timeZone: "UTC", source: "provider" };
  const result = await createCalendar(ctx.db, fixture.owner, input, signal());
  if (result.ok) {
    const source = await ctx.pool.query<{ source: string }>(
      "SELECT source FROM calendars WHERE id = $1",
      [result.value.id],
    );
    expect(source.rows).toEqual([{ source: "native" }]);
  }
});

it("preserves native CRM activity identity, links, shared revisions and native calendar management", async () => {
  const fixture = await nativeSourceFixture(ctx);
  const [org] = await ctx.db
    .insert(organizations)
    .values({
      name: "Native CRM organization",
      ownerId: fixture.owner.id,
      visibilityLevel: "owner",
    })
    .returning();
  expect(org).toBeDefined();
  if (org === undefined) return;
  const created = sourceGuardOk(
    await createActivity(
      ctx.db,
      fixture.owner,
      {
        ...fixture.draft,
        calendarId: fixture.nativeCalendar.id,
        orgId: org.id,
      },
      signal(),
      { scheduleReminder: false },
    ),
  );
  const edited = sourceGuardOk(
    await updateActivity(
      ctx.db,
      fixture.owner,
      {
        id: created.id,
        expectedVersion: created.version,
        subject: "Native edit",
      },
      signal(),
    ),
  );
  const completed = sourceGuardOk(
    await completeActivity(ctx.db, fixture.owner, edited.id, true, signal(), edited.version),
  );
  expect(completed).toMatchObject({
    id: created.id,
    orgId: org.id,
    calendarId: fixture.nativeCalendar.id,
    version: created.version + 2,
  });
  expect((await getActivityForEdit(ctx.db, fixture.owner, created.id, signal())).ok).toBe(true);
  expect(
    (
      await updateCalendar(
        ctx.db,
        fixture.owner,
        { id: fixture.nativeCalendar.id, name: "Renamed native" },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await setCalendarMember(
        ctx.db,
        fixture.owner,
        { calendarId: fixture.nativeCalendar.id, userId: fixture.admin.id, role: "reader" },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await setCalendarArchived(
        ctx.db,
        fixture.owner,
        { id: fixture.nativeCalendar.id, archived: true },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await setCalendarArchived(
        ctx.db,
        fixture.owner,
        { id: fixture.nativeCalendar.id, archived: false },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const [stored] = await ctx.db.select().from(activities).where(eq(activities.id, created.id));
  expect(stored).toEqual(completed);
});
