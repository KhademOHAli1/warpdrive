import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { rescheduleCalendarEvent } from "./calendarReschedule";
import { calendarScheduleSnapshot } from "./calendarReschedulePlan";
import type {
  CalendarRescheduleInput,
  CalendarRescheduleValue,
  CalendarScheduleSnapshot,
} from "./calendarRescheduleSchemas";
import { signCalendarUndo } from "./calendarRescheduleUndo";
import { createActivity } from "./repo";

const {
  activities,
  activityTypes,
  activityGuests,
  activityParticipants,
  activityReminderIntents,
  persons,
} = schema;
let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

function actor(id: string, type: PermSetUser["type"] = "admin"): PermSetUser {
  return { id, type, isActive: true, groupIds: new Set(), flags: new Set() };
}
async function fixture(allDay = false) {
  const user = await seedUser(h.db, { isAdmin: true });
  const participant = await seedUser(h.db);
  const [person] = await h.db
    .insert(persons)
    .values({ name: "Preserved calendar contact", ownerId: user.id, visibilityLevel: "all" })
    .returning();
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined || person === undefined) throw new Error("Calendar move fixture missing");
  const created = await createActivity(
    h.db,
    actor(user.id),
    {
      subject: "Preserve details when moving",
      typeId: type.id,
      dueAt: allDay ? "2027-03-26T23:00:00.000Z" : "2027-03-27T08:15:29.123Z",
      endAt: allDay ? "2027-03-28T22:00:00.000Z" : "2027-03-27T09:30:29.456Z",
      durationMinutes: allDay ? 2820 : 76,
      allDay,
      dueDate: allDay ? "2027-03-27" : null,
      endDate: allDay ? "2027-03-29" : null,
      personId: person.id,
      guestPersonIds: [person.id],
      participantUserIds: [participant.id],
      priority: "high",
      location: "Berlin / تهران",
      note: "<p>Keep the original note</p>",
      videoCallUrl: "https://meet.example.org/preserved",
      authoredTimeZone: "Europe/Berlin",
      reminderTimeZone: "Europe/Berlin",
      reminder: allDay
        ? { kind: "all_day_at", channel: "in_app", localTime: "09:00" }
        : { kind: "before_start", channel: "in_app", leadMinutes: 10 },
    },
    signal(),
  );
  if (!created.ok) throw created.error;
  const [withFields] = await h.db
    .update(activities)
    .set({ customFields: { importedReference: "retain me" } })
    .where(eq(activities.id, created.value.id))
    .returning();
  if (withFields?.dueAt == null) throw new Error("Calendar event date missing");
  return {
    actor: actor(user.id),
    user,
    participant,
    activity: withFields,
    expected: calendarScheduleSnapshot({ ...withFields, dueAt: withFields.dueAt }),
  };
}
async function reminder(id: string) {
  const [row] = await h.db
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, id));
  if (row === undefined) throw new Error("Calendar reminder missing");
  return row;
}
async function row(id: string) {
  const [current] = await h.db.select().from(activities).where(eq(activities.id, id));
  if (current === undefined) throw new Error("Calendar activity missing");
  return current;
}
function input(
  f: Awaited<ReturnType<typeof fixture>>,
  target: CalendarRescheduleInput["target"],
): CalendarRescheduleInput {
  return { id: f.activity.id, expected: f.expected, timeZone: "Europe/Berlin", target };
}

const undoSessionId = "00000000-0000-4000-8000-000000000001";
function undoInput(
  f: Awaited<ReturnType<typeof fixture>>,
  acknowledged: CalendarRescheduleValue,
  original: CalendarScheduleSnapshot = f.expected,
): CalendarRescheduleInput {
  const expected = calendarScheduleSnapshot(acknowledged);
  const timeZone = "Europe/Berlin";
  const token = signCalendarUndo({
    actorId: f.actor.id,
    sessionId: undoSessionId,
    id: f.activity.id,
    timeZone,
    expected,
    original,
  });
  return { id: f.activity.id, expected, timeZone, target: { undo: original, token } };
}

