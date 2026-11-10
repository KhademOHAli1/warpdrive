import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, reminderRebuilds } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { rescheduleCalendarEvent } from "./calendarReschedule";
import { calendarScheduleSnapshot } from "./calendarReschedulePlan";
import { setCalendarMember } from "./calendars";
import { processReminderRebuilds } from "./reminderRebuild";
import { activeReminders, subscribedFixture } from "./reminderRebuild.test-helpers";
import { sig } from "./reminderSettings.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

it("serializes a waiting rebuild with membership revocation without a calendar/dirty-row deadlock", async () => {
  const { reader, calendar, event } = await subscribedFixture(ctx.db);
  await ctx.db.insert(reminderRebuilds).values({ activityId: event.id }).onConflictDoNothing();
  const revoke = await ctx.pool.connect();
  await revoke.query("BEGIN");
  await revoke.query("SELECT id FROM calendars WHERE id = $1 FOR UPDATE", [calendar.id]);
  const pid = (await revoke.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
  const rebuild = processReminderRebuilds(ctx.db, sig());
  let finished = false;
  try {
    await expect
      .poll(
        async () => {
          const result = await ctx.pool.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS waiting",
            [pid],
          );
          return result.rows[0]?.waiting;
        },
        { timeout: 5000, interval: 10 },
      )
      .toBe(true);
    const revocation = (async () => {
      try {
        await revoke.query("DELETE FROM calendar_members WHERE calendar_id=$1 AND user_id=$2", [
          calendar.id,
          reader.id,
        ]);
        await revoke.query("COMMIT");
      } catch (error) {
        await revoke.query("ROLLBACK");
        throw error;
      } finally {
        finished = true;
      }
    })();
    const results = await Promise.allSettled([rebuild, revocation]);
    expect(results).toMatchObject([{ status: "fulfilled" }, { status: "fulfilled" }]);
    expect(await activeReminders(ctx.db, event.id, reader.id)).toHaveLength(0);
    expect(
      await ctx.db.select().from(reminderRebuilds).where(eq(reminderRebuilds.activityId, event.id)),
    ).toEqual([]);
  } finally {
    if (!finished) await revoke.query("ROLLBACK");
    await rebuild.catch(() => undefined);
    revoke.release();
  }
});

it.each(["edit", "drag"] as const)(
  "allows an ACL trigger to insert a missing dirty marker while an event %s waits for calendar authorization",
  async (kind) => {
    const { owner, reader, calendar, event } = await subscribedFixture(ctx.db);
    await setCalendarMember(
      ctx.db,
      owner,
      { calendarId: calendar.id, userId: reader.id, role: "editor" },
      sig(),
    );
    await ctx.db.delete(reminderRebuilds).where(eq(reminderRebuilds.activityId, event.id));
    const revoke = await ctx.pool.connect();
    await revoke.query("BEGIN");
    await revoke.query("SELECT id FROM calendars WHERE id=$1 FOR UPDATE", [calendar.id]);
    const pid = (await revoke.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;
    if (event.dueAt === null) throw new Error("Scheduled concurrency fixture missing");
    const mutation =
      kind === "edit"
        ? updateActivity(
            ctx.db,
            reader,
            { id: event.id, subject: "Must not save", expectedVersion: event.version },
            sig(),
          )
        : rescheduleCalendarEvent(
            ctx.db,
            reader,
            {
              id: event.id,
              expected: calendarScheduleSnapshot({ ...event, dueAt: event.dueAt }),
              timeZone: "UTC",
              target: { date: "2030-03-23", time: "09:00" },
            },
            sig(),
          );
    let finished = false;
    try {
      await expect
        .poll(
          async () => {
            const result = await ctx.pool.query<{ waiting: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS waiting",
              [pid],
            );
            return result.rows[0]?.waiting;
          },
          { timeout: 5000, interval: 10 },
        )
        .toBe(true);
      const revocation = (async () => {
        try {
          await revoke.query("DELETE FROM calendar_members WHERE calendar_id=$1 AND user_id=$2", [
            calendar.id,
            reader.id,
          ]);
          await revoke.query("COMMIT");
        } catch (error) {
          await revoke.query("ROLLBACK");
          throw error;
        } finally {
          finished = true;
        }
      })();
      const results = await Promise.allSettled([mutation, revocation]);
      expect(results).toMatchObject([{ status: "fulfilled" }, { status: "fulfilled" }]);
      const outcome = results[0];
      if (outcome.status === "fulfilled")
        expect(outcome.value).toMatchObject({
          ok: false,
          error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
        });
      const [row] = await ctx.db.select().from(activities).where(eq(activities.id, event.id));
      expect(row?.subject).toBe(event.subject);
      expect(row?.version).toBe(event.version);
    } finally {
      if (!finished) await revoke.query("ROLLBACK");
      await mutation.catch(() => undefined);
      revoke.release();
    }
  },
);
