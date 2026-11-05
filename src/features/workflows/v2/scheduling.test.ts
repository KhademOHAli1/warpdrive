import { expect, it } from "vitest";
import { scheduleMatches } from "./scheduling";

it("matches cron in the configured zone and conventional constrained day OR semantics", () => {
  expect(
    scheduleMatches(
      { cron: "0 9 * * *", timeZone: "Europe/Berlin" },
      new Date("2026-11-05T08:00:00Z"),
    ),
  ).toBe(true);
  expect(
    scheduleMatches(
      { cron: "0 9 * * *", timeZone: "Europe/Berlin" },
      new Date("2026-11-05T09:00:00Z"),
    ),
  ).toBe(false);
  expect(
    scheduleMatches({ cron: "0 9 1 * 4", timeZone: "UTC" }, new Date("2026-11-05T09:00:00Z")),
  ).toBe(true);
  expect(scheduleMatches({ cron: "* * * * *", timeZone: "Invalid/Zone" }, new Date())).toBe(false);
});
it("rejects invalid bounds/zero steps and admits interval minute slots", () => {
  expect(scheduleMatches({ cron: "*/0 * * * *" }, new Date())).toBe(false);
  expect(scheduleMatches({ cron: "80 * * * *" }, new Date())).toBe(false);
  expect(
    scheduleMatches({ mode: "interval", intervalMinutes: 15 }, new Date("2026-11-05T12:15:20Z")),
  ).toBe(true);
  expect(
    scheduleMatches({ mode: "interval", intervalMinutes: 15 }, new Date("2026-11-05T12:16:00Z")),
  ).toBe(false);
});
