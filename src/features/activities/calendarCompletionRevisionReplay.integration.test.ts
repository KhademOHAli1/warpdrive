import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityReminderIntents,
  activityReminderSettings,
  reminderRebuilds,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { getEventReminderSettings, setEventReminderSettings } from "./personalReminderSettings";
import { reminderFixture, sig } from "./reminderSettings.test-helpers";
import { completeActivity } from "./repo";

let h: TestDb;
afterEach(async () => {
  await h?.close();
});

async function snapshot(activityId: string) {
  const [activity, settings, intents, rebuilds] = await Promise.all([
    h.db.select().from(activities).where(eq(activities.id, activityId)),
    h.db
      .select()
      .from(activityReminderSettings)
      .where(eq(activityReminderSettings.activityId, activityId))
      .orderBy(activityReminderSettings.id),
    h.db
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, activityId))
      .orderBy(activityReminderIntents.id),
    h.db.select().from(reminderRebuilds).where(eq(reminderRebuilds.activityId, activityId)),
  ]);
  return { activity, settings, intents, rebuilds };
}

test("a stale-token same-state completion returns the canonical row without reminder writes", async () => {
  h = await makeTestDb();
  const { owner, event } = await reminderFixture(h.db);
  const context = await getEventReminderSettings(h.db, owner, event.id, sig());
  if (!context.ok) throw context.error;
  const personal = await setEventReminderSettings(
    h.db,
    owner,
    {
      activityId: event.id,
      expectedRevision: context.value.revision,
      selection: {
        useDefault: false,
        timed: [{ method: "notification", minutesBefore: 30 }],
        allDay: [],
      },
    },
    sig(),
  );
  expect(personal.ok).toBe(true);
  if (!personal.ok) throw personal.error;

  const completed = await completeActivity(h.db, owner, event.id, true, sig(), event.version);
  expect(completed.ok).toBe(true);
  if (!completed.ok) throw completed.error;
  const before = await snapshot(event.id);
  const canonical = before.activity[0];
  if (canonical === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Completion replay activity missing");
  expect(canonical.done).toBe(true);
  expect(canonical.doneAt).toBeInstanceOf(Date);
  expect(canonical.version).toBeGreaterThan(event.version);
  expect(before.settings).toContainEqual(
    expect.objectContaining({
      userId: owner.id,
      source: "personal",
      version: personal.value.revision,
    }),
  );
  expect(before.intents.length).toBeGreaterThan(0);
  expect(before.intents.every((intent) => intent.state === "cancelled")).toBe(true);

  // Statement triggers also reject zero-row reconciliation commands: a replay does no DML.
  await h.pool.query(`
    CREATE FUNCTION reject_revision_completion_replay() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'completion replay wrote %', TG_TABLE_NAME; END $$;
    CREATE TRIGGER reject_revision_completion_activity BEFORE UPDATE ON activities
      FOR EACH STATEMENT EXECUTE FUNCTION reject_revision_completion_replay();
    CREATE TRIGGER reject_revision_completion_settings
      BEFORE INSERT OR UPDATE OR DELETE ON activity_reminder_settings
      FOR EACH STATEMENT EXECUTE FUNCTION reject_revision_completion_replay();
    CREATE TRIGGER reject_revision_completion_intents
      BEFORE INSERT OR UPDATE OR DELETE ON activity_reminder_intents
      FOR EACH STATEMENT EXECUTE FUNCTION reject_revision_completion_replay();
    CREATE TRIGGER reject_revision_completion_rebuilds
      BEFORE INSERT OR UPDATE OR DELETE ON reminder_rebuilds
      FOR EACH STATEMENT EXECUTE FUNCTION reject_revision_completion_replay();
  `);

  const replay = await completeActivity(h.db, owner, event.id, true, sig(), event.version);
  expect(replay).toEqual({ ok: true, value: canonical });
  expect(await snapshot(event.id)).toEqual(before);

  const staleChange = await completeActivity(h.db, owner, event.id, false, sig(), event.version);
  expect(staleChange).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_CONFLICT, message: "activity revision changed" },
  });
  expect(await snapshot(event.id)).toEqual(before);
});
