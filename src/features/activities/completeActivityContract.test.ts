import { expect, test } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activityCompleteInput } from "./schemas";

const ID = "11111111-1111-4111-8111-111111111111";
// Keep this regression runnable before the canonical registry entry is reconciled.
const registry: Readonly<Record<string, string>> = ERROR_IDS;

test("retains the canonical completion-input error ID", () => {
  expect(registry.ACTIVITY_COMPLETE_INPUT_INVALID).toBe("E_ACTIVITY_008");
});

test("appends a distinct conflict ID without reusing the completion-input ID", () => {
  expect(registry.ACTIVITY_CONFLICT).toBe("E_ACTIVITY_012");
  expect(registry.ACTIVITY_CONFLICT).not.toBe(registry.ACTIVITY_COMPLETE_INPUT_INVALID);
});

test.each([true, false])("accepts the legacy completion shape for done=%s", (done) => {
  expect(activityCompleteInput.parse({ id: ID, done })).toEqual({ id: ID, done });
});

test.each([1, 7])("accepts an explicit positive integer revision %s", (expectedVersion) => {
  const input = { id: ID, done: true, expectedVersion };
  expect(activityCompleteInput.parse(input)).toEqual(input);
});

test.each([0, -1, 1.5, "1", null, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects an invalid completion revision %s without coercion",
  (expectedVersion) => {
    expect(activityCompleteInput.safeParse({ id: ID, done: true, expectedVersion }).success).toBe(
      false,
    );
  },
);

test.each([
  { extra: true },
  { actorId: ID },
  { version: 1 },
  { expectedUpdatedAt: "2026-11-01T08:00:00Z" },
])("rejects unknown completion keys instead of stripping them: %j", (extra) => {
  expect(
    activityCompleteInput.safeParse({ id: ID, done: true, expectedVersion: 3, ...extra }).success,
  ).toBe(false);
});
