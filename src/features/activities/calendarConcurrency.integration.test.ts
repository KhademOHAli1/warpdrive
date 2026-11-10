import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, activityTypes } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { createCalendar, setCalendarMember } from "./calendars";
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
async function fixture() {
  const user = await seedUser(ctx.db);
  const actor: PermSetUser = {
    id: user.id,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new Error("seed type absent");
  const created = await createActivity(
    ctx.db,
    actor,
    {
      typeId: type.id,
      subject: "جلسه / Termin",
      dueAt: "2027-03-21T05:30:00Z",
      eventTimeZone: "Asia/Tehran",
    },
    signal(),
  );
  if (!created.ok) throw created.error;
  return { actor, id: created.value.id };
}
it("allows exactly one writer using a given event revision", async () => {
  const { actor, id } = await fixture();
  const results = await Promise.all(
    ["اول", "Zweite Änderung"].map((subject) =>
      updateActivity(ctx.db, actor, { id, subject, expectedVersion: 1 }, signal()),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toHaveLength(1);
  const loaded = await getActivityForEdit(ctx.db, actor, id, signal());
  expect(loaded.ok && loaded.value.version).toBe(2);
  expect(loaded.ok && loaded.value.eventTimeZone).toBe("Asia/Tehran");
});
it("detects changes made by older composers and never leaks the current revision to an unrelated user", async () => {
  const { actor, id } = await fixture();
  expect((await updateActivity(ctx.db, actor, { id, location: "Berlin" }, signal())).ok).toBe(true);
  const stale = await updateActivity(
    ctx.db,
    actor,
    { id, subject: "Stale", expectedVersion: 1 },
    signal(),
  );
  expect(stale.ok).toBe(false);
  const [row] = await ctx.db.select().from(activities).where(eq(activities.id, id));
  expect(row?.subject).toBe("جلسه / Termin");
  const outsider = await seedUser(ctx.db);
  const denied = await updateActivity(
    ctx.db,
    { ...actor, id: outsider.id, type: "regular" },
    { id, subject: "Probe", expectedVersion: 1 },
    signal(),
  );
  expect(!denied.ok && denied.error.id).toBe("E_ACTIVITY_001");
});

it("rechecks membership after waiting for a concurrent calendar revocation", async () => {
  const owner = await seedUser(ctx.db);
  const writer = await seedUser(ctx.db);
  const actor: PermSetUser = {
    id: owner.id,
    type: "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  const calendar = await createCalendar(
    ctx.db,
    actor,
    { name: "Revocation race", timeZone: "UTC" },
    signal(),
  );
  if (!calendar.ok) throw calendar.error;
  expect(
    (
      await setCalendarMember(
        ctx.db,
        actor,
        { calendarId: calendar.value.id, userId: writer.id, role: "editor" },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "meeting seed absent");
  const [event] = await ctx.db
    .insert(activities)
    .values({
      typeId: type.id,
      ownerId: owner.id,
      assigneeId: writer.id,
      calendarId: calendar.value.id,
      subject: "Original",
      dueAt: new Date("2027-03-21T09:00:00Z"),
    })
    .returning();
  if (event === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "event seed absent");

  const revoke = await ctx.pool.connect();
  await revoke.query("BEGIN");
  await revoke.query("SELECT id FROM calendars WHERE id = $1 FOR UPDATE", [calendar.value.id]);
  await revoke.query("DELETE FROM calendar_members WHERE calendar_id = $1 AND user_id = $2", [
    calendar.value.id,
    writer.id,
  ]);
  const pending = updateActivity(
    ctx.db,
    { ...actor, id: writer.id },
    { id: event.id, subject: "Must be denied", expectedVersion: event.version },
    signal(),
  );
  let committed = false;
  try {
    // Observe the actual database wait so the revoke commits after the old snapshot was taken.
    await expect
      .poll(
        async () => {
          const result = await ctx.pool.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0) AS waiting",
          );
          return result.rows[0]?.waiting;
        },
        { timeout: 5000, interval: 10 },
      )
      .toBe(true);
    await revoke.query("COMMIT");
    committed = true;
    const result = await pending;
    expect(!result.ok && result.error.id).toBe(ERROR_IDS.ACTIVITY_NOT_FOUND);
    const [row] = await ctx.db.select().from(activities).where(eq(activities.id, event.id));
    expect(row?.subject).toBe("Original");
    expect(row?.version).toBe(event.version);
  } finally {
    if (!committed) await revoke.query("ROLLBACK");
    await pending;
    revoke.release();
  }
});
