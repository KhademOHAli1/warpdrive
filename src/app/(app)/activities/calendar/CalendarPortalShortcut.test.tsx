// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventDialogProps } from "@/features/activities/useCalendarEventEditor";
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

vi.mock("@/features/activities/CalendarEventDialog", async () => {
  const { useState } = await import("react");
  const { createPortal } = await import("react-dom");
  const { Button } = await import("@/components/ui/Button");
  const { Input } = await import("@/components/ui/Input");
  return {
    CalendarEventDialog: function PortalDialogFixture({
      defaultDate = "",
      defaultTime,
      onClose,
    }: CalendarEventDialogProps) {
      const [title, setTitle] = useState("");
      const [date, setDate] = useState(defaultDate);
      const [time, setTime] = useState(defaultTime ?? "");
      // Use an actual portal, so React ancestry differs from DOM containment as in Radix.
      return createPortal(
        <dialog
          open
          aria-label={
            defaultTime === undefined ? "Calendar creation fixture" : "Slot creation fixture"
          }
        >
          <Input
            aria-label="Title draft"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Input
            aria-label="Date draft"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            aria-label="Time draft"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
        </dialog>,
        document.body,
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

const anchor = "2027-03-22";
const week = [
  anchor,
  "2027-03-23",
  "2027-03-24",
  "2027-03-25",
  "2027-03-26",
  "2027-03-27",
  "2027-03-28",
];

describe.each([
  { view: "week", days: week, slotDate: "2027-03-24" },
  { view: "day", days: [anchor], slotDate: anchor },
] as const)("$view portal shortcut containment", ({ view, days, slotDate }) => {
  function calendar() {
    render(
      <LocaleProvider locale="en" calendar="gregory" timeZone="Asia/Tehran">
        <CalendarClient
          view={view}
          anchorIso={anchor}
          initialTodayIso={anchor}
          dayIsos={[...days]}
          activities={[]}
        />
      </LocaleProvider>,
    );
    return screen.getByRole("region", { name: "Calendar" });
  }

  it("keeps one slot dialog and its date, time and draft when C bubbles from its portalled Cancel button", () => {
    const region = calendar();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Add activity on ${slotDate} at 09:00`,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Slot creation fixture" });
    const fields = within(dialog);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog.parentElement).toBe(document.body);
    expect(fields.getByRole("textbox", { name: "Date draft" })).toHaveValue(slotDate);
    expect(fields.getByRole("textbox", { name: "Time draft" })).toHaveValue("09:00");
    fireEvent.change(fields.getByRole("textbox", { name: "Title draft" }), {
      target: { value: "Keep this unsaved meeting" },
    });
    const cancel = fields.getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    expect(region.contains(cancel)).toBe(false);
    expect(
      screen.queryByRole("dialog", { name: "Calendar creation fixture" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(cancel, { key: "c", code: "KeyC" });

    // The real CalendarClient + WeekAgendaGrid must not open the parent's second creation state.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.queryByRole("dialog", { name: "Calendar creation fixture" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Slot creation fixture" })).toBe(dialog);
    expect(fields.getByRole("textbox", { name: "Title draft" })).toHaveValue(
      "Keep this unsaved meeting",
    );
    expect(fields.getByRole("textbox", { name: "Date draft" })).toHaveValue(slotDate);
    expect(fields.getByRole("textbox", { name: "Time draft" })).toHaveValue("09:00");
    expect(cancel).toHaveFocus();
  });

  it("still opens one creation dialog when C starts inside the calendar region", () => {
    const region = calendar();
    const slot = screen.getByRole("button", { name: `Add activity on ${slotDate} at 09:00` });
    expect(region.contains(slot)).toBe(true);
    slot.focus();
    expect(slot).toHaveFocus();
    fireEvent.keyDown(slot, { key: "c", code: "KeyC" });
    const dialog = screen.getByRole("dialog", { name: "Calendar creation fixture" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Slot creation fixture" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Date draft" })).toHaveValue(anchor);
    expect(within(dialog).getByRole("textbox", { name: "Time draft" })).toHaveValue("");
  });
});
