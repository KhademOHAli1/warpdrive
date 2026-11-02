// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarClient } from "./CalendarClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => ({}) } }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/features/activities/actions", () => ({
  createActivityAction: vi.fn(),
  completeActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
}));
vi.mock("@/features/activities/calendarActions", () => ({
  createCalendarAction: vi.fn(),
  setCalendarMemberAction: vi.fn(),
  updateCalendarAction: vi.fn(),
  setCalendarArchivedAction: vi.fn(),
}));
vi.mock("@/features/activities/reminderSettingsActions", () => ({
  setCalendarReminderDefaultsAction: vi.fn(),
  setEventReminderSettingsAction: vi.fn(),
}));

vi.mock("./WeekAgendaGrid", () => ({
  WeekAgendaGrid: ({ dayIsos }: { dayIsos: string[] }) => (
    <div data-testid="agenda">{dayIsos.join(",")}</div>
  ),
}));
vi.mock("@/features/activities/CalendarEventDialog", () => ({
  CalendarEventDialog: ({ defaultDate }: { defaultDate: string }) => (
    <div role="dialog">{defaultDate}</div>
  ),
}));
afterEach(cleanup);

describe.each([
  { locale: "fa", day: "روز", name: "تقویم" },
  { locale: "de", day: "Tag", name: "Kalender" },
  { locale: "en", day: "Day", name: "Calendar" },
] as const)("day navigation in $locale", ({ locale, day, name }) => {
  it("links to the selected day and creates from a keyboard shortcut", () => {
    render(
      <LocaleProvider locale={locale}>
        <CalendarClient
          view="day"
          anchorIso="2027-03-21"
          initialTodayIso="2027-03-21"
          dayIsos={["2027-03-21"]}
          activities={[]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: day })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("agenda")).toHaveTextContent("2027-03-21");
    fireEvent.keyDown(screen.getByRole("region", { name }), { key: "c" });
    expect(screen.getByRole("dialog")).toHaveTextContent("2027-03-21");
  });
});
