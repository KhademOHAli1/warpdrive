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
vi.mock("@/features/activities/CalendarEventEditDialog", () => ({
  CalendarEventEditDialog: () => null,
}));
afterEach(cleanup);

describe.each([
  {
    locale: "fa",
    week: "هفته",
    month: "ماه",
    name: "تقویم",
    previous: "بازهٔ قبل",
    next: "بازهٔ بعد",
    create: "رویداد جدید",
  },
  {
    locale: "de",
    week: "Woche",
    month: "Monat",
    name: "Kalender",
    previous: "Vorheriger Zeitraum",
    next: "Nächster Zeitraum",
    create: "Neuer Termin",
  },
  {
    locale: "en",
    week: "Week",
    month: "Month",
    name: "Calendar",
    previous: "Previous",
    next: "Next",
    create: "New event",
  },
] as const)(
  "canonical navigation in $locale",
  ({ locale, week, month, name, previous, next, create }) => {
    it("preserves week/month links, seven-day navigation and the explicit creation action", () => {
      render(
        <LocaleProvider locale={locale} calendar="gregory" timeZone="Asia/Tehran">
          <CalendarClient
            view="week"
            anchorIso="2027-03-22"
            initialTodayIso="2027-03-22"
            dayIsos={["2027-03-22"]}
            activities={[]}
          />
        </LocaleProvider>,
      );
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: week })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: month })).toHaveAttribute(
        "href",
        "/activities/calendar?view=month&d=2027-03-22",
      );
      expect(screen.getByRole("link", { name: previous })).toHaveAttribute(
        "href",
        "/activities/calendar?view=week&d=2027-03-15",
      );
      expect(screen.getByRole("link", { name: next })).toHaveAttribute(
        "href",
        "/activities/calendar?view=week&d=2027-03-29",
      );
      expect(screen.getByTestId("agenda")).toHaveTextContent("2027-03-22");
      fireEvent.click(screen.getByRole("button", { name: create }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  },
);
