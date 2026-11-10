import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, calendarReminderDefaults } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { setCalendarReminderDefaults } from "./personalReminderSettings";
import { processReminderRebuilds } from "./reminderRebuild";
import { activeReminders } from "./reminderRebuild.test-helpers";
import { customDefaults, reminderFixture, sig } from "./reminderSettings.test-helpers";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
const GATE_NAMESPACE = 47102;
const GATE_KEY = 30214;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
async function blockedBy(pid: number | undefined) {
  const result = await ctx.pool.query<{ waiting: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS waiting",
    [pid],
  );
  return result.rows[0]?.waiting === true;
}

it.each(["create", "assignment bootstrap"] as const)(
  "does not lose a default change racing initial %s reconciliation",
  async (kind) => {
    const { owner, calendar, input } = await reminderFixture(ctx.db);
    await ctx.db.execute(
      sql`CREATE FUNCTION pause_initial_reminder_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM activities WHERE id=NEW.activity_id AND subject='Paused reminder target') THEN PERFORM pg_advisory_xact_lock(47102,30214); END IF; RETURN NEW; END $$`,
    );
    await ctx.db.execute(
      sql`CREATE TRIGGER pause_initial_reminder_test BEFORE INSERT ON activity_reminder_intents FOR EACH ROW EXECUTE FUNCTION pause_initial_reminder_test()`,
    );
    let activityId: string | undefined;
    if (kind === "assignment bootstrap") {
      const [unplanned] = await ctx.db
        .insert(activities)
        .values({
          typeId: input.typeId,
          reminderEngine: "intent",
          ownerId: owner.id,
          assigneeId: owner.id,
          calendarId: calendar.id,
          subject: "Paused reminder target",
          dueAt: new Date(input.dueAt),
        })
        .returning();
      if (unplanned === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "unplanned native seed absent");
      activityId = unplanned.id;
    }
    const gate = await ctx.pool.connect();
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock($1,$2)", [GATE_NAMESPACE, GATE_KEY]);
    const gatePid = (await gate.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;
    const initial =
      kind === "create"
        ? createActivity(
            ctx.db,
            owner,
            { ...input, subject: "Paused reminder target" },
            sig(),
          ).then((result) => {
            if (!result.ok) throw result.error;
            activityId = result.value.id;
          })
        : processReminderRebuilds(ctx.db, sig());
    let changing: ReturnType<typeof setCalendarReminderDefaults> | undefined;
    let released = false;
    try {
      await expect.poll(() => blockedBy(gatePid), { timeout: 5000, interval: 10 }).toBe(true);
      const waiting = await ctx.pool.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))",
        [gatePid],
      );
      const initialPid = waiting.rows[0]?.pid;
      changing = setCalendarReminderDefaults(
        ctx.db,
        owner,
        { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
        sig(),
      );
      // Either the old implementation commits, or the corrected command waits for initial work.
      await expect
        .poll(
          async () => {
            const [committed] = await ctx.db
              .select({ version: calendarReminderDefaults.version })
              .from(calendarReminderDefaults)
              .where(
                and(
                  eq(calendarReminderDefaults.calendarId, calendar.id),
                  eq(calendarReminderDefaults.userId, owner.id),
                ),
              );
            return committed !== undefined || (await blockedBy(initialPid));
          },
          { timeout: 5000, interval: 10 },
        )
        .toBe(true);
      await gate.query("COMMIT");
      released = true;
      await initial;
      expect(await changing).toMatchObject({ ok: true });
      await processReminderRebuilds(ctx.db, sig());
      if (activityId === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "target absent");
      expect(await activeReminders(ctx.db, activityId, owner.id)).toMatchObject([
        {
          defaultsVersion: 1,
          inApp: true,
          email: false,
          fireAt: new Date(new Date(input.dueAt).getTime() - 30 * 60_000),
        },
      ]);
    } finally {
      if (!released) await gate.query("ROLLBACK");
      await initial.catch(() => undefined);
      await changing?.catch(() => undefined);
      gate.release();
    }
  },
);

it.each(["revoked", "archived"] as const)(
  "rechecks %s authorization after waiting for the calendar lock",
  async (kind) => {
    const { reader, calendar } = await reminderFixture(ctx.db);
    const change = await ctx.pool.connect();
    await change.query("BEGIN");
    await change.query("SELECT id FROM calendars WHERE id=$1 FOR UPDATE", [calendar.id]);
    if (kind === "revoked")
      await change.query("DELETE FROM calendar_members WHERE calendar_id=$1 AND user_id=$2", [
        calendar.id,
        reader.id,
      ]);
    else await change.query("UPDATE calendars SET deleted_at=now() WHERE id=$1", [calendar.id]);
    const pid = (await change.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;
    const pending = setCalendarReminderDefaults(
      ctx.db,
      reader,
      { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
      sig(),
    );
    let committed = false;
    try {
      await expect.poll(() => blockedBy(pid), { timeout: 5000, interval: 10 }).toBe(true);
      await change.query("COMMIT");
      committed = true;
      expect(await pending).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND },
      });
      expect(
        await ctx.db
          .select()
          .from(calendarReminderDefaults)
          .where(eq(calendarReminderDefaults.userId, reader.id)),
      ).toEqual([]);
    } finally {
      if (!committed) await change.query("ROLLBACK");
      await pending.catch(() => undefined);
      change.release();
    }
  },
);

it("serializes concurrent personal default writers without upgrading shared calendar locks", async () => {
  const { owner, reader, calendar } = await reminderFixture(ctx.db);
  const results = await Promise.all(
    [owner, reader].map((actor) =>
      setCalendarReminderDefaults(
        ctx.db,
        actor,
        { calendarId: calendar.id, expectedRevision: 0, defaults: customDefaults },
        sig(),
      ),
    ),
  );
  expect(results).toMatchObject([
    { ok: true, value: { revision: 1 } },
    { ok: true, value: { revision: 1 } },
  ]);
});
