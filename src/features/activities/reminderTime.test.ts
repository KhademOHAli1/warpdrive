import { expect, test } from "vitest";
import {
  activityReminderJobV1,
  activityReminderSelectionV1,
  activityReminderTimeZone,
  legacyActivityReminderNudge,
} from "./reminderIntentTypes";
import { type ActivityReminderTimeSnapshot, resolveActivityReminderTime } from "./reminderTime";

const timed: ActivityReminderTimeSnapshot = {
  dueAt: "2026-11-02T10:00:00.123Z",
  allDay: false,
  dueDate: null,
  reminderTimeZone: "Europe/Berlin",
};
const before = { kind: "before_start", channel: "in_app", leadMinutes: 10 } as const;
const civil = { kind: "all_day_at", channel: "in_app", localTime: "09:00" } as const;
function allDay(date: string): ActivityReminderTimeSnapshot {
  return { ...timed, allDay: true, dueDate: date, dueAt: "2000-01-01T00:00:00.000Z" };
}

test("explicit none has no fire instant and never invents an unknown legacy zone", () => {
  expect(
    resolveActivityReminderTime({ ...timed, reminderTimeZone: null }, { kind: "none" }),
  ).toEqual({ ok: true, fireAt: null, ambiguous: false });
});
test("timed lead uses the exact stored instant and retains its milliseconds", () => {
  expect(resolveActivityReminderTime(timed, before)).toEqual({
    ok: true,
    fireAt: "2026-11-02T09:50:00.123Z",
    ambiguous: false,
  });
});
test("an existing later fold occurrence is never reconstructed as the earlier one", () => {
  expect(
    resolveActivityReminderTime({ ...timed, dueAt: "2026-10-25T01:30:00.456Z" }, before),
  ).toEqual({ ok: true, fireAt: "2026-10-25T01:20:00.456Z", ambiguous: false });
});
test.each([
  ["2026-03-28", "2026-03-28T08:00:00.000Z"],
  ["2026-03-29", "2026-03-29T07:00:00.000Z"],
  ["2026-10-24", "2026-10-24T07:00:00.000Z"],
  ["2026-10-25", "2026-10-25T08:00:00.000Z"],
])("all-day %s uses its authored civil date/clock through Berlin DST", (date, fireAt) => {
  expect(resolveActivityReminderTime(allDay(date), civil)).toEqual({
    ok: true,
    fireAt,
    ambiguous: false,
  });
});
test("a selected all-day clock in a DST gap is rejected rather than shifted", () => {
  expect(
    resolveActivityReminderTime(allDay("2026-03-29"), { ...civil, localTime: "02:30" }),
  ).toEqual({ ok: false, issue: "invalid_wall_time" });
});
test("a newly selected all-day folded clock uses the project earlier-occurrence policy", () => {
  expect(
    resolveActivityReminderTime(allDay("2026-10-25"), { ...civil, localTime: "02:30" }),
  ).toEqual({ ok: true, fireAt: "2026-10-25T00:30:00.000Z", ambiguous: true });
});
test.each([null, "Not/A_Zone"])("enabled reminders require an explicit valid zone (%s)", (zone) => {
  expect(resolveActivityReminderTime({ ...timed, reminderTimeZone: zone }, before)).toEqual({
    ok: false,
    issue: zone === null ? "missing_time_zone" : "invalid_time_zone",
  });
});
test("fixed offsets are not accepted as an authored IANA zone", () => {
  expect(activityReminderTimeZone.safeParse("+02:00").success).toBe(false);
});
test("all-day reminders require a real canonical civil date, not a compatibility anchor", () => {
  expect(resolveActivityReminderTime({ ...allDay("2026-04-31"), dueDate: null }, civil)).toEqual({
    ok: false,
    issue: "missing_start",
  });
  expect(resolveActivityReminderTime(allDay("2026-04-31"), civil)).toEqual({
    ok: false,
    issue: "invalid_civil_date",
  });
});
test("event-kind mismatches cannot silently change reminder meaning", () => {
  expect(resolveActivityReminderTime(allDay("2026-11-02"), before)).toEqual({
    ok: false,
    issue: "wrong_event_kind",
  });
  expect(resolveActivityReminderTime(timed, civil)).toEqual({
    ok: false,
    issue: "wrong_event_kind",
  });
});
test("a missing or invalid timed start is not a successful reminder", () => {
  expect(resolveActivityReminderTime({ ...timed, dueAt: null }, before)).toEqual({
    ok: false,
    issue: "missing_start",
  });
  expect(resolveActivityReminderTime({ ...timed, dueAt: new Date(Number.NaN) }, before)).toEqual({
    ok: false,
    issue: "invalid_start",
  });
});
test("a past authored fire time remains intent, without using the application clock to send", () => {
  expect(
    resolveActivityReminderTime({ ...timed, dueAt: "2000-01-01T10:00:00.000Z" }, before),
  ).toEqual({ ok: true, fireAt: "2000-01-01T09:50:00.000Z", ambiguous: false });
});
test("V1 selection rejects email, unknown leads and invalid civil clocks", () => {
  expect(activityReminderSelectionV1.safeParse({ ...before, channel: "email" }).success).toBe(
    false,
  );
  expect(activityReminderSelectionV1.safeParse({ ...before, leadMinutes: 5 }).success).toBe(false);
  expect(activityReminderSelectionV1.safeParse({ ...civil, localTime: "24:00" }).success).toBe(
    false,
  );
  expect(activityReminderSelectionV1.safeParse({ kind: "none", email: true }).success).toBe(false);
});
test("versioned jobs cannot be mistaken for a legacy nudge", () => {
  const activityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const job = { v: 1, activityId, generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  expect(activityReminderJobV1.safeParse(job).success).toBe(true);
  expect(legacyActivityReminderNudge.safeParse(job).success).toBe(false);
  expect(activityReminderJobV1.safeParse({ ...job, v: 2 }).success).toBe(false);
  expect(legacyActivityReminderNudge.safeParse({ activityId }).success).toBe(true);
});
