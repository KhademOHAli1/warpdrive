import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_RULES,
  planReminders,
  reminderDefaultsSchema,
  reminderSelectionSchema,
} from "./reminderPolicy";

const timed = {
  dueAt: new Date("2027-03-21T05:30:00.000Z"),
  allDay: false,
  dueDate: null,
  timeZone: "Asia/Tehran",
};
it("groups notification and email at the same instant and retains multiple lead times", () => {
  const rules = {
    ...DEFAULT_REMINDER_RULES,
    timed: [
      { method: "notification" as const, minutesBefore: 10 },
      { method: "email" as const, minutesBefore: 10 },
      { method: "notification" as const, minutesBefore: 60 },
    ],
  };
  expect(planReminders(timed, rules)).toEqual([
    { fireAt: new Date("2027-03-21T04:30:00Z"), inApp: true, email: false },
    { fireAt: new Date("2027-03-21T05:20:00Z"), inApp: true, email: true },
  ]);
});
it("calculates all-day reminders from canonical Iranian-authored civil date, not its compatibility anchor", () => {
  expect(
    planReminders(
      { ...timed, allDay: true, dueDate: "2027-03-21", dueAt: new Date("2027-03-20T12:00Z") },
      {
        timed: [],
        allDay: [
          { method: "notification", daysBefore: 0, time: "09:00" },
          { method: "email", daysBefore: 1, time: "14:30" },
        ],
      },
    ),
  ).toEqual([
    { fireAt: new Date("2027-03-20T11:00Z"), inApp: false, email: true },
    { fireAt: new Date("2027-03-21T05:30Z"), inApp: true, email: false },
  ]);
});
it("subtracts calendar days across DST and uses forward-gap/earlier-fold disambiguation", () => {
  const event = { ...timed, allDay: true, timeZone: "Europe/Berlin", dueDate: "2027-03-29" };
  expect(
    planReminders(event, {
      timed: [],
      allDay: [{ method: "notification", daysBefore: 1, time: "02:30" }],
    })[0]?.fireAt.toISOString(),
  ).toBe("2027-03-28T01:30:00.000Z");
  expect(
    planReminders(
      { ...event, dueDate: "2027-11-01" },
      { timed: [], allDay: [{ method: "email", daysBefore: 1, time: "02:30" }] },
    )[0]?.fireAt.toISOString(),
  ).toBe("2027-10-31T00:30:00.000Z");
});
it("supports explicit none, start-time reminders and independent timed/all-day rules", () => {
  expect(reminderSelectionSchema.parse({ useDefault: false, timed: [], allDay: [] })).toEqual({
    useDefault: false,
    timed: [],
    allDay: [],
  });
  expect(
    planReminders(timed, {
      timed: [],
      allDay: [{ method: "email", daysBefore: 0, time: "09:00" }],
    }),
  ).toEqual([]);
  expect(
    planReminders(timed, { timed: [{ method: "notification", minutesBefore: 0 }], allDay: [] })[0]
      ?.fireAt,
  ).toEqual(timed.dueAt);
  expect(planReminders({ ...timed, dueAt: null }, DEFAULT_REMINDER_RULES)).toEqual([]);
});

describe("reminder boundary", () => {
  it.each([
    { timed: [{ method: "sms", minutesBefore: 10 }], allDay: [] },
    { timed: [{ method: "email", minutesBefore: -1 }], allDay: [] },
    { timed: [{ method: "email", minutesBefore: 40321 }], allDay: [] },
    { timed: [{ method: "email", minutesBefore: 1.5 }], allDay: [] },
    {
      timed: Array.from({ length: 6 }, (_, i) => ({ method: "email", minutesBefore: i })),
      allDay: [],
    },
    {
      timed: [
        { method: "email", minutesBefore: 10 },
        { method: "email", minutesBefore: 10 },
      ],
      allDay: [],
    },
    { timed: [], allDay: [{ method: "email", daysBefore: 29, time: "09:00" }] },
    { timed: [], allDay: [{ method: "email", daysBefore: 0, time: "24:00" }] },
    { timed: [], allDay: [{ method: "email", daysBefore: 0, time: "۹:۰۰" }] },
  ])("rejects invalid or duplicate rules: %j", (raw) => {
    expect(reminderDefaultsSchema.safeParse(raw).success).toBe(false);
  });
  it("keeps inheritance distinct from custom empty rules and rejects another recipient", () => {
    expect(reminderSelectionSchema.safeParse({ useDefault: true }).success).toBe(true);
    expect(
      reminderSelectionSchema.safeParse({ useDefault: true, userId: "not-owned" }).success,
    ).toBe(false);
  });
});
