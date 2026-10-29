// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { selectWindow } from "@/features/activities/calendarView";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarClient } from "./CalendarClient";

afterEach(cleanup);

it("renders and pages a Persian month while carrying Gregorian anchor dates in links", () => {
  const dayIsos = selectWindow("month", "2026-03-21", {
    locale: "fa",
    calendar: "persian",
  }).days.map((day) => day.toISOString().slice(0, 10));
  render(
    <LocaleProvider locale="fa">
      <CalendarClient view="month" anchorIso="2026-03-21" dayIsos={dayIsos} activities={[]} />
    </LocaleProvider>,
  );
  expect(screen.getByText("فروردین ۱۴۰۵")).toBeInTheDocument();
  expect(screen.getByRole("grid", { name: "ماه" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("شنبه");
  expect(screen.getByTestId("cell-2026-03-21")).toHaveAttribute("data-adjacent", "false");
  expect(within(screen.getByTestId("cell-2026-03-21")).getByRole("link")).toHaveAccessibleName(
    "شنبه، ۱ فروردین ۱۴۰۵",
  );
  expect(screen.getByTestId("cell-2026-04-21")).toHaveAttribute("data-adjacent", "true");
  expect(screen.getByRole("link", { name: "بازهٔ بعد" })).toHaveAttribute(
    "href",
    "/activities/calendar?view=month&d=2026-04-21",
  );
});
