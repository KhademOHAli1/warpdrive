// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarActivity } from "@/features/activities/calendar";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { useRecordPreview } from "@/features/navigation/recordPreviewStore";
import { AgendaList, agendaDay } from "./AgendaList";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useRecordPreview.getState().clearPreview();
});

function activity(
  subject: string,
  at: string,
  overrides?: Partial<CalendarActivity>,
): CalendarActivity {
  return {
    id: subject,
    subject,
    dueAt: new Date(at),
    allDay: false,
    durationMinutes: null,
    typeKey: "call",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
    ...overrides,
  };
}

function renderDay(activities: CalendarActivity[], onOpenActivity = vi.fn()) {
  render(
    <LocaleProvider timeZone="Europe/Berlin">
      <AgendaList
        dateIso="2026-07-15"
        activities={activities}
        empty={<p>Nothing scheduled</p>}
        onOpenActivity={onOpenActivity}
      />
    </LocaleProvider>,
  );
  return onOpenActivity;
}

it("lists the selected local day's all-day and timed events in order, including a continuation", () => {
  const morning = activity("Morning call", "2026-07-15T07:00:00Z", { overdue: true });
  const afternoon = activity("Afternoon call", "2026-07-15T14:00:00Z", {
    dealId: "123",
    dealTitle: "Contract renewal",
  });
  const open = renderDay([
    afternoon,
    activity("Next day", "2026-07-15T22:00:00Z"),
    activity("Office closed", "2026-07-16T00:00:00Z", {
      allDay: true,
      dueDate: "2026-07-15",
    }),
    morning,
    activity("Overnight work", "2026-07-14T21:15:00Z", {
      endAt: new Date("2026-07-14T23:30:00Z"),
    }),
    activity("Ends at midnight", "2026-07-14T21:00:00Z", {
      endAt: new Date("2026-07-14T22:00:00Z"),
    }),
  ]);

  const rows = screen.getAllByRole("button");
  expect(rows.map((row) => row.dataset.calendarEventId)).toEqual([
    "Office closed",
    "Overnight work",
    "Morning call",
    "Afternoon call",
  ]);
  expect(rows[0]).toHaveAccessibleName("All day Office closed");
  expect(rows[1]).toHaveAccessibleName("00:00 Overnight work");
  expect(rows[2]).toHaveAccessibleName("09:00 Morning call");
  expect(rows[3]).toHaveAccessibleName("16:00 Afternoon call Contract renewal");
  fireEvent.click(screen.getByRole("button", { name: /Morning call/ }));
  expect(open).toHaveBeenCalledWith(morning);
  fireEvent.click(screen.getByRole("button", { name: /Afternoon call/ }));
  expect(push).toHaveBeenCalledWith("/deals/123");
  expect(useRecordPreview.getState().preview?.title).toBe("Contract renewal");
});

it("shows the supplied empty state when returned activities do not occupy the selected day", () => {
  renderDay([
    activity("Ends at midnight", "2026-07-14T21:00:00Z", {
      endAt: new Date("2026-07-14T22:00:00Z"),
    }),
  ]);
  expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
});

it("excludes an event that ends as a day with no local midnight begins", () => {
  const a = activity("Ends at the clock change", "2018-11-04T02:00:00Z", {
    endAt: new Date("2018-11-04T03:00:00Z"),
  });
  const { from, items } = agendaDay([a], "2018-11-04", "America/Sao_Paulo");
  expect(from.toISOString()).toBe("2018-11-04T03:00:00.000Z");
  expect(items).toHaveLength(0);
});
