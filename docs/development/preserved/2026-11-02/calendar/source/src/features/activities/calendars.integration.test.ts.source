import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, activityTypes } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { calendarRange } from "./calendar";
import {
  createCalendar,
  listCalendars,
  setCalendarArchived,
  setCalendarMember,
  updateCalendar,
} from "./calendars";
import { getActivityForEdit } from "./getForEdit";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
const signal = () => AbortSignal.timeout(10_000);
async function user(name: string): Promise<PermSetUser> {
  const u = await seedUser(ctx.db, { name });
  return { id: u.id, type: "regular", isActive: true, flags: new Set(), groupIds: new Set() };
}
it("enforces calendar ownership, reader/editor roles and immediate revocation on every event path", async () => {
  const owner = await user("مالک");
  const reader = await user("Leserin");
  const writer = await user("Editor");
  const outsider = await user("Stranger");
  const cal = await createCalendar(
    ctx.db,
    owner,
    { name: "تقویم تیم / Teamkalender", timeZone: "Asia/Tehran" },
    signal(),
  );
  expect(cal.ok).toBe(true);
  if (!cal.ok) return;
  expect((await listCalendars(ctx.db, outsider, signal())).some((c) => c.id === cal.value.id)).toBe(
    false,
  );
  expect(
    (
      await setCalendarMember(
        ctx.db,
        outsider,
        { calendarId: cal.value.id, userId: reader.id, role: "editor" },
        signal(),
      )
    ).ok,
  ).toBe(false);
  for (const [actor, role] of [
    [reader, "reader"],
    [writer, "editor"],
  ] as const)
    expect(
      (
        await setCalendarMember(
          ctx.db,
          owner,
          { calendarId: cal.value.id, userId: actor.id, role },
          signal(),
        )
      ).ok,
    ).toBe(true);
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new Error("seed absent");
  const created = await createActivity(
    ctx.db,
    owner,
    {
      typeId: type.id,
      subject: "جلسهٔ تیم",
      dueAt: "2027-03-21T09:00:00Z",
      calendarId: cal.value.id,
    },
    signal(),
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const id = created.value.id;
  expect((await getActivityForEdit(ctx.db, reader, id, signal())).ok).toBe(true);
  expect((await updateActivity(ctx.db, reader, { id, subject: "Denied" }, signal())).ok).toBe(
    false,
  );
  expect(
    (await updateActivity(ctx.db, writer, { id, subject: "Termin", expectedVersion: 1 }, signal()))
      .ok,
  ).toBe(true);
  expect((await getActivityForEdit(ctx.db, outsider, id, signal())).ok).toBe(false);
  const range = { from: new Date("2027-03-21T00:00Z"), to: new Date("2027-03-22T00:00Z") };
  expect((await calendarRange(ctx.db, reader, range, signal())).map((a) => a.id)).toContain(id);
  expect(
    (
      await setCalendarMember(
        ctx.db,
        owner,
        { calendarId: cal.value.id, userId: reader.id, role: null },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect((await calendarRange(ctx.db, reader, range, signal())).map((a) => a.id)).not.toContain(id);
  expect((await getActivityForEdit(ctx.db, reader, id, signal())).ok).toBe(false);
});
it("does not expose private event details to readers or free/busy members", async () => {
  const owner = await user("Owner");
  const reader = await user("Reader");
  const cal = await createCalendar(
    ctx.db,
    owner,
    { name: "Privat", timeZone: "Europe/Berlin" },
    signal(),
  );
  if (!cal.ok) throw cal.error;
  await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.value.id, userId: reader.id, role: "reader" },
    signal(),
  );
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new Error("seed absent");
  const event = await createActivity(
    ctx.db,
    owner,
    {
      typeId: type.id,
      subject: "Vertraulich",
      calendarId: cal.value.id,
      eventVisibility: "private",
      dueAt: "2027-03-21T09:00:00Z",
    },
    signal(),
  );
  if (!event.ok) throw event.error;
  expect((await getActivityForEdit(ctx.db, reader, event.value.id, signal())).ok).toBe(false);
  await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.value.id, userId: reader.id, role: "editor" },
    signal(),
  );
  expect((await getActivityForEdit(ctx.db, reader, event.value.id, signal())).ok).toBe(true);
  await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.value.id, userId: reader.id, role: "freeBusy" },
    signal(),
  );
  expect((await getActivityForEdit(ctx.db, reader, event.value.id, signal())).ok).toBe(false);
  const busy = await calendarRange(
    ctx.db,
    reader,
    { from: new Date("2027-03-21T00:00Z"), to: new Date("2027-03-22T00:00Z") },
    signal(),
  );
  expect(busy).toHaveLength(1);
  expect(busy[0]).toMatchObject({
    busyOnly: true,
    subject: "",
    ownerName: null,
    dealId: null,
    personId: null,
    orgId: null,
  });
  expect(JSON.stringify(busy)).not.toContain("Vertraulich");
});

it("allows owners to rename, archive and restore a calendar without deleting its events", async () => {
  const owner = await user("Owner");
  const other = await user("Other");
  const cal = await createCalendar(
    ctx.db,
    owner,
    { name: "Planung", timeZone: "Europe/Berlin" },
    signal(),
  );
  if (!cal.ok) throw cal.error;
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "meeting seed absent");
  const [event] = await ctx.db
    .insert(activities)
    .values({
      typeId: type.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      calendarId: cal.value.id,
      subject: "جلسهٔ حفظ‌شده / Erhaltener Termin",
      dueAt: new Date("2027-03-21T09:00:00Z"),
      durationMinutes: 60,
      eventTimeZone: "Europe/Berlin",
      location: "Berlin",
    })
    .returning();
  if (event === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "event seed absent");
  const range = { from: new Date("2027-03-21T00:00Z"), to: new Date("2027-03-22T00:00Z") };
  expect((await calendarRange(ctx.db, owner, range, signal())).map((a) => a.id)).toContain(
    event.id,
  );
  expect(
    (
      await updateCalendar(
        ctx.db,
        other,
        { id: cal.value.id, name: "Denied", timeZone: "UTC" },
        signal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await updateCalendar(
        ctx.db,
        owner,
        { id: cal.value.id, name: "برنامهٔ تیم", timeZone: "Asia/Tehran" },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    (await setCalendarArchived(ctx.db, owner, { id: cal.value.id, archived: true }, signal())).ok,
  ).toBe(true);
  expect((await listCalendars(ctx.db, owner, signal())).some((c) => c.id === cal.value.id)).toBe(
    false,
  );
  expect((await calendarRange(ctx.db, owner, range, signal())).map((a) => a.id)).not.toContain(
    event.id,
  );
  expect((await getActivityForEdit(ctx.db, owner, event.id, signal())).ok).toBe(false);
  expect(await ctx.db.select().from(activities).where(eq(activities.id, event.id))).toEqual([
    event,
  ]);
  expect(
    (await setCalendarArchived(ctx.db, owner, { id: cal.value.id, archived: false }, signal())).ok,
  ).toBe(true);
  expect(
    (await listCalendars(ctx.db, owner, signal())).find((c) => c.id === cal.value.id)?.name,
  ).toBe("برنامهٔ تیم");
  expect((await calendarRange(ctx.db, owner, range, signal())).map((a) => a.id)).toContain(
    event.id,
  );
  expect((await getActivityForEdit(ctx.db, owner, event.id, signal())).ok).toBe(true);
  expect(await ctx.db.select().from(activities).where(eq(activities.id, event.id))).toEqual([
    event,
  ]);
});
