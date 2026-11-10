import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { calendarReminderIntents, notifications } from "@/db/schema";
import { getFeed, getUnreadCount } from "@/features/notifications/feed";
import { makeTestDb, type TestDb } from "@/test/db";
import { getEventReminderSettings, setEventReminderSettings } from "./personalReminderSettings";
import { reminderFixture, sig } from "./reminderSettings.test-helpers";
import { handleReminderJob } from "./reminders";

let ctx: TestDb | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await ctx?.close();
  ctx = undefined;
});

async function installInsertFailure(db: TestDb, intentId: string) {
  await db.pool.query(`
    CREATE SEQUENCE calendar_reminder_insert_failure_probe START 1;
    CREATE TABLE calendar_reminder_insert_failure_target (intent_id uuid PRIMARY KEY);
  `);
  await db.pool.query(
    "INSERT INTO calendar_reminder_insert_failure_target (intent_id) VALUES ($1)",
    [intentId],
  );
  await db.pool.query(`
    CREATE FUNCTION reject_calendar_reminder_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'activity_reminder' AND EXISTS (
        SELECT 1 FROM calendar_reminder_insert_failure_target
        WHERE intent_id::text = NEW.payload->>'reminderIntentId'
      ) THEN
        PERFORM nextval('calendar_reminder_insert_failure_probe');
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'calendar reminder notification insert failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_calendar_reminder_insert BEFORE INSERT ON notifications
    FOR EACH ROW EXECUTE FUNCTION reject_calendar_reminder_insert();
  `);
}

function insertWitness(db: TestDb) {
  return db.pool.query<{ last_value: string; is_called: boolean }>(
    "SELECT last_value, is_called FROM calendar_reminder_insert_failure_probe",
  );
}

it("controlled-Date direct handler preserves retryable intent after a witnessed notification insert failure, then delivers once", async () => {
  ctx = await makeTestDb();
  const db = ctx;
  const { owner, event } = await reminderFixture(db.db);
  const own = await getEventReminderSettings(db.db, owner, event.id, sig());
  if (!own.ok) throw own.error;
  const saved = await setEventReminderSettings(
    db.db,
    owner,
    {
      activityId: event.id,
      expectedRevision: own.value.revision,
      selection: {
        useDefault: false,
        timed: [{ method: "notification", minutesBefore: 30 }],
        allDay: [],
      },
    },
    sig(),
  );
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw saved.error;
  const readIntents = () =>
    db.db
      .select()
      .from(calendarReminderIntents)
      .where(eq(calendarReminderIntents.activityId, event.id))
      .orderBy(calendarReminderIntents.id);
  const readNotes = () =>
    db.db.select().from(notifications).where(eq(notifications.userId, owner.id));
  const before = await readIntents();
  const cancelled = before.filter((row) => row.state === "cancelled");
  const pending = before.filter((row) => row.state === "pending");
  expect(cancelled.length).toBeGreaterThan(0);
  expect(pending).toHaveLength(1);
  const intent = pending[0];
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "retry intent absent");
  expect(intent).toMatchObject({
    assigneeId: owner.id,
    inApp: true,
    email: false,
    settingsVersion: saved.value.revision,
    notificationId: null,
    deliveredAt: null,
    fireAt: new Date(intent.dueAt.getTime() - 30 * 60_000),
  });
  expect(await readNotes()).toEqual([]);
  await installInsertFailure(db, intent.id);
  expect((await insertWitness(db)).rows).toMatchObject([{ is_called: false }]);
  // Only Date is controlled; the database, notification writer and timeout timers stay real.
  const dueClock = new Date(intent.fireAt.getTime() + 1);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(dueClock);
    await expect(
      handleReminderJob(db.db, { data: { intentId: intent.id } }, sig(), null),
    ).rejects.toMatchObject({
      cause: { code: "P0001", message: "calendar reminder notification insert failure" },
    });
    // nextval survives rollback. An early admission failure cannot satisfy both assertions.
    const witness = (await insertWitness(db)).rows[0];
    expect(witness?.is_called).toBe(true);
    expect(Number(witness?.last_value)).toBeGreaterThan(0);
    expect(await readNotes()).toEqual([]);
    expect(await readIntents()).toEqual(before);
    await db.pool.query("DROP TRIGGER reject_calendar_reminder_insert ON notifications");
    await db.pool.query("DROP FUNCTION reject_calendar_reminder_insert()");

    // Retry the original UUID, with no intent recreation or queue/email handoff.
    await handleReminderJob(db.db, { data: { intentId: intent.id } }, sig(), null);
    const notes = await readNotes();
    expect(notes).toHaveLength(1);
    const receipt = notes[0];
    if (receipt === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "retry receipt absent");
    expect(receipt).toMatchObject({
      userId: owner.id,
      type: "activity_reminder",
      actorId: null,
      readAt: null,
      emailSentAt: null,
      payload: {
        activityId: event.id,
        reminderIntentId: intent.id,
        subject: event.subject,
        dueAt: intent.dueAt.toISOString(),
      },
    });
    const delivered = await readIntents();
    expect(delivered.find((row) => row.id === intent.id)).toEqual({
      ...intent,
      state: "delivered",
      deliveredAt: dueClock,
      notificationId: receipt.id,
    });
    expect(delivered.filter((row) => row.state === "cancelled")).toEqual(cancelled);
    expect((await getFeed(db.db, owner, 20, sig())).map((row) => row.id)).toEqual([receipt.id]);
    expect(await getUnreadCount(db.db, owner, sig())).toBe(1);

    await handleReminderJob(db.db, { data: { intentId: intent.id } }, sig(), null);
    expect(await readNotes()).toEqual(notes);
    expect(await readIntents()).toEqual(delivered);
    expect((await getFeed(db.db, owner, 20, sig())).map((row) => row.id)).toEqual([receipt.id]);
    expect(await getUnreadCount(db.db, owner, sig())).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
