import { expect, it } from "vitest";
import {
  calendarReschedulePatch,
  calendarScheduleMatches,
  calendarScheduleSnapshot,
} from "./calendarReschedulePlan";
import {
  type CalendarScheduleSnapshot,
  calendarRescheduleEnvelopeV1,
} from "./calendarRescheduleSchemas";

const timed: CalendarScheduleSnapshot = {
  dueAt: "2026-10-25T01:30:29.123Z",
  endAt: "2026-10-25T02:45:29.456Z",
  allDay: false,
  dueDate: null,
  endDate: null,
  durationMinutes: 76,
};

it("keeps a repeated-hour offset and timestamp precision when the visible start is unchanged", () => {
  expect(
    calendarReschedulePatch(timed, { date: "2026-10-25", time: "02:30" }, "Europe/Berlin"),
  ).toBeNull();
  expect(calendarReschedulePatch(timed, { date: "2026-10-25" }, "Europe/Berlin")).toBeNull();
});

it("moves a timed event to the chosen minute while preserving its exact elapsed endpoint", () => {
  const patch = calendarReschedulePatch(
    timed,
    { date: "2026-10-26", time: "09:15" },
    "Europe/Berlin",
  );
  expect(patch).toMatchObject({
    dueAt: "2026-10-26T08:15:00.000Z",
    endAt: "2026-10-26T09:30:00.333Z",
    allDay: false,
    dueDate: null,
    endDate: null,
  });
  expect(patch).not.toHaveProperty("durationMinutes");
});

it("date-only moves preserve local time precision across an offset change", () => {
  const source = { ...timed, dueAt: "2026-10-24T00:30:29.123Z", endAt: "2026-10-24T01:45:29.456Z" };
  expect(calendarReschedulePatch(source, { date: "2026-10-26" }, "Europe/Berlin")).toMatchObject({
    dueAt: "2026-10-26T01:30:29.123Z",
    endAt: "2026-10-26T02:45:29.456Z",
  });
});

it.each([null, 60])(
  "preserves a missing explicit endpoint for point/duration-only events (%s minutes)",
  (durationMinutes) => {
    const patch = calendarReschedulePatch(
      { ...timed, endAt: null, durationMinutes },
      { date: "2026-10-26", time: "09:00" },
      "UTC",
    );
    expect(patch).toMatchObject({ dueAt: "2026-10-26T09:00:00.000Z", endAt: null });
    expect(patch).not.toHaveProperty("durationMinutes");
  },
);

it("rejects a nonexistent DST wall time and an impossible civil date", () => {
  expect(() =>
    calendarReschedulePatch(timed, { date: "2027-03-28", time: "02:30" }, "Europe/Berlin"),
  ).toThrow(RangeError);
  expect(() => calendarReschedulePatch(timed, { date: "2027-02-30" }, "UTC")).toThrow(RangeError);
});

it("resizes a start to the earlier fold while preserving the opposite instant and its milliseconds", () => {
  expect(
    calendarReschedulePatch(
      timed,
      { edge: "start", date: "2026-10-25", time: "02:15" },
      "Europe/Berlin",
    ),
  ).toEqual({
    dueAt: "2026-10-25T00:15:00.000Z",
    endAt: timed.endAt,
    allDay: false,
    durationMinutes: 151,
    authoredTimeZone: "Europe/Berlin",
  });
  expect(
    calendarReschedulePatch(
      timed,
      { edge: "start", date: "2026-10-25", time: "02:30" },
      "Europe/Berlin",
    ),
  ).toBeNull();
});

it("resizes an end without writing the exact original start again", () => {
  expect(
    calendarReschedulePatch(
      timed,
      { edge: "end", date: "2026-10-25", time: "03:30" },
      "Europe/Berlin",
    ),
  ).toEqual({
    endAt: "2026-10-25T02:30:00.000Z",
    durationMinutes: 60,
    authoredTimeZone: "Europe/Berlin",
  });
});

it("materializes a legacy duration endpoint exactly and lets a point gain only an end", () => {
  const source = { ...timed, endAt: null, durationMinutes: 60 };
  expect(
    calendarReschedulePatch(source, { edge: "start", date: "2026-10-25", time: "01:15" }, "UTC"),
  ).toMatchObject({ dueAt: "2026-10-25T01:15:00.000Z", endAt: "2026-10-25T02:30:29.123Z" });
  const point = { ...source, durationMinutes: null };
  expect(() =>
    calendarReschedulePatch(point, { edge: "start", date: "2026-10-25", time: "01:30" }, "UTC"),
  ).toThrow(RangeError);
  expect(
    calendarReschedulePatch(point, { edge: "end", date: "2026-10-25", time: "02:00" }, "UTC"),
  ).toMatchObject({ endAt: "2026-10-25T02:00:00.000Z", durationMinutes: 30 });
});

