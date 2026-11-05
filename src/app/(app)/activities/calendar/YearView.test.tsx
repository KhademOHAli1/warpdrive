// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CalendarActivity } from "@/features/activities/calendar";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { YearView } from "./YearView";

afterEach(cleanup);

it("shows each day of a leap year once and links into month and day views", () => {
  render(<YearView anchorIso="2024-11-05" activities={[]} todayIso="2024-02-29" />);
  expect(screen.getAllByRole("table")).toHaveLength(12);
  const dayLinks = screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.includes("view=day") === true);
  expect(dayLinks).toHaveLength(366);
  expect(new Set(dayLinks.map((link) => link.getAttribute("href"))).size).toBe(366);
  expect(screen.getByRole("link", { name: "February 2024" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2024-02-01",
  );
  expect(screen.getByRole("link", { current: "date" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=day&d=2024-02-29",
  );
});

it("marks activities on their account-zone date and canonical all-day dates", () => {
  const base: CalendarActivity = {
    id: "timed",
    subject: "Late meeting",
    dueAt: new Date("2026-12-31T23:30:00Z"),
    allDay: false,
    durationMinutes: 30,
    typeKey: "meeting",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
  };
  render(
    <LocaleProvider timeZone="Europe/Berlin">
      <YearView
        anchorIso="2027-01-01"
        activities={[
          base,
          { ...base, id: "offsite", allDay: true, dueDate: "2027-01-02", endDate: "2027-01-03" },
        ]}
        todayIso="2027-01-01"
      />
    </LocaleProvider>,
  );
  const january = screen.getByRole("table", { name: "January 2027" });
  for (const [day, label] of [
    [1, "Friday 1 January 2027"],
    [2, "Saturday 2 January 2027"],
    [3, "Sunday 3 January 2027"],
  ] as const) {
    expect(within(january).getByRole("link", { name: `${label}: 1 activity` })).toHaveAttribute(
      "href",
      `/activities/calendar?view=day&d=2027-01-0${day}`,
    );
  }
});

it("renders the Persian year from Nowruz with Farsi month/day labels", () => {
  render(
    <LocaleProvider locale="fa" calendar="persian">
      <YearView anchorIso="2026-11-05" activities={[]} todayIso="2026-03-21" />
    </LocaleProvider>,
  );
  expect(screen.getAllByRole("table")).toHaveLength(12);
  expect(screen.getByRole("link", { name: "فروردین ۱۴۰۵" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2026-03-21",
  );
  expect(screen.getByRole("link", { name: "اسفند ۱۴۰۵" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2027-02-20",
  );
  expect(screen.getByRole("link", { current: "date" })).toHaveTextContent("۱");
  expect(screen.getByRole("link", { current: "date" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=day&d=2026-03-21",
  );
  expect(
    screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("view=day") === true),
  ).toHaveLength(365);
});
