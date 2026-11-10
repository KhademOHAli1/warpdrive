import { expect, it } from "vitest";
import { activityCreateInput, activityUpdateInput } from "./schemas";

const id = "00000000-0000-4000-8000-000000000001";
it("validates event zones and revision tokens at the action boundary", () => {
  expect(
    activityCreateInput.safeParse({ typeId: id, subject: "Termin", eventTimeZone: "Not/A_Zone" })
      .success,
  ).toBe(false);
  expect(activityUpdateInput.safeParse({ id, subject: "Termin", expectedVersion: 0 }).success).toBe(
    false,
  );
  expect(activityUpdateInput.safeParse({ id, expectedVersion: 1 }).success).toBe(false);
  expect(
    activityUpdateInput.parse({
      id,
      subject: "Termin",
      expectedVersion: 2,
      eventTimeZone: "Asia/Tehran",
    }),
  ).toMatchObject({ expectedVersion: 2, eventTimeZone: "Asia/Tehran" });
});
