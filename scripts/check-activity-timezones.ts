// Run with Bun from the repository root. All writes target session-local TEMP clones,
// which drop at transaction completion. No public rows or queues are mutated.
// LIKE copies columns/checks/defaults/indexes, but PostgreSQL does not copy foreign keys.
import { getTableName, sql } from "drizzle-orm";
import { type Db, db, pool } from "@/db/client";
import {
  activities,
  activityGuests,
  activityParticipants,
  activityTypes,
  customFieldDefs,
  userPreferences,
} from "@/db/schema";
import { listActivityRows } from "@/features/activities/activityRows";
import { updateActivity } from "@/features/activities/activityUpdate";
import { getBusyWindows } from "@/features/activities/availability";
import { calendarRange } from "@/features/activities/calendar";
import { getDayLoad } from "@/features/activities/dayLoad";
import { getActivityForEdit } from "@/features/activities/getForEdit";
import { createActivity } from "@/features/activities/repo";
import { civilDateRange } from "@/lib/zonedDateTime";

const actor = {
  id: crypto.randomUUID(),
  type: "admin" as const,
  isActive: true,
  groupIds: new Set<string>(),
  flags: new Set<never>(),
};
const signal = AbortSignal.timeout(45000);
let checks = 0;
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
  checks++;
}
try {
  await db.transaction(async (tx) => {
    for (const table of [
      activities,
      activityTypes,
      activityGuests,
      activityParticipants,
      customFieldDefs,
      userPreferences,
    ]) {
      const name = getTableName(table);
      await tx.execute(
        sql.raw(`CREATE TEMP TABLE "${name}" (LIKE public."${name}" INCLUDING ALL) ON COMMIT DROP`),
      );
    }
    await tx.insert(userPreferences).values({ userId: actor.id, timezone: "Asia/Tehran" });
    const [type] = await tx
      .insert(activityTypes)
      .values({ key: "temporal_fixture", name: "Temporal fixture" })
      .returning();
    if (!type) throw new Error("type missing");
    const isolated = tx as unknown as Db;
    const made = await createActivity(
      isolated,
      actor,
      {
        typeId: type.id,
        subject: "Civil fixture",
        dueAt: "2026-03-20T20:30:00.000Z",
        allDay: true,
        dueDate: "2026-03-21",
        endAt: "2026-03-21T20:30:00.000Z",
        endDate: "2026-03-22",
      },
      signal,
    );
    check(made.ok, "create failed");
    if (!made.ok) throw made.error;
    check(
      made.value.dueDate === "2026-03-21" && made.value.endDate === "2026-03-22",
      "canonical dates not stored",
    );
    check(made.value.dueAt?.toISOString() === "2026-03-20T20:30:00.000Z", "create changed anchor");
    const edit = await getActivityForEdit(isolated, actor, made.value.id, signal);
    check(edit.ok && edit.value.dueDate === "2026-03-21", "edit DTO missing civil date");
    const range = civilDateRange("2026-03-21", "2026-03-22", "Asia/Tehran");
    const rows = await listActivityRows(
      isolated,
      actor,
      { ownerId: null, done: "all", from: "2026-03-21", to: "2026-03-21", typeKey: null },
      signal,
      undefined,
      "Asia/Tehran",
    );
    check(rows.length === 1 && rows[0]?.dueDate === "2026-03-21", "list civil date mismatch");
    const calendar = await calendarRange(isolated, actor, range, signal, "Asia/Tehran");
    check(
      calendar.length === 1 && calendar[0]?.endDate === "2026-03-22",
      "calendar civil date mismatch",
    );
    const counts = await getDayLoad(
      isolated,
      { userId: actor.id, ...range, timeZone: "Asia/Tehran" },
      signal,
    );
    check(counts["2026-03-21"] === 1, "dayLoad civil date mismatch");
    const busy = await getBusyWindows(
      isolated,
      {
        userId: actor.id,
        ...civilDateRange("2026-03-22", "2026-03-23", "Asia/Tehran"),
        timeZone: "Asia/Tehran",
      },
      signal,
    );
    check(
      busy.length === 1 && busy[0]?.end.toISOString() === "2026-03-22T20:30:00.000Z",
      "all-day full-span busy mismatch",
    );
    const [legacy] = await tx
      .insert(activities)
      .values({
        typeId: type.id,
        subject: "Legacy fixture",
        ownerId: actor.id,
        assigneeId: actor.id,
        dueAt: new Date("2026-03-20T20:30Z"),
        allDay: true,
      })
      .returning();
    if (!legacy) throw new Error("legacy missing");
    const unchanged = await updateActivity(
      isolated,
      actor,
      { id: legacy.id, subject: "Legacy renamed" },
      signal,
    );
    check(
      unchanged.ok &&
        unchanged.value.dueDate === null &&
        unchanged.value.dueAt?.toISOString() === "2026-03-20T20:30:00.000Z",
      "legacy backfilled on unrelated edit",
    );
    const changed = await updateActivity(
      isolated,
      actor,
      { id: legacy.id, dueAt: "2026-03-21T20:30:00.000Z", allDay: true, dueDate: "2026-03-22" },
      signal,
    );
    check(changed.ok && changed.value.dueDate === "2026-03-22", "date edit not canonical");
    const [timed] = await tx
      .insert(activities)
      .values({
        typeId: type.id,
        subject: "Timed fixture",
        ownerId: actor.id,
        assigneeId: actor.id,
        dueAt: new Date("2026-10-25T01:30:24.123Z"),
        allDay: false,
        durationMinutes: 37,
      })
      .returning();
    if (!timed) throw new Error("timed missing");
    const preserved = await updateActivity(
      isolated,
      actor,
      { id: timed.id, subject: "Timed renamed" },
      signal,
    );
    check(
      preserved.ok &&
        preserved.value.dueAt?.toISOString() === "2026-10-25T01:30:24.123Z" &&
        preserved.value.durationMinutes === 37 &&
        preserved.value.allDay === false,
      "timed instant/duration changed",
    );
    const invalid = await updateActivity(
      isolated,
      actor,
      { id: made.value.id, dueDate: "2026-03-23", endDate: "2026-03-22" },
      signal,
    );
    check(!invalid.ok, "reversed canonical dates were accepted");
    const inferred = await createActivity(
      isolated,
      actor,
      {
        typeId: type.id,
        subject: "New date inferred from account zone",
        dueAt: "2026-03-20T20:30:00.000Z",
        allDay: true,
      },
      signal,
    );
    check(
      inferred.ok && inferred.value.dueDate === "2026-03-21",
      "new legacy-client write did not establish a canonical account date",
    );
    const midnight = await createActivity(
      isolated,
      actor,
      {
        typeId: type.id,
        subject: "Deliberate midnight",
        dueAt: "2026-03-20T20:30:00.000Z",
        allDay: false,
      },
      signal,
    );
    check(
      midnight.ok && !midnight.value.allDay && midnight.value.dueDate === null,
      "midnight was reclassified as all-day",
    );
  });
  process.stdout.write(
    `${checks} real repository PostgreSQL checks passed using only session-local TEMP fixtures. No public user rows mutated; temporary tables dropped at commit.\n`,
  );
} finally {
  await pool.end();
}