it("rejects a crossed endpoint, DST gap, and attempts to resize all-day events", () => {
  expect(() =>
    calendarReschedulePatch(timed, { edge: "end", date: "2026-10-25", time: "01:30" }, "UTC"),
  ).toThrow(RangeError);
  expect(() =>
    calendarReschedulePatch(
      timed,
      { edge: "end", date: "2027-03-28", time: "02:30" },
      "Europe/Berlin",
    ),
  ).toThrow(RangeError);
  expect(() =>
    calendarReschedulePatch(
      { ...timed, allDay: true },
      { edge: "end", date: "2026-10-25", time: "04:00" },
      "UTC",
    ),
  ).toThrow(RangeError);
});

it("shifts an all-day inclusive civil span across DST without converting event kind", () => {
  const source = {
    ...timed,
    dueAt: "2026-03-27T23:00:00.000Z",
    endAt: "2026-03-29T22:00:00.000Z",
    allDay: true,
    dueDate: "2026-03-28",
    endDate: "2026-03-30",
    durationMinutes: 2820,
  };
  const patch = calendarReschedulePatch(source, { date: "2026-04-01" }, "Europe/Berlin");
  expect(patch).toEqual({
    dueAt: "2026-03-31T22:00:00.000Z",
    endAt: "2026-04-02T22:00:00.000Z",
    allDay: true,
    dueDate: "2026-04-01",
    endDate: "2026-04-03",
    authoredTimeZone: "Europe/Berlin",
  });
  expect(() =>
    calendarReschedulePatch(source, { date: "2026-04-01", time: "09:00" }, "Europe/Berlin"),
  ).toThrow(RangeError);
});

it("establishes canonical dates on an actual legacy all-day move and preserves a missing end", () => {
  const source = {
    ...timed,
    dueAt: "2026-11-04T20:30:00.000Z",
    endAt: null,
    allDay: true,
    durationMinutes: null,
  };
  expect(calendarReschedulePatch(source, { date: "2026-11-05" }, "Asia/Tehran")).toBeNull();
  expect(calendarReschedulePatch(source, { date: "2026-11-06" }, "Asia/Tehran")).toEqual({
    dueAt: "2026-11-05T20:30:00.000Z",
    endAt: null,
    allDay: true,
    dueDate: "2026-11-06",
    endDate: null,
    authoredTimeZone: "Asia/Tehran",
  });
});

it("normalizes client Date objects and compares every source timing field", () => {
  expect(
    calendarScheduleSnapshot({
      ...timed,
      dueAt: new Date(timed.dueAt),
      endAt: new Date(timed.endAt ?? ""),
    }),
  ).toEqual(timed);
  expect(calendarScheduleMatches({ ...timed, dueAt: new Date(timed.dueAt) }, timed)).toBe(true);
  expect(calendarScheduleMatches({ ...timed, dueAt: null }, timed)).toBe(false);
  const changed: CalendarScheduleSnapshot[] = [
    { ...timed, dueAt: "2026-10-25T00:30:29.123Z" },
    { ...timed, endAt: null },
    { ...timed, allDay: true },
    { ...timed, dueDate: "2026-10-25" },
    { ...timed, endDate: "2026-10-26" },
    { ...timed, durationMinutes: 75 },
  ];
  for (const source of changed) expect(calendarScheduleMatches(source, timed)).toBe(false);
});

it("accepts only strict actor-bound temporal move envelopes", () => {
  const envelope = {
    v: 1,
    expectedActorId: "00000000-0000-4000-8000-000000000001",
    activity: {
      id: "00000000-0000-4000-8000-000000000002",
      expected: timed,
      timeZone: "Asia/Tehran",
      target: { date: "2026-11-05", time: "09:15" },
    },
  };
  expect(calendarRescheduleEnvelopeV1.safeParse(envelope).success).toBe(true);
  for (const target of [
    { ...envelope.activity.target, edge: "end" },
    { undo: timed, token: "a".repeat(43) },
  ]) {
    expect(
      calendarRescheduleEnvelopeV1.safeParse({
        ...envelope,
        activity: { ...envelope.activity, target },
      }).success,
    ).toBe(true);
  }
  for (const activity of [
    { ...envelope.activity, subject: "Forged replacement" },
    { ...envelope.activity, timeZone: "+03:30" },
    { ...envelope.activity, target: { date: "2026-11-05", time: "24:00" } },
    { ...envelope.activity, target: { date: "2026-11-05", time: "09:16", edge: "end" } },
    { ...envelope.activity, target: { undo: timed, token: "invalid" } },
    {
      ...envelope.activity,
      target: { undo: { ...timed, subject: "Forge" }, token: "a".repeat(43) },
    },
    { ...envelope.activity, expected: { dueAt: timed.dueAt } },
  ])
    expect(calendarRescheduleEnvelopeV1.safeParse({ ...envelope, activity }).success).toBe(false);
});
