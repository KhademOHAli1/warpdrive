import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  activities,
  activityTypes,
  deals,
  notificationPreferences,
  notifications,
  persons,
  pipelines,
  users,
} from "@/db/schema";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { deleteActivity } from "./activityDelete";
import { updateActivity } from "./activityUpdate";
import { getActivityForEdit } from "./getForEdit";
import { processActivityReminder } from "./reminderDelivery";
import { retryActivityReminder } from "./reminderRetry";
import { completeActivity, createActivity } from "./repo";

let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

async function fixture(leadMinutes = 5) {
  const user = await seedUser(h.db, { isAdmin: true });
  const actor = await hydrateActor(h.db, user.id, signal());
  if (actor === null) throw new Error("Calendar actor missing");
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new Error("Calendar meeting type missing");
  const clock = await h.db.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);
  const now = new Date(clock.rows[0]?.now ?? Number.NaN);
  if (!Number.isFinite(now.getTime())) throw new Error("Fixture DB clock missing");
  const dueAt = new Date(now.getTime() + leadMinutes * 60_000);
  const created = await createActivity(
    h.db,
    actor,
    {
      typeId: type.id,
      subject: "Native reminder",
      dueAt: dueAt.toISOString(),
      endAt: new Date(dueAt.getTime() + 3_600_000).toISOString(),
      durationMinutes: 60,
      authoredTimeZone: "Europe/Berlin",
      reminderTimeZone: "Europe/Berlin",
      reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
    },
    signal(),
  );
  if (!created.ok) throw created.error;
  return { user, actor, dueAt, activity: created.value, intent: await intent(created.value.id) };
}
async function intent(activityId: string) {
  const [row] = await h.db
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activityId));
  if (row === undefined) throw new Error("Durable reminder missing");
  return row;
}
async function noteCount() {
  return (await h.db.select().from(notifications)).length;
}

