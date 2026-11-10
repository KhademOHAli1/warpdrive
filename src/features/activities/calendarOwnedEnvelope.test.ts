import { expect, it } from "vitest";
import { calendarCreateEnvelopeV1 } from "./calendarNativeSchemas";

const id = "11111111-1111-4111-8111-111111111111";
const activity = { typeId: id, subject: "Calendar-owned event", authoredTimeZone: "UTC" };
const envelope = { v: 1, expectedActorId: id };

it("admits explicitly chosen calendar reminders through the current native actor envelope", () => {
  expect(
    calendarCreateEnvelopeV1.safeParse({
      ...envelope,
      activity: {
        ...activity,
        calendarId: id,
        personalReminders: { expectedRevision: 0, selection: { useDefault: true } },
      },
    }).success,
  ).toBe(true);
});

it("requires one explicit reminder owner and preserves strict native envelopes", () => {
  expect(calendarCreateEnvelopeV1.safeParse({ ...envelope, activity }).success).toBe(false);
  expect(
    calendarCreateEnvelopeV1.safeParse({
      ...envelope,
      activity: {
        ...activity,
        calendarId: id,
      },
    }).success,
  ).toBe(false);
  expect(
    calendarCreateEnvelopeV1.safeParse({
      ...envelope,
      activity: {
        ...activity,
        calendarId: id,
        reminder: { kind: "none" },
        personalReminders: { expectedRevision: 0, selection: { useDefault: true } },
      },
    }).success,
  ).toBe(false);
});
