import { and, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_CALENDAR_REMINDER } from "@/constants/jobNames";
import { calendarReminderDefaults } from "@/db/schema";
import { runCalendarNotificationJob as runEmailNotificationJob } from "@/features/notifications/calendarNotification.test-helpers";
import { getFeed, getUnreadCount } from "@/features/notifications/feed";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { updateActivity } from "./activityUpdate";
import { deliverReminderIntent } from "./calendarReminderDelivery";
import { setEventReminderSettings } from "./personalReminderSettings";
import {
  drainTarget,
  evidence,
  noRules,
  pastFixture,
  queueRows,
  saveDefaults,
  sig,
  targetIntents,
  targetNotes,
  timedRules,
} from "./reminderDefaultsPast.test-helpers";
import { handoffReminderEmail } from "./reminderEmailHandoff";
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
  vi.useRealTimers();
  await boss.stop();
  await ctx.close();
});

it("explicitly toggling useDefault back on opts into the inherited late reminder once", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: noRules });
  expect(
    (
      await setEventReminderSettings(
        ctx.db,
        f.recipient,
        {
          activityId: f.event.id,
          expectedRevision: 0,
          selection: { useDefault: false, ...noRules },
        },
        sig(),
      )
    ).ok,
  ).toBe(true);
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(120));
  await processReminderRebuilds(ctx.db, sig());
  expect(await targetIntents(ctx.db, f)).toHaveLength(0);
  expect(
    (
      await setEventReminderSettings(
        ctx.db,
        f.recipient,
        { activityId: f.event.id, expectedRevision: 1, selection: { useDefault: true } },
        sig(),
      )
    ).ok,
  ).toBe(true);
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.noteIds).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it.each(["temporal", "unrelated shared"] as const)(
  "distinguishes an explicit inherited %s edit from a bulk past default",
  async (kind) => {
    const f = await pastFixture(ctx.db, { dueMinutes: 120, initial: timedRules(60) });
    const originalIds = (await targetIntents(ctx.db, f)).map((row) => row.id).sort();
    await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(150));
    await processReminderRebuilds(ctx.db, sig());
    expect((await targetIntents(ctx.db, f)).map((row) => row.id).sort()).toEqual(originalIds);
    const patch =
      kind === "temporal"
        ? { dueAt: new Date(f.now.getTime() + 30 * 60_000).toISOString() }
        : { subject: "Another editor only changed the title" };
    const edited = await updateActivity(
      ctx.db,
      kind === "temporal" ? f.recipient : f.editor,
      { id: f.event.id, expectedVersion: f.event.version, ...patch },
      sig(),
    );
    expect(edited.ok).toBe(true);
    await drainTarget(ctx, boss, f);
    const delivered = await evidence(ctx, f);
    expect(delivered.noteIds).toHaveLength(kind === "temporal" ? 1 : 0);
    expect(delivered.sends).toBe(kind === "temporal" ? 1 : 0);
    if (kind !== "temporal") expect(delivered.ids).toEqual(originalIds);
  },
);

it.each(["recorded", "missing"] as const)(
  "a %s handoff marker cannot grant an old receipt newly enabled email while its inbox channel survives",
  async (marker) => {
    const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: timedRules(120, false) });
    const intent = (await targetIntents(ctx.db, f))[0];
    if (intent === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "initial receipt intent absent");
    await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), null);
    if (marker === "recorded") await handoffReminderEmail(ctx.db, boss, intent.id, sig());
    expect((await targetIntents(ctx.db, f))[0]?.emailEnqueuedAt === null).toBe(
      marker === "missing",
    );
    const receipt = (await targetNotes(ctx.db, f))[0];
    if (receipt === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "delivered receipt absent");
    await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(120));
    await processReminderRebuilds(ctx.db, sig());
    expect(await getFeed(ctx.db, f.recipient, 20, sig())).toHaveLength(1);
    expect(await getUnreadCount(ctx.db, f.recipient, sig())).toBe(1);
    expect(
      await runEmailNotificationJob(ctx.db, { notificationId: receipt.id }, sig(), {
        send: f.send,
      }),
    ).toEqual(ok({ sent: false }));
    await drainTarget(ctx, boss, f);
    expect(await targetNotes(ctx.db, f)).toHaveLength(1);
    expect(await queueRows(ctx, EMAIL_NOTIFICATION_QUEUE, [receipt.id])).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  },
);

