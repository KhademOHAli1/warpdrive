import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, activityTypes, deals } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { getBusyWindows } from "./availability";
import { createCalendar, setCalendarArchived } from "./calendars";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});

function makeActor(user: { id: string; isAdmin: boolean }): PermSetUser {
  return {
    id: user.id,
    type: user.isAdmin ? "admin" : "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(),
  };
}

const SIG = () => new AbortController().signal;

it("reports busy inside an activity window and free outside it", async () => {
  const user = await seedUser(ctx.db);
  const actor = makeActor(user);
  const pipe = await seedPipelineWithStages(ctx.db, ["Lead"]);
  const [deal] = await ctx.db
    .insert(deals)
    .values({
      title: "D",
      pipelineId: pipe.pipeline.id,
      stageId: pipe.stages[0]!.id,
      ownerId: user.id,
      visibilityLevel: "all",
    })
    .returning();
  if (!deal) throw new Error("deal seed failed");
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
  if (!type) throw new Error("activity type 'call' not found");

  // A 10:00-10:30 activity (assigned to the user by default: assigneeId falls back to actor.id).
  await createActivity(
    ctx.db,
    actor,
    {
      typeId: type.id,
      subject: "Standup",
      dealId: deal.id,
      dueAt: "2026-07-10T10:00:00.000Z",
      durationMinutes: 30,
      personId: null,
      orgId: null,
      guestPersonIds: [],
      participantUserIds: [],
      customFields: {},
    },
    SIG(),
  );

  const busy = await getBusyWindows(
    ctx.db,
    {
      userId: user.id,
      from: new Date("2026-07-10T10:15:00.000Z"),
      to: new Date("2026-07-10T10:15:00.000Z"),
    },
    SIG(),
  );
  expect(busy.length).toBe(1);

  const free = await getBusyWindows(
    ctx.db,
    {
      userId: user.id,
      from: new Date("2026-07-10T11:00:00.000Z"),
      to: new Date("2026-07-10T11:00:00.000Z"),
    },
    SIG(),
  );
  expect(free.length).toBe(0);
});

it("excludes completed, deleted and explicitly free activities while retaining legacy busy rows", async () => {
  const user = await seedUser(ctx.db);
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "meeting seed absent");
  const dueAt = new Date("2027-03-21T09:00:00Z");
  const base = {
    typeId: type.id,
    ownerId: user.id,
    assigneeId: user.id,
    dueAt,
    durationMinutes: 60,
  };
  await ctx.db.insert(activities).values([
    { ...base, subject: "Completed", done: true, doneAt: new Date() },
    { ...base, subject: "Deleted", deletedAt: new Date() },
    { ...base, subject: "Free", availability: "free" },
  ]);
  const query = {
    userId: user.id,
    from: new Date("2027-03-21T08:00:00Z"),
    to: new Date("2027-03-21T11:00:00Z"),
  };
  expect(await getBusyWindows(ctx.db, query, SIG())).toEqual([]);
  await ctx.db.insert(activities).values({ ...base, subject: "Legacy busy" });
  expect(await getBusyWindows(ctx.db, query, SIG())).toEqual([
    { start: dueAt, end: new Date("2027-03-21T10:00:00Z") },
  ]);
});

it("removes archived calendar events from availability and restores them with the calendar", async () => {
  const user = await seedUser(ctx.db);
  const actor = makeActor(user);
  const cal = await createCalendar(
    ctx.db,
    actor,
    { name: "Availability", timeZone: "Europe/Berlin" },
    SIG(),
  );
  if (!cal.ok) throw cal.error;
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "meeting seed absent");
  await ctx.db.insert(activities).values({
    typeId: type.id,
    ownerId: user.id,
    assigneeId: user.id,
    calendarId: cal.value.id,
    subject: "Native busy",
    dueAt: new Date("2027-03-21T09:00:00Z"),
    durationMinutes: 60,
  });
  const query = {
    userId: user.id,
    from: new Date("2027-03-21T08:00:00Z"),
    to: new Date("2027-03-21T11:00:00Z"),
  };
  expect(await getBusyWindows(ctx.db, query, SIG())).toHaveLength(1);
  expect(
    (await setCalendarArchived(ctx.db, actor, { id: cal.value.id, archived: true }, SIG())).ok,
  ).toBe(true);
  expect(await getBusyWindows(ctx.db, query, SIG())).toEqual([]);
  expect(
    (await setCalendarArchived(ctx.db, actor, { id: cal.value.id, archived: false }, SIG())).ok,
  ).toBe(true);
  expect(await getBusyWindows(ctx.db, query, SIG())).toHaveLength(1);
});
