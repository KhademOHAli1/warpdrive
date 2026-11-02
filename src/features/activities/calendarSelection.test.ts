import { expect, it } from "vitest";
import { calendarSelection, selectionBounds, selectionMinute } from "./calendarSelection";

it("snaps a pointer to quarter hours and clamps it inside the day", () => {
  expect(selectionMinute(444, 0)).toBe(555);
  expect(selectionMinute(-100, 0)).toBe(0);
  expect(selectionMinute(2000, 0)).toBe(1425);
});
it("supports upward selection and an inclusive final quarter-hour cell", () => {
  expect(selectionBounds(600, 555)).toEqual({ start: 555, end: 615 });
});
it("preserves an explicit midnight endpoint on the following civil day", () => {
  expect(calendarSelection("2027-03-20", 1425, 1440)).toEqual({
    date: "2027-03-20",
    time: "23:45",
    endDate: "2027-03-21",
    endTime: "00:00",
  });
});
