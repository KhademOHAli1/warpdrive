// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarActivity } from "@/features/activities/calendar";
import { monthGridDays } from "@/features/activities/monthGrid";
import { CalendarClient } from "./CalendarClient";
import { MonthView } from "./MonthView";

afterEach(cleanup);

const dayIsos = monthGridDays(new Date("2026-06-15T00:00:00Z")).map((d) =>
  d.toISOString().slice(0, 10),
);

function mk(id: string, dueIso: string, over = false): CalendarActivity {
  return {
    id,
    subject: id,
    dueAt: new Date(dueIso),
    allDay: false,
    durationMinutes: null,
    typeKey: "meeting",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: over,
    ownerName: null,
  };
}

it("renders a 42-cell month grid", () => {
  render(
    <MonthView anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} todayIso="2026-06-15" />,
  );
  expect(screen.getAllByRole("gridcell")).toHaveLength(42);
});

it("groups cells into rows so the ARIA grid is well-formed (header + 6 weeks)", () => {
  render(
    <MonthView anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} todayIso="2026-06-15" />,
  );
  // A valid grid is grid > row > gridcell. 1 weekday-header row + 6 week rows = 7.
  expect(screen.getAllByRole("row")).toHaveLength(7);
});

it("shows +N more linking to the day view when a cell exceeds 3 activities", () => {
  const acts = ["a", "b", "c", "d", "e"].map((id) => mk(id, "2026-06-15T10:00:00Z"));
  render(
    <MonthView anchorIso="2026-06-15" dayIsos={dayIsos} activities={acts} todayIso="2026-06-01" />,
  );
  const more = screen.getByRole("link", { name: /\+2 more/ });
  expect(more).toHaveAttribute("href", "/activities/calendar?view=day&d=2026-06-15");
});

it("de-emphasizes adjacent-month cells and marks today", () => {
  render(
    <MonthView anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} todayIso="2026-06-15" />,
  );
  // Leading cell June 1 is in-month; a trailing July cell is adjacent-month.
  const julyCell = screen.getByTestId("cell-2026-07-01");
  expect(julyCell).toHaveAttribute("data-adjacent", "true");
  const todayCell = screen.getByTestId("cell-2026-06-15");
  expect(todayCell).toHaveAttribute("data-today", "true");
});

it("toggle + prev/next/today render as links carrying the right params", () => {
  render(<CalendarClient view="month" anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} />);
  expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=week&d=2026-06-15",
  );
  expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2026-05-15",
  );
  expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2026-07-15",
  );
  expect(screen.getByText("June 2026")).toBeInTheDocument();
  for (const [name, view] of [
    ["Day", "day"],
    ["Month", "month"],
    ["Year", "year"],
  ]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute(
      "href",
      `/activities/calendar?view=${view}&d=2026-06-15`,
    );
  }
  expect(screen.queryByRole("combobox", { name: "Calendar system" })).not.toBeInTheDocument();
});

it("keeps a blank year navigable with all twelve months", () => {
  render(
    <CalendarClient
      view="year"
      anchorIso="2026-06-15"
      dayIsos={[]}
      activities={[]}
      empty={<p>Nothing scheduled</p>}
    />,
  );
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2026");
  expect(screen.getAllByRole("table")).toHaveLength(12);
  expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=year&d=2025-06-15",
  );
  expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=year&d=2027-06-15",
  );
  expect(screen.getByRole("link", { name: "Year" })).toHaveAttribute("aria-current", "page");
});

// An empty week rendered as a blank grid with no message at all.
it("shows the caller's empty state only while the window holds nothing", () => {
  const empty = <p>Nothing scheduled</p>;
  const { rerender } = render(
    <CalendarClient
      view="month"
      anchorIso="2026-06-15"
      dayIsos={dayIsos}
      activities={[]}
      empty={empty}
    />,
  );
  expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();

  rerender(
    <CalendarClient
      view="month"
      anchorIso="2026-06-15"
      dayIsos={dayIsos}
      activities={[mk("a", "2026-06-15T10:00:00Z")]}
      empty={empty}
    />,
  );
  expect(screen.queryByText("Nothing scheduled")).toBeNull();
});

it("renders the month grid when view=month (durability: same as a reloaded URL)", () => {
  render(<CalendarClient view="month" anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} />);
  expect(screen.getAllByRole("gridcell")).toHaveLength(42);
});

it("uses the supplied request date for a deterministic first-render Today link", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(
    <CalendarClient
      view="month"
      anchorIso="2026-06-15"
      dayIsos={dayIsos}
      activities={[]}
      initialTodayIso="2026-01-03"
    />,
  );
  expect(html).toContain('href="/activities/calendar?view=month&amp;d=2026-01-03"');
});

it("draws the header label and the adjacent-month tone from theme tokens", () => {
  render(<CalendarClient view="month" anchorIso="2026-06-15" dayIsos={dayIsos} activities={[]} />);
  expect(screen.getByText("June 2026")).toHaveClass("text-foreground");
  // An adjacent month is de-emphasised by lowering the token's alpha, not by reaching for a
  // lighter fixed gray, so the cell follows Night with everything else.
  const julyCell = screen.getByTestId("cell-2026-07-01");
  expect(julyCell).toHaveClass("bg-muted/50", "text-foreground/60");
  expect(julyCell.className).not.toMatch(/-gray-/);
});

vi.mock("@/features/activities/useCalendarReschedule", () => ({
  useCalendarReschedule: () => ({
    pending: false,
    error: null,
    notice: null,
    canMove: true,
    move: vi.fn(),
    clearFeedback: vi.fn(),
  }),
}));
