// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createPortal as renderPortal } from "react-dom";
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
vi.mock("@/features/activities/CalendarEventEditDialog", () => ({
  CalendarEventEditDialog: () => null,
}));
vi.mock("@/features/activities/FollowUpActivityDialog", () => ({
  FollowUpActivityDialog: () => null,
}));

interface FixtureDialogProps {
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
}

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
    }: FixtureDialogProps) {
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

describe("week portal shortcut containment", () => {
  const view = "week";
  const days = week;
  const slotDate = "2027-03-24";
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

function guardCalendar(content: ReactNode, overlay?: ReactNode) {
  render(
    <>
      <LocaleProvider locale="en" calendar="gregory" timeZone="Asia/Tehran">
        <CalendarClient
          view="week"
          anchorIso={anchor}
          initialTodayIso={anchor}
          dayIsos={week}
          activities={[]}
          empty={content}
        />
      </LocaleProvider>
      {overlay}
    </>,
  );
  const region = screen.getByRole("region", { name: "Calendar" });
  const target = screen.getByTestId("shortcut-target");
  expect(region.contains(target)).toBe(true);
  target.focus();
  expect(target).toHaveFocus();
  return { region, target };
}

function expectShortcutIgnored(target: HTMLElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "c",
    code: "KeyC",
    ...init,
  });
  if (init.isComposing === true) expect(event.isComposing).toBe(true);
  if (init.keyCode === 229) expect(event.keyCode).toBe(229);
  if (init.shiftKey === true) expect(event.shiftKey).toBe(true);
  fireEvent(target, event);
  expect(
    screen.queryByRole("dialog", { name: "Calendar creation fixture" }),
  ).not.toBeInTheDocument();
  expect(target).toHaveFocus();
}

describe("shared shortcut admission inside the calendar", () => {
  it.each(["textbox", "searchbox", "spinbutton"] as const)(
    "keeps C in a rendered role=%s editing context",
    (role) => {
      const { target } = guardCalendar(
        <div role={role} tabIndex={0} data-testid="shortcut-target">
          Typing draft
        </div>,
      );
      expectShortcutIgnored(target);
    },
  );

  it("keeps C in an empty contenteditable host", () => {
    const { target } = guardCalendar(
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The ref installs the exact empty contenteditable attribute under test.
        tabIndex={0}
        data-testid="shortcut-target"
        ref={(node) => {
          node?.setAttribute("contenteditable", "");
        }}
      >
        Typing draft
      </div>,
    );
    expect(target).toHaveAttribute("contenteditable", "");
    expectShortcutIgnored(target);
  });

  it.each([
    { name: "Shift+C", event: { key: "C", shiftKey: true } },
    { name: "IME composition", event: { isComposing: true } },
    { name: "legacy IME keyCode229", event: { keyCode: 229 } },
  ])("ignores $name on a focused calendar button", ({ event }) => {
    const { target } = guardCalendar(
      <button type="button" data-testid="shortcut-target">
        Calendar action
      </button>,
    );
    expectShortcutIgnored(target, event);
  });

  it("ignores C inside the calendar while a floating overlay is open elsewhere", () => {
    const { region, target } = guardCalendar(
      <button type="button" data-testid="shortcut-target">
        Calendar action
      </button>,
      renderPortal(
        <div data-radix-popper-content-wrapper>
          <div role="menu" aria-label="Floating overlay">
            Overlay actions
          </div>
        </div>,
        document.body,
      ),
    );
    expect(region.contains(screen.getByRole("menu", { name: "Floating overlay" }))).toBe(false);
    expectShortcutIgnored(target);
  });
});
