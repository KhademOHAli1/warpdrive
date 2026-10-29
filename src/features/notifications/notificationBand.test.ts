import { expect, it } from "vitest";
import { notificationBand } from "./notificationBand";

it("uses the recipient's civil day at Tehran midnight and Nowruz", () => {
  const now = new Date("2026-03-20T21:00:00Z");
  const previous = new Date("2026-03-20T20:00:00Z");
  expect(notificationBand(previous, now, "Asia/Tehran")).toBe("earlier");
  expect(notificationBand(previous, now, "UTC")).toBe("today");
  expect(notificationBand(new Date("2026-03-20T20:45:00Z"), now, "Asia/Tehran")).toBe("today");
});

it("keeps one local day together when UTC has already crossed midnight", () => {
  const now = new Date("2026-03-21T02:00:00Z");
  const previous = new Date("2026-03-20T23:00:00Z");
  expect(notificationBand(previous, now, "America/New_York")).toBe("today");
  expect(notificationBand(previous, now)).toBe("earlier");
});
