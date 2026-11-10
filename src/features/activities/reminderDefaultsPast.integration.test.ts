import { and, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import { calendarReminderDefaults } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { setEventReminderSettings } from "./personalReminderSettings";
import {
  drainTarget,
  evidence,
  noRules,
  pastFixture,
  saveDefaults,
  sig,
  targetIntents,
  targetNotes,
  timedRules,
} from "./reminderDefaultsPast.test-helpers";
import { processReminderRebuilds } from "./reminderRebuild";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let boss: PgBoss;
beforeEach(async () => {
  ctx = await makeTestDb();
  boss = new PgBoss(ctx.url);
  await boss.start();
  await boss.createQueue(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
});
afterEach(async () => {
  vi.useRealTimers();
  await boss.stop();
  await ctx.close();
});

it("a new already-past default does not mint or deliver another reminder for a future event already reminded", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: timedRules(120) });
  await drainTarget(ctx, boss, f);
  const before = await evidence(ctx, f);
  expect(before.noteIds).toHaveLength(1);
  expect(before.sends).toBe(1);
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(90));
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(before);
});

it("bulk defaults do not mint past reminders for an already-open past event subscribed to inherited defaults", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: -60, initial: noRules, subscribed: true });
  expect(await targetIntents(ctx.db, f)).toHaveLength(0);
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(30));
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual({
    ids: [],
    noteIds: [],
    reminderJobs: [],
    emailJobs: [],
    sends: 0,
  });
});

it("enabling email at the same past fire time keeps the delivered receipt's handoff marker and sends no retroactive email", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: timedRules(120, false) });
  await drainTarget(ctx, boss, f);
  const before = await evidence(ctx, f);
  const marker = (await targetIntents(ctx.db, f))[0]?.emailEnqueuedAt;
  expect(marker).toBeInstanceOf(Date);
  expect(before.noteIds).toHaveLength(1);
  expect(before.emailJobs).toEqual([]);
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(120));
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(before);
  expect((await targetIntents(ctx.db, f))[0]?.emailEnqueuedAt).toEqual(marker);
});

it("uses the durable default save time so an outage after a future fire time still catches up once", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 120, initial: timedRules(10) });
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(60));
  const [saved] = await ctx.db
    .select()
    .from(calendarReminderDefaults)
    .where(
      and(
        eq(calendarReminderDefaults.calendarId, f.calendar.id),
        eq(calendarReminderDefaults.userId, f.recipient.id),
      ),
    );
  const expectedFire = new Date(f.event.dueAt?.getTime() ?? 0).getTime() - 60 * 60_000;
  expect(saved?.updatedAt.getTime()).toBeLessThan(expectedFire);
  // Only Date advances. PostgreSQL and timers remain real; the persisted save timestamp survives.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(expectedFire + 30 * 60_000));
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.noteIds).toHaveLength(1);
  expect(delivered.emailJobs).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  const newIntent = (await targetIntents(ctx.db, f)).find(
    (row) => row.fireAt.getTime() === expectedFire,
  );
  expect(newIntent?.state).toBe("delivered");
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it("keeps today's all-day future reminder eligible even though its compatibility anchor is already past", async () => {
  const today = new Date().toISOString().slice(0, 10);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${today}T10:00:00.000Z`));
  const f = await pastFixture(ctx.db, { allDay: true, initial: noRules });
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, {
    timed: [],
    allDay: [
      { method: "notification", daysBefore: 0, time: "11:00" },
      { method: "email", daysBefore: 0, time: "11:00" },
    ],
  });
  expect(f.event.dueAt?.getTime()).toBeLessThan(Date.now());
  vi.setSystemTime(new Date(`${today}T12:00:00.000Z`));
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.noteIds).toHaveLength(1);
  expect(delivered.emailJobs).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it("preserves an existing overdue undelivered UUID through a default revision and recovers it once", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 5, initial: timedRules(10) });
  const old = (await targetIntents(ctx.db, f))[0];
  if (old === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "overdue intent missing");
  expect(old.state).toBe("pending");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, {
    ...timedRules(10),
    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
  });
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.ids).toEqual([old.id]);
  expect(delivered.noteIds).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it("an explicitly created late event retains deliberate immediate reminder behavior", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: -5, initial: timedRules(10) });
  await drainTarget(ctx, boss, f);
  expect(await targetNotes(ctx.db, f)).toHaveLength(1);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("an explicit per-event late reminder edit remains deliberate", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: timedRules(10) });
  const edited = await setEventReminderSettings(
    ctx.db,
    f.recipient,
    {
      activityId: f.event.id,
      expectedRevision: 0,
      selection: { useDefault: false, ...timedRules(120) },
    },
    sig(),
  );
  expect(edited.ok).toBe(true);
  await drainTarget(ctx, boss, f);
  expect(await targetNotes(ctx.db, f)).toHaveLength(1);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("an unrelated shared edit does not resurrect a new past rule suppressed after a bulk defaults save", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: noRules });
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(120));
  await processReminderRebuilds(ctx.db, sig());
  expect(await targetIntents(ctx.db, f)).toHaveLength(0);
  const edited = await updateActivity(
    ctx.db,
    f.editor,
    { id: f.event.id, expectedVersion: f.event.version, subject: "Shared title edit only" },
    sig(),
  );
  expect(edited.ok).toBe(true);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual({
    ids: [],
    noteIds: [],
    reminderJobs: [],
    emailJobs: [],
    sends: 0,
  });
});