it("moves only temporal fields, returns persisted timing and reschedules the current reminder", async () => {
  const f = await fixture();
  const beforeIntent = await reminder(f.activity.id);
  const beforeGuests = await h.db
    .select()
    .from(activityGuests)
    .where(eq(activityGuests.activityId, f.activity.id));
  const beforeParticipants = await h.db
    .select()
    .from(activityParticipants)
    .where(eq(activityParticipants.activityId, f.activity.id));
  const moved = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    input(f, { date: "2027-03-28", time: "09:15" }),
    signal(),
  );
  expect(moved).toEqual({
    ok: true,
    value: {
      id: f.activity.id,
      dueAt: "2027-03-28T07:15:00.000Z",
      endAt: "2027-03-28T08:30:00.333Z",
      durationMinutes: 76,
      allDay: false,
      dueDate: null,
      endDate: null,
    },
  });
  const after = await row(f.activity.id);
  expect(after).toEqual({
    ...f.activity,
    version: f.activity.version + 1,
    reminderAuthoredAt: expect.any(Date),
    dueAt: new Date("2027-03-28T07:15:00.000Z"),
    endAt: new Date("2027-03-28T08:30:00.333Z"),
    updatedAt: expect.any(Date),
  });
  expect(
    await h.db.select().from(activityGuests).where(eq(activityGuests.activityId, f.activity.id)),
  ).toEqual(beforeGuests);
  expect(
    await h.db
      .select()
      .from(activityParticipants)
      .where(eq(activityParticipants.activityId, f.activity.id)),
  ).toEqual(beforeParticipants);
  const afterIntent = await reminder(f.activity.id);
  expect(afterIntent.selection).toEqual(beforeIntent.selection);
  expect(afterIntent.reminderTimeZone).toBe(beforeIntent.reminderTimeZone);
  expect(afterIntent.eventTimeZone).toBe("Europe/Berlin");
  expect(afterIntent.generationId).not.toBe(beforeIntent.generationId);
  expect(afterIntent.fireAt?.toISOString()).toBe("2027-03-28T07:05:00.000Z");
});

it("moves an all-day event by its inclusive civil span across a DST boundary", async () => {
  const f = await fixture(true);
  const moved = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    input(f, { date: "2027-04-01" }),
    signal(),
  );
  expect(moved).toEqual({
    ok: true,
    value: {
      id: f.activity.id,
      dueAt: "2027-03-31T22:00:00.000Z",
      endAt: "2027-04-02T22:00:00.000Z",
      durationMinutes: 2820,
      allDay: true,
      dueDate: "2027-04-01",
      endDate: "2027-04-03",
    },
  });
  expect((await reminder(f.activity.id)).fireAt?.toISOString()).toBe("2027-04-01T07:00:00.000Z");
});

it("preserves point and duration-only representations on a date-only move", async () => {
  const f = await fixture();
  for (const durationMinutes of [null, 60]) {
    const [current] = await h.db
      .update(activities)
      .set({ dueAt: new Date("2027-03-27T08:15:29.123Z"), endAt: null, durationMinutes })
      .where(eq(activities.id, f.activity.id))
      .returning();
    if (current?.dueAt == null) throw new Error("Calendar fixture lost date");
    const moved = await rescheduleCalendarEvent(
      h.db,
      f.actor,
      {
        ...input(f, { date: "2027-03-28" }),
        expected: calendarScheduleSnapshot({ ...current, dueAt: current.dueAt }),
      },
      signal(),
    );
    expect(moved).toMatchObject({
      ok: true,
      value: { dueAt: "2027-03-28T07:15:29.123Z", endAt: null, durationMinutes },
    });
  }
});

it("undoes to the exact later-fold instant and legacy duration representation, rebuilding reminders", async () => {
  const f = await fixture();
  const original = {
    ...f.expected,
    dueAt: "2027-10-31T01:30:29.123Z",
    endAt: null,
    durationMinutes: 60,
  };
  await h.db
    .update(activities)
    .set({ dueAt: new Date(original.dueAt), endAt: null, durationMinutes: 60 })
    .where(eq(activities.id, f.activity.id));
  const moved = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    {
      ...input(f, { date: "2027-11-01", time: "09:00" }),
      expected: original,
    },
    signal(),
  );
  if (!moved.ok) throw moved.error;
  const movedReminder = await reminder(f.activity.id);
  const undo = undoInput(f, moved.value, original);
  expect(await rescheduleCalendarEvent(h.db, f.actor, undo, signal(), undoSessionId)).toEqual({
    ok: true,
    value: { id: f.activity.id, ...original },
  });
  const restoredReminder = await reminder(f.activity.id);
  expect(restoredReminder.selection).toEqual(movedReminder.selection);
  expect(restoredReminder.generationId).not.toBe(movedReminder.generationId);
  expect(restoredReminder.fireAt?.toISOString()).toBe("2027-10-31T01:20:29.123Z");
  expect(await row(f.activity.id)).toMatchObject({
    dueAt: new Date(original.dueAt),
    endAt: null,
    durationMinutes: 60,
  });
});

