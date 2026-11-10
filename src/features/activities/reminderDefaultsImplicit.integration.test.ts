import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_CALENDAR_REMINDER } from "@/constants/jobNames";
import { makeTestDb } from "@/test/db";
import { deliverReminderIntent } from "./calendarReminderDelivery";
import { setEventReminderSettings } from "./personalReminderSettings";
import {
  drainTarget,
  evidence,
  pastFixture,
  queueRows,
  saveDefaults,
  sig,
  targetIntents,
  targetNotes,
  timedRules,
} from "./reminderDefaultsPast.test-helpers";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";
import { processReminderRebuilds } from "./reminderRebuild";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let boss: PgBoss;
beforeEach(async () => {
  ctx = await makeTestDb();
  boss = new PgBoss(ctx.url);
  await boss.start();
  await boss.createQueue(PGBOSS_QUEUE_CALENDAR_REMINDER);
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
});
afterEach(async () => {
  await boss.stop();
  await ctx.close();
});

it.each(["before rebuild", "after rebuild"] as const)(
  "the first persisted save preserves an overdue implicit UUID when delivery runs %s",
  async (order) => {
    const f = await pastFixture(ctx.db, { dueMinutes: 5, implicitDefaults: true });
    const intent = (await targetIntents(ctx.db, f))[0];
    if (intent === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "implicit overdue intent absent");
    expect(intent.defaultsVersion).toBe(0);
    expect(intent.state).toBe("pending");
    await saveDefaults(ctx.db, f.recipient, f.calendar.id, 0, {
      ...DEFAULT_REMINDER_RULES,
      allDay: [{ method: "notification", daysBefore: 0, time: "08:30" }],
    });
    if (order === "after rebuild") await processReminderRebuilds(ctx.db, sig());
    await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), boss);
    expect((await targetIntents(ctx.db, f)).find((row) => row.id === intent.id)?.state).toBe(
      "delivered",
    );
    await drainTarget(ctx, boss, f);
    const delivered = await evidence(ctx, f);
    expect(delivered.ids).toEqual([intent.id]);
    expect(delivered.noteIds).toHaveLength(1);
    expect(delivered.emailJobs).toHaveLength(1);
    expect(delivered.sends).toBe(1);
    await drainTarget(ctx, boss, f);
    expect(await evidence(ctx, f)).toEqual(delivered);
  },
);

it("a current email removal cannot poison the first explicit email opt-in on the same delivered receipt", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 5, initial: timedRules(10) });
  const intent = (await targetIntents(ctx.db, f))[0];
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "two-channel intent absent");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(10, false));
  await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), boss);
  const receipt = (await targetNotes(ctx.db, f))[0];
  if (receipt === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "notification receipt absent");
  expect(await queueRows(ctx, EMAIL_NOTIFICATION_QUEUE, [receipt.id])).toEqual([]);
  expect(f.send).not.toHaveBeenCalled();
  const optedIn = await setEventReminderSettings(
    ctx.db,
    f.recipient,
    {
      activityId: f.event.id,
      expectedRevision: 0,
      selection: { useDefault: false, timed: [{ method: "email", minutesBefore: 10 }], allDay: [] },
    },
    sig(),
  );
  expect(optedIn.ok).toBe(true);
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.ids).toEqual([intent.id]);
  expect(delivered.noteIds).toEqual([receipt.id]);
  expect(delivered.emailJobs).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});
