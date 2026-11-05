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
  for (const activity of [
    { ...envelope.activity, subject: "Forged replacement" },
    { ...envelope.activity, timeZone: "+03:30" },
    { ...envelope.activity, target: { date: "2026-11-05", time: "24:00" } },
    { ...envelope.activity, expected: { dueAt: timed.dueAt } },
  ])
    expect(calendarRescheduleEnvelopeV1.safeParse({ ...envelope, activity }).success).toBe(false);
});