it("restores null legacy all-day civil columns after an ordinary move canonicalizes them", async () => {
  const f = await fixture(true);
  const original = {
    ...f.expected,
    dueAt: "2027-03-26T23:27:59.125Z",
    endAt: null,
    dueDate: null,
    endDate: null,
    durationMinutes: null,
  };
  await h.db
    .update(activities)
    .set({ ...original, dueAt: new Date(original.dueAt) })
    .where(eq(activities.id, f.activity.id));
  const moved = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    {
      ...input(f, { date: "2027-04-01" }),
      expected: original,
    },
    signal(),
  );
  if (!moved.ok) throw moved.error;
  expect(moved.value.dueDate).toBe("2027-04-01");
  expect(
    await rescheduleCalendarEvent(
      h.db,
      f.actor,
      undoInput(f, moved.value, original),
      signal(),
      undoSessionId,
    ),
  ).toEqual({ ok: true, value: { id: f.activity.id, ...original } });
  expect(await row(f.activity.id)).toMatchObject({ ...original, dueAt: new Date(original.dueAt) });
});

it("resizes a stored endpoint, preserves the other exactly and supports undoing the resize", async () => {
  const f = await fixture();
  const resized = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    input(f, { edge: "start", date: "2027-03-27", time: "08:45" }),
    signal(),
  );
  if (!resized.ok) throw resized.error;
  expect(resized.value).toEqual({
    id: f.activity.id,
    ...f.expected,
    dueAt: "2027-03-27T07:45:00.000Z",
    durationMinutes: 106,
  });
  expect((await reminder(f.activity.id)).fireAt?.toISOString()).toBe("2027-03-27T07:35:00.000Z");
  expect(
    await rescheduleCalendarEvent(
      h.db,
      f.actor,
      undoInput(f, resized.value),
      signal(),
      undoSessionId,
    ),
  ).toEqual({ ok: true, value: { id: f.activity.id, ...f.expected } });
  expect((await reminder(f.activity.id)).fireAt?.toISOString()).toBe("2027-03-27T08:05:29.123Z");
});

it("rejects a forged undo and leaves an intervening schedule and reminder unchanged", async () => {
  const f = await fixture();
  const moved = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    input(f, { date: "2027-04-01", time: "09:00" }),
    signal(),
  );
  if (!moved.ok) throw moved.error;
  const undo = undoInput(f, moved.value);
  expect(await rescheduleCalendarEvent(h.db, f.actor, undo, signal(), f.actor.id)).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID },
  });
  const next = await rescheduleCalendarEvent(
    h.db,
    f.actor,
    {
      ...input(f, { edge: "end", date: "2027-04-01", time: "11:30" }),
      expected: undo.expected,
    },
    signal(),
  );
  if (!next.ok) throw next.error;
  const after = await row(f.activity.id);
  const afterReminder = await reminder(f.activity.id);
  expect(await rescheduleCalendarEvent(h.db, f.actor, undo, signal(), undoSessionId)).toMatchObject(
    {
      ok: false,
      error: { id: ERROR_IDS.ACTIVITY_SCHEDULE_STALE },
    },
  );
  expect(await row(f.activity.id)).toEqual(after);
  expect(await reminder(f.activity.id)).toEqual(afterReminder);
});

it("denies a visible but non-editable event and hides an invisible event before comparing stale timing", async () => {
  const f = await fixture();
  const outsider = await seedUser(h.db);
  const beforeIntent = await reminder(f.activity.id);
  const denied = await rescheduleCalendarEvent(
    h.db,
    actor(outsider.id, "regular"),
    input(f, { date: "2027-04-01" }),
    signal(),
  );
  expect(denied).toMatchObject({ ok: false, error: { id: ERROR_IDS.ACTIVITY_FORBIDDEN } });
  if (f.activity.personId === null) throw new Error("Missing fixture contact");
  await h.db
    .update(persons)
    .set({ visibilityLevel: "owner" })
    .where(eq(persons.id, f.activity.personId));
  const hidden = await rescheduleCalendarEvent(
    h.db,
    actor(outsider.id, "regular"),
    { ...input(f, { date: "2027-04-01" }), expected: { ...f.expected, durationMinutes: 999 } },
    signal(),
  );
  expect(hidden).toMatchObject({ ok: false, error: { id: ERROR_IDS.ACTIVITY_NOT_FOUND } });
  expect(await row(f.activity.id)).toEqual(f.activity);
  expect(await reminder(f.activity.id)).toEqual(beforeIntent);
});