it("commits authored zone and explicit reminder intent alongside the event without a running queue", async () => {
  const f = await fixture();
  expect(f.intent).toMatchObject({
    version: 1,
    managed: true,
    channel: "in_app",
    eventTimeZone: "Europe/Berlin",
    reminderTimeZone: "Europe/Berlin",
    status: "pending",
    attemptCount: 0,
  });
  expect(f.intent.fireAt?.getTime()).toBe(f.dueAt.getTime() - 600_000);
  const read = await getActivityForEdit(h.db, f.actor, f.activity.id, signal());
  expect(read.ok && read.value).toMatchObject({
    authoredTimeZone: "Europe/Berlin",
    reminder: { generationId: f.intent.generationId, status: "pending" },
  });
  expect(await noteCount()).toBe(0);
});
it("serializes concurrent duplicate dispatch into one atomic in-app outcome", async () => {
  const f = await fixture();
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal()),
    ),
  );
  expect(results.map((r) => r.state).sort()).toEqual(["completed", "completed", "delivered"]);
  const saved = await intent(f.activity.id);
  expect(saved).toMatchObject({ status: "delivered", attemptCount: 1, outcomeReason: null });
  const rows = await h.db.select().from(notifications);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toBe(saved.notificationId);
  expect(rows[0]?.payload).toMatchObject({
    activityId: f.activity.id,
    reminderGenerationId: f.intent.generationId,
  });
});
it("a legacy nudge consumes current managed intent and cannot create a second outcome", async () => {
  const f = await fixture();
  expect((await processActivityReminder(h.db, f.activity.id, undefined, signal())).state).toBe(
    "delivered",
  );
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("completed");
  expect(await noteCount()).toBe(1);
});
it("moving an event later invalidates the previous job and checks the actual current due time", async () => {
  const f = await fixture();
  const dueAt = new Date(f.dueAt.getTime() + 3_600_000).toISOString();
  const changed = await updateActivity(
    h.db,
    f.actor,
    {
      id: f.activity.id,
      dueAt,
      endAt: new Date(Date.parse(dueAt) + 3_600_000).toISOString(),
      authoredTimeZone: "Europe/Berlin",
      expectedReminderGeneration: f.intent.generationId,
    },
    signal(),
  );
  expect(changed.ok).toBe(true);
  const current = await intent(f.activity.id);
  expect(current.generationId).not.toBe(f.intent.generationId);
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("stale");
  expect(
    (await processActivityReminder(h.db, f.activity.id, current.generationId, signal())).state,
  ).toBe("not_due");
  expect(await noteCount()).toBe(0);
});
it("title-only old callers preserve the exact current intent and delivered receipt", async () => {
  const f = await fixture();
  await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  const before = await intent(f.activity.id);
  expect(
    (await updateActivity(h.db, f.actor, { id: f.activity.id, subject: "Renamed only" }, signal()))
      .ok,
  ).toBe(true);
  const after = await intent(f.activity.id);
  expect(after).toEqual(before);
  expect(
    (await processActivityReminder(h.db, f.activity.id, after.generationId, signal())).state,
  ).toBe("completed");
  expect(await noteCount()).toBe(1);
});
it("explicit none cancels current work and rejects a stale reminder editor before its subject change", async () => {
  const f = await fixture();
  expect(
    (
      await updateActivity(
        h.db,
        f.actor,
        {
          id: f.activity.id,
          reminder: { kind: "none" },
          expectedReminderGeneration: f.intent.generationId,
        },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const cancelled = await intent(f.activity.id);
  expect(cancelled.status).toBe("cancelled");
  const stale = await updateActivity(
    h.db,
    f.actor,
    {
      id: f.activity.id,
      subject: "Stale overwrite",
      expectedReminderGeneration: f.intent.generationId,
    },
    signal(),
  );
  expect(stale.ok ? null : stale.error.id).toBe("E_ACTIVITY_010");
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("stale");
  const [row] = await h.db.select().from(activities).where(eq(activities.id, f.activity.id));
  expect(row?.subject).toBe("Native reminder");
  expect(await noteCount()).toBe(0);
});
it("completion cancels pending work and an already delivered event does not resend after reopening", async () => {
  const pending = await fixture();
  expect(
    (await completeActivity(h.db, pending.actor, pending.activity.id, true, signal())).ok,
  ).toBe(true);
  expect((await intent(pending.activity.id)).status).toBe("cancelled");
  expect(
    (
      await processActivityReminder(
        h.db,
        pending.activity.id,
        pending.intent.generationId,
        signal(),
      )
    ).state,
  ).toBe("stale");
  const delivered = await fixture();
  await processActivityReminder(
    h.db,
    delivered.activity.id,
    delivered.intent.generationId,
    signal(),
  );
  expect(
    (await completeActivity(h.db, delivered.actor, delivered.activity.id, true, signal())).ok,
  ).toBe(true);
  expect(
    (await completeActivity(h.db, delivered.actor, delivered.activity.id, false, signal())).ok,
  ).toBe(true);
  expect((await intent(delivered.activity.id)).generationId).toBe(delivered.intent.generationId);
  expect(
    (
      await processActivityReminder(
        h.db,
        delivered.activity.id,
        delivered.intent.generationId,
        signal(),
      )
    ).state,
  ).toBe("completed");
  expect(await noteCount()).toBe(1);
});
it("deleting an event cancels its pending reminder", async () => {
  const f = await fixture();
  expect((await deleteActivity(h.db, f.actor, f.activity.id, signal())).ok).toBe(true);
  expect((await intent(f.activity.id)).status).toBe("cancelled");
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("stale");
  expect(await noteCount()).toBe(0);
});
it("does not send early or send a finished event late", async () => {
  const future = await fixture(30);
  expect(
    (await processActivityReminder(h.db, future.activity.id, future.intent.generationId, signal()))
      .state,
  ).toBe("not_due");
  const finished = await fixture(-120);
  expect(
    (
      await processActivityReminder(
        h.db,
        finished.activity.id,
        finished.intent.generationId,
        signal(),
      )
    ).state,
  ).toBe("suppressed");
  expect((await intent(finished.activity.id)).outcomeReason).toBe("event_finished");
  expect(await noteCount()).toBe(0);
});
it("rechecks active recipient and in-app preference at delivery rather than the original selection", async () => {
  const inactive = await fixture();
  await h.db.update(users).set({ isActive: false }).where(eq(users.id, inactive.user.id));
  expect(
    (
      await processActivityReminder(
        h.db,
        inactive.activity.id,
        inactive.intent.generationId,
        signal(),
      )
    ).state,
  ).toBe("suppressed");
  const disabled = await fixture();
  await h.db
    .insert(notificationPreferences)
    .values({ userId: disabled.user.id, type: "activity_reminder", inApp: false, email: true });
  expect(
    (
      await processActivityReminder(
        h.db,
        disabled.activity.id,
        disabled.intent.generationId,
        signal(),
      )
    ).state,
  ).toBe("suppressed");
  expect(await noteCount()).toBe(0);
});
it("old caller clearing a date invalidates pending work without silently clearing the saved choice", async () => {
  const f = await fixture();
  expect(
    (await updateActivity(h.db, f.actor, { id: f.activity.id, dueAt: null }, signal())).ok,
  ).toBe(true);
  const current = await intent(f.activity.id);
  expect(current.selection).toEqual(f.intent.selection);
  expect(current.status).toBe("cancelled");
  expect((await processActivityReminder(h.db, f.activity.id, undefined, signal())).state).toBe(
    "cancelled",
  );
  expect(await noteCount()).toBe(0);
});
it("a real notification insert failure rolls back the effect, exposes retry, and recovers once", async () => {
  const f = await fixture();
  await h.pool.query(
    `CREATE FUNCTION calendar_test_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled calendar notification failure'; END $$`,
  );
  await h.pool.query(
    `CREATE TRIGGER calendar_test_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION calendar_test_fail_notification()`,
  );
  await expect(
    processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal()),
  ).rejects.toThrow();
  expect(await noteCount()).toBe(0);
  const failed = await intent(f.activity.id);
  expect(failed).toMatchObject({
    generationId: f.intent.generationId,
    status: "failed",
    notificationId: null,
    attemptCount: 1,
  });
  await h.pool.query(`DROP TRIGGER calendar_test_notification ON notifications`);
  expect(
    (await retryActivityReminder(h.db, f.actor, f.activity.id, failed.generationId, signal())).ok,
  ).toBe(true);
  expect(
    (await processActivityReminder(h.db, f.activity.id, failed.generationId, signal())).state,
  ).toBe("delivered");
  expect(
    (await processActivityReminder(h.db, f.activity.id, failed.generationId, signal())).state,
  ).toBe("completed");
  expect(await noteCount()).toBe(1);
});
it("hides current person-parent content from a recipient who loses parent visibility", async () => {
  const f = await fixture();
  const recipient = await seedUser(h.db);
  const owner = await seedUser(h.db);
  const [person] = await h.db
    .insert(persons)
    .values({ name: "Private contact", ownerId: owner.id, visibilityLevel: "all" })
    .returning();
  if (person === undefined) throw new Error("Contact fixture missing");
  expect(
    (
      await updateActivity(
        h.db,
        f.actor,
        { id: f.activity.id, personId: person.id, assigneeId: recipient.id },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const current = await intent(f.activity.id);
  await h.db.update(persons).set({ visibilityLevel: "owner" }).where(eq(persons.id, person.id));
  expect(
    (await processActivityReminder(h.db, f.activity.id, current.generationId, signal())).state,
  ).toBe("suppressed");
  expect((await intent(f.activity.id)).outcomeReason).toBe("not_available");
  expect(await noteCount()).toBe(0);
});
it("rejects a currently archived pipeline even for an administrator recipient", async () => {
  const f = await fixture();
  const pipe = await seedPipelineWithStages(h.db, ["Qualified"]);
  const stage = pipe.stages[0];
  if (stage === undefined) throw new Error("Stage fixture missing");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "Deal parent",
      pipelineId: pipe.pipeline.id,
      stageId: stage.id,
      ownerId: f.user.id,
      visibilityLevel: "all",
    })
    .returning();
  if (deal === undefined) throw new Error("Deal fixture missing");
  expect(
    (await updateActivity(h.db, f.actor, { id: f.activity.id, dealId: deal.id }, signal())).ok,
  ).toBe(true);
  await h.db.update(pipelines).set({ isArchived: true }).where(eq(pipelines.id, pipe.pipeline.id));
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("suppressed");
  expect(await noteCount()).toBe(0);
});
it("stores the actual all-day civil date and chosen clock across a DST change", async () => {
  const f = await fixture();
  expect(
    (
      await updateActivity(
        h.db,
        f.actor,
        {
          id: f.activity.id,
          allDay: true,
          dueAt: "2027-03-28T00:00:00.000Z",
          dueDate: "2027-03-28",
          endDate: "2027-03-28",
          endAt: null,
          authoredTimeZone: "Europe/Berlin",
          reminderTimeZone: "Europe/Berlin",
          reminder: { kind: "all_day_at", channel: "in_app", localTime: "09:00" },
        },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const row = await intent(f.activity.id);
  expect(row.fireAt?.toISOString()).toBe("2027-03-28T07:00:00.000Z");
  expect(row.eventTimeZone).toBe("Europe/Berlin");
  expect(row.selection).toEqual({ kind: "all_day_at", channel: "in_app", localTime: "09:00" });
});
it("rejects a DST-gap reminder and rolls back its preceding event edit", async () => {
  const f = await fixture();
  await expect(
    updateActivity(
      h.db,
      f.actor,
      {
        id: f.activity.id,
        subject: "Must not persist",
        allDay: true,
        dueAt: "2027-03-28T00:00:00.000Z",
        dueDate: "2027-03-28",
        endAt: null,
        authoredTimeZone: "Europe/Berlin",
        reminderTimeZone: "Europe/Berlin",
        reminder: { kind: "all_day_at", channel: "in_app", localTime: "02:30" },
      },
      signal(),
    ),
  ).rejects.toMatchObject({ id: "E_ACTIVITY_009" });
  const [row] = await h.db.select().from(activities).where(eq(activities.id, f.activity.id));
  expect(row?.subject).toBe("Native reminder");
  expect(row?.allDay).toBe(false);
  expect((await intent(f.activity.id)).generationId).toBe(f.intent.generationId);
});
it("deleting a delivered notification retains the receipt tombstone and never recreates it", async () => {
  const f = await fixture();
  await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  await h.db.delete(notifications);
  expect(await currentDelivered()).toMatchObject({ status: "delivered", notificationId: null });
  expect(
    (await processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal())).state,
  ).toBe("completed");
  expect(await noteCount()).toBe(0);
  function currentDelivered() {
    return intent(f.activity.id);
  }
});
it("a deliberately enabled legacy reminder is new intent without guessed historical receipt adoption", async () => {
  const f = await fixture();
  // Recreate an actual predecessor shape: activity + possible old notification,
  // with no managed intent or recorded original authored zone.
  await h.db
    .delete(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, f.activity.id));
  const [previous] = await h.db
    .insert(notifications)
    .values({
      userId: f.user.id,
      type: "activity_reminder",
      payload: { activityId: f.activity.id, subject: f.activity.subject },
    })
    .returning();
  if (previous === undefined) throw new Error("Historical notification fixture missing");
  expect(
    (
      await updateActivity(
        h.db,
        f.actor,
        {
          id: f.activity.id,
          reminderTimeZone: "UTC",
          reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
          expectedReminderGeneration: null,
        },
        signal(),
      )
    ).ok,
  ).toBe(true);
  const current = await intent(f.activity.id);
  expect(current).toMatchObject({
    managed: true,
    eventTimeZone: null,
    reminderTimeZone: "UTC",
    notificationId: null,
    status: "pending",
  });
  expect(
    (await processActivityReminder(h.db, f.activity.id, current.generationId, signal())).state,
  ).toBe("delivered");
  expect(await noteCount()).toBe(2);
  expect((await intent(f.activity.id)).notificationId).not.toBe(previous.id);
});
