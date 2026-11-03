import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { activities, activityTypes, notifications } from "@/db/schema";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { getActivityForEdit } from "./getForEdit";
import { processActivityReminder } from "./reminderDelivery";
import { createActivity } from "./repo";

// Root reserved 0102. This fixture remains UNRUN until Root actually generates,
// reviews and admits all 103 canonical entries. It does not guess a future tag,
// snapshot or SQL hash; the executed request must pin those actual bytes.
it("upgrades populated 102-entry customers without inventing zones or reminder history", async () => {
  const h = await freshMigrationDb();
  const candidate = await migrationFolder(103);
  const signal = () => AbortSignal.timeout(15_000);
  try {
    await installPrefix(h, 102);
    expect(
      (
        await h.pool.query(
          "SELECT to_regclass('public.activity_reminder_intents') IS NULL AS absent",
        )
      ).rows,
    ).toEqual([{ absent: true }]);
    const user = await seedUser(h.db, { isAdmin: true });
    const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
    if (type === undefined) throw new Error("Upgrade meeting fixture missing");
    const old = await h.db
      .insert(activities)
      .values([
        {
          typeId: type.id,
          subject: "Exact timed event",
          ownerId: user.id,
          assigneeId: user.id,
          dueAt: new Date("2026-10-25T01:30:29.123Z"),
          durationMinutes: 60,
        },
        {
          typeId: type.id,
          subject: "Known civil date",
          ownerId: user.id,
          assigneeId: user.id,
          allDay: true,
          dueAt: new Date("2027-03-28T00:00:00Z"),
          dueDate: "2027-03-28",
          endDate: "2027-03-29",
        },
        {
          typeId: type.id,
          subject: "Unknown authored zone",
          ownerId: user.id,
          assigneeId: user.id,
          allDay: true,
          dueAt: new Date("2026-10-25T00:00:00Z"),
        },
        {
          typeId: type.id,
          subject: "Finished old event",
          ownerId: user.id,
          assigneeId: user.id,
          done: true,
          doneAt: new Date("2026-10-25T02:00:00Z"),
        },
      ])
      .returning();
    const first = old[0];
    if (first === undefined) throw new Error("Upgrade event fixture missing");
    await h.db.insert(notifications).values({
      userId: user.id,
      type: "activity_reminder",
      payload: { activityId: first.id, subject: first.subject },
    });
    const oldRows = (await h.pool.query("SELECT to_jsonb(a) AS data FROM activities a ORDER BY id"))
      .rows;
    const oldNotifications = (
      await h.pool.query("SELECT to_jsonb(n) AS data FROM notifications n ORDER BY id")
    ).rows;
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(102);
    const migrations = await readCanonicalMigrations(candidate.folder, signal());
    if (!migrations.ok) throw new Error(migrations.error);
    expect(migrations.value).toHaveLength(103);
    expect(migrations.value[102]?.idx).toBe(102);
    expect(migrations.value[102]?.tag).toMatch(/^0102_/);
    expect(await applyMigrations(h.db, signal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(
      (await h.pool.query("SELECT to_jsonb(a) AS data FROM activities a ORDER BY id")).rows,
    ).toEqual(oldRows);
    expect(
      (await h.pool.query("SELECT to_jsonb(n) AS data FROM notifications n ORDER BY id")).rows,
    ).toEqual(oldNotifications);
    expect((await ledger(h)).slice(0, 102)).toEqual(oldLedger);
    expect(await ledger(h)).toHaveLength(103);
    expect(await h.db.select().from(activityReminderIntents)).toHaveLength(0);
    const actor = await hydrateActor(h.db, user.id, signal());
    if (actor === null) throw new Error("Upgrade actor fixture missing");
    const read = await getActivityForEdit(h.db, actor, first.id, signal());
    expect(read.ok && read.value).toMatchObject({
      authoredTimeZone: null,
      reminder: null,
      dueAt: "2026-10-25T01:30:29.123Z",
    });
    const clock = await h.pool.query<{ due: Date; end: Date }>(
      `SELECT clock_timestamp()+interval '5 minutes' AS due, clock_timestamp()+interval '65 minutes' AS "end"`,
    );
    const now = clock.rows[0];
    if (now === undefined) throw new Error("Upgrade DB clock missing");
    const created = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "New native event",
        dueAt: now.due.toISOString(),
        endAt: now.end.toISOString(),
        authoredTimeZone: "UTC",
        reminderTimeZone: "UTC",
        reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
      },
      signal(),
    );
    if (!created.ok) throw created.error;
    const [intent] = await h.db
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, created.value.id));
    if (intent === undefined) throw new Error("Upgraded native intent missing");
    expect(
      (await processActivityReminder(h.db, created.value.id, intent.generationId, signal())).state,
    ).toBe("delivered");
    expect(
      (await processActivityReminder(h.db, created.value.id, intent.generationId, signal())).state,
    ).toBe("completed");
    const receipt = await h.db.select().from(activityReminderIntents);
    const ledgerBeforeSecond = await ledger(h);
    expect(await applyMigrations(h.db, signal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    const ledgerAfterSecond = await ledger(h);
    expect(ledgerAfterSecond).toEqual(ledgerBeforeSecond);
    expect(await h.db.select().from(activityReminderIntents)).toEqual(receipt);
    expect(await h.db.select().from(notifications)).toHaveLength(2);
  } finally {
    await candidate.dispose();
    await h.close();
  }
});