it("rejects a DST-gap target without changing activity or reminder state", async () => {
  const f = await fixture();
  const before = await reminder(f.activity.id);
  expect(
    await rescheduleCalendarEvent(
      h.db,
      f.actor,
      input(f, { date: "2027-03-28", time: "02:30" }),
      signal(),
    ),
  ).toMatchObject({ ok: false, error: { id: ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID } });
  expect(await row(f.activity.id)).toEqual(f.activity);
  expect(await reminder(f.activity.id)).toEqual(before);
});

it("leaves a no-op move and its reminder generation unchanged", async () => {
  const f = await fixture();
  const before = await reminder(f.activity.id);
  expect(
    await rescheduleCalendarEvent(
      h.db,
      f.actor,
      input(f, { date: "2027-03-27", time: "09:15" }),
      signal(),
    ),
  ).toEqual({ ok: true, value: { id: f.activity.id, ...f.expected } });
  expect(await row(f.activity.id)).toEqual(f.activity);
  expect(await reminder(f.activity.id)).toEqual(before);
});

async function waitForActivityLock(waiter: number, blocker: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await h.pool.query<{ waiting: boolean }>(
      "SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS waiting",
      [waiter, blocker],
    );
    if (result.rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Owned reschedule activity-lock waiter not observed");
}

it("compares source timing after the actual row lock wait and never overwrites the winning writer", async () => {
  const f = await fixture();
  const beforeIntent = await reminder(f.activity.id);
  const blocker = await h.pool.connect();
  const client = await h.pool.connect();
  const commandDb = drizzle(client, { schema });
  let pending: ReturnType<typeof rescheduleCalendarEvent> | undefined;
  try {
    await blocker.query("BEGIN");
    const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
      .rows[0]?.pid;
    const commandPid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
      .rows[0]?.pid;
    if (blockerPid === undefined || commandPid === undefined)
      throw new Error("Owned backend PID missing");
    // An independently held writer makes the displayed source stale while the
    // drag waits. This is a race fixture, not a claimed native-writer lifecycle.
    await blocker.query("UPDATE activities SET due_at=$1, end_at=$2 WHERE id=$3", [
      "2027-03-29T08:00:00Z",
      "2027-03-29T09:15:00Z",
      f.activity.id,
    ]);
    pending = rescheduleCalendarEvent(
      commandDb,
      f.actor,
      input(f, { date: "2027-04-01", time: "10:00" }),
      signal(),
    );
    const observed = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waitForActivityLock(commandPid, blockerPid);
    await blocker.query("COMMIT");
    const outcome = await observed;
    if ("error" in outcome) throw outcome.error;
    expect(outcome.value).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.ACTIVITY_SCHEDULE_STALE },
    });
    expect((await row(f.activity.id)).dueAt?.toISOString()).toBe("2027-03-29T08:00:00.000Z");
    expect(await reminder(f.activity.id)).toEqual(beforeIntent);
  } finally {
    await blocker.query("ROLLBACK");
    if (pending !== undefined) await Promise.allSettled([pending]);
    await client.query("ROLLBACK");
    blocker.release();
    client.release();
  }
});

it("allows only one of two concurrent drops using the same displayed source", async () => {
  const f = await fixture();
  const results = await Promise.all(
    ["2027-04-01", "2027-04-02"].map((date) =>
      rescheduleCalendarEvent(h.db, f.actor, input(f, { date, time: "10:00" }), signal()),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(
    results.filter((result) => !result.ok && result.error.id === ERROR_IDS.ACTIVITY_SCHEDULE_STALE),
  ).toHaveLength(1);
  const winner = results.find((result) => result.ok);
  expect(winner?.ok && winner.value.dueAt).toBe((await row(f.activity.id)).dueAt?.toISOString());
});
