import { expect, it } from "vitest";
import {
  calendarCreateEnvelopeV1,
  calendarEditEnvelopeV1,
  calendarReadEnvelopeV1,
} from "./calendarNativeSchemas";

const actor = { v: 1, expectedActorId: "00000000-0000-4000-8000-000000000001" };
const activity = {
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Event",
  authoredTimeZone: "Europe/Berlin",
  reminder: { kind: "none" },
};
it("requires the explicit reminder choice and actual IANA zone for a new native event", () => {
  expect(calendarCreateEnvelopeV1.safeParse({ ...actor, activity }).success).toBe(true);
  expect(
    calendarCreateEnvelopeV1.safeParse({ ...actor, activity: { ...activity, reminder: undefined } })
      .success,
  ).toBe(false);
  expect(
    calendarCreateEnvelopeV1.safeParse({
      ...actor,
      activity: { ...activity, authoredTimeZone: "+03:00" },
    }).success,
  ).toBe(false);
  expect(
    calendarCreateEnvelopeV1.safeParse({
      ...actor,
      activity: {
        ...activity,
        reminder: { kind: "before_start", channel: "email", leadMinutes: 10 },
      },
    }).success,
  ).toBe(false);
});
it("does not accept a future protocol, extra identity or the old unwrapped body", () => {
  expect(calendarCreateEnvelopeV1.safeParse({ ...actor, v: 2, activity }).success).toBe(false);
  expect(
    calendarCreateEnvelopeV1.safeParse({ ...actor, sessionId: actor.expectedActorId, activity })
      .success,
  ).toBe(false);
  expect(calendarCreateEnvelopeV1.safeParse(activity).success).toBe(false);
});
it("requires the current reminder precondition on every native edit but not a new selection on title-only edits", () => {
  const patch = { id: activity.typeId, subject: "Title only" };
  expect(calendarEditEnvelopeV1.safeParse({ ...actor, activity: patch }).success).toBe(false);
  expect(
    calendarEditEnvelopeV1.safeParse({
      ...actor,
      activity: { ...patch, expectedReminderGeneration: null },
    }).success,
  ).toBe(true);
  expect(
    calendarEditEnvelopeV1.safeParse({
      ...actor,
      activity: { id: patch.id, expectedReminderGeneration: null },
    }).success,
  ).toBe(false);
});
it("does not weaken UUID actor or activity identity", () => {
  expect(
    calendarReadEnvelopeV1.safeParse({
      ...actor,
      expectedActorId: "account-a",
      activityId: activity.typeId,
    }).success,
  ).toBe(false);
  expect(calendarReadEnvelopeV1.safeParse({ ...actor, activityId: "event-a" }).success).toBe(false);
});
