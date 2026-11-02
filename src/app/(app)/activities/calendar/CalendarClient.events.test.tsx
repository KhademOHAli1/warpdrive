// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { monthGridDays } from "@/features/activities/monthGrid";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarClient } from "./CalendarClient";

vi.mock("@/features/activities/CalendarEventDialog", () => ({
  CalendarEventDialog: ({ defaultDate, onSaved }: { defaultDate: string; onSaved: () => void }) => (
    <div role="dialog" aria-label="Event fixture">
      <p>{defaultDate}</p>
      <button type="button" onClick={onSaved}>
        Save fixture
      </button>
    </div>
  ),
}));
vi.mock("@/features/activities/CalendarEventEditDialog", () => ({
  CalendarEventEditDialog: ({ id }: { id: string }) => (
    <div role="dialog" aria-label="Edit fixture">
      {id}
    </div>
  ),
}));
vi.mock("./WeekAgendaGrid", () => ({ WeekAgendaGrid: () => null }));
afterEach(cleanup);

const days = monthGridDays(new Date("2027-03-21T00:00:00Z")).map((date) =>
  date.toISOString().slice(0, 10),
);

it("opens the creation workflow even when a filtered calendar is empty", () => {
  render(
    <CalendarClient
      view="month"
      anchorIso="2027-03-21"
      dayIsos={days}
      activities={[]}
      empty={<p>No matching events</p>}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "New event" }));
  expect(screen.getByRole("dialog", { name: "Event fixture" })).toBeInTheDocument();
});

it("seeds the canonical civil date from a Persian month cell and refreshes after save", () => {
  const onChanged = vi.fn();
  render(
    <LocaleProvider locale="fa" calendar="persian">
      <CalendarClient
        view="month"
        anchorIso="2027-03-21"
        dayIsos={days}
        activities={[]}
        onChanged={onChanged}
      />
    </LocaleProvider>,
  );
  fireEvent.click(
    within(screen.getByTestId("cell-2027-03-21")).getByRole("button", { name: /ایجاد رویداد/ }),
  );
  expect(screen.getByRole("dialog", { name: "Event fixture" })).toHaveTextContent("2027-03-21");
  fireEvent.click(screen.getByRole("button", { name: "Save fixture" }));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("opens a standalone month event for editing while keeping CRM record links", () => {
  const base = {
    dueAt: new Date("2027-03-21T09:00:00Z"),
    allDay: false,
    durationMinutes: 60,
    typeKey: "meeting",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
  };
  render(
    <CalendarClient
      view="month"
      anchorIso="2027-03-21"
      dayIsos={days}
      activities={[
        { ...base, id: "standalone", subject: "Local meeting" },
        {
          ...base,
          id: "linked",
          subject: "Deal meeting",
          dealId: "crm-deal",
          dealTitle: "Customer opportunity",
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: /Deal meeting/ })).toHaveAttribute(
    "href",
    "/deals/crm-deal",
  );
  fireEvent.click(screen.getByRole("button", { name: "Local meeting" }));
  expect(screen.getByRole("dialog", { name: "Edit fixture" })).toHaveTextContent("standalone");
});