it("a later unrelated default edit preserves a rule's earlier future-at-save eligibility without any intervening rebuild", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 120, initial: noRules });
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(60));
  expect(await targetIntents(ctx.db, f)).toHaveLength(0);
  const fireAt = (f.event.dueAt?.getTime() ?? 0) - 60 * 60_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(fireAt + 15 * 60_000));
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 2, {
    ...timedRules(60),
    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
  });
  const [saved] = await ctx.db
    .select()
    .from(calendarReminderDefaults)
    .where(
      and(
        eq(calendarReminderDefaults.calendarId, f.calendar.id),
        eq(calendarReminderDefaults.userId, f.recipient.id),
      ),
    );
  expect(saved?.updatedAt.getTime()).toBeGreaterThan(fireAt);
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.noteIds).toHaveLength(1);
  expect(delivered.emailJobs).toHaveLength(1);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it("delivery before rebuild retains an existing overdue UUID when an unchanged timed rule has a newer defaults revision", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 5, initial: timedRules(10) });
  const intent = (await targetIntents(ctx.db, f))[0];
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "overdue intent absent");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, {
    ...timedRules(10),
    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
  });
  await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), boss);
  expect((await targetIntents(ctx.db, f))[0]?.state).toBe("delivered");
  expect(await targetNotes(ctx.db, f)).toHaveLength(1);
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.ids).toEqual([intent.id]);
  expect(delivered.sends).toBe(1);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual(delivered);
});

it("an originally eligible delivered email survives an unrelated defaults revision before its first handoff or send", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 60, initial: timedRules(120) });
  const intent = (await targetIntents(ctx.db, f))[0];
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "eligible intent absent");
  await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), null);
  expect((await targetIntents(ctx.db, f))[0]?.emailEnqueuedAt).toBeNull();
  const receipt = (await targetNotes(ctx.db, f))[0];
  if (receipt === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "eligible receipt absent");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, {
    ...timedRules(120),
    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
  });
  await handoffReminderEmail(ctx.db, boss, intent.id, sig());
  expect(await queueRows(ctx, EMAIL_NOTIFICATION_QUEUE, [receipt.id])).toHaveLength(1);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: receipt.id }, sig(), { send: f.send }),
  ).toEqual(ok({ sent: true }));
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.ids).toEqual([intent.id]);
  expect(delivered.noteIds).toEqual([receipt.id]);
  expect(delivered.emailJobs).toHaveLength(1);
  expect(delivered.sends).toBe(1);
});

it("removing and readding the same past rule before rebuild does not reuse its old pending eligibility", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 5, initial: timedRules(10) });
  const intent = (await targetIntents(ctx.db, f))[0];
  if (intent === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "original pending intent absent");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, noRules);
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 2, timedRules(10));
  await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), boss);
  expect(await targetNotes(ctx.db, f)).toHaveLength(0);
  await drainTarget(ctx, boss, f);
  expect(await evidence(ctx, f)).toEqual({
    ids: [intent.id],
    noteIds: [],
    reminderJobs: [],
    emailJobs: [],
    sends: 0,
  });
});

it("an overdue pending notification retains its UUID but cannot gain past email eligibility before or after rebuild", async () => {
  const f = await pastFixture(ctx.db, { dueMinutes: 5, initial: timedRules(10, false) });
  const intent = (await targetIntents(ctx.db, f))[0];
  if (intent === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "notification-only intent absent");
  await saveDefaults(ctx.db, f.recipient, f.calendar.id, 1, timedRules(10));
  await deliverReminderIntent(ctx.db, { intentId: intent.id }, sig(), null);
  expect((await targetIntents(ctx.db, f))[0]?.state).toBe("delivered");
  const receipt = (await targetNotes(ctx.db, f))[0];
  if (receipt === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "partial-channel receipt absent");
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: receipt.id }, sig(), { send: f.send }),
  ).toEqual(ok({ sent: false }));
  await processReminderRebuilds(ctx.db, sig());
  expect(await getFeed(ctx.db, f.recipient, 20, sig())).toHaveLength(1);
  expect(await getUnreadCount(ctx.db, f.recipient, sig())).toBe(1);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: receipt.id }, sig(), { send: f.send }),
  ).toEqual(ok({ sent: false }));
  await handoffReminderEmail(ctx.db, boss, intent.id, sig());
  await drainTarget(ctx, boss, f);
  const delivered = await evidence(ctx, f);
  expect(delivered.ids).toEqual([intent.id]);
  expect(delivered.noteIds).toEqual([receipt.id]);
  expect(delivered.emailJobs).toEqual([]);
  expect(delivered.sends).toBe(0);
});
