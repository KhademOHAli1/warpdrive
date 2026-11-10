// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type * as DialogModule from "@/components/ui/dialog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { CalendarClient } from "./CalendarClient";

const api = vi.hoisted(() => ({
  createCalendarEventAction: vi.fn(),
  editCalendarEventAction: vi.fn(),
  completeCalendarEventAction: vi.fn(),
  deleteCalendarEventAction: vi.fn(),
  readCalendarEventAction: vi.fn(),
  retryCalendarReminderAction: vi.fn(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  saveLocalePreferencesAction: vi.fn(),
  closeAutoFocus: vi.fn(),
}));

vi.mock("@/features/activities/calendarNativeActions", () => ({
  createCalendarEventAction: api.createCalendarEventAction,
  editCalendarEventAction: api.editCalendarEventAction,
  completeCalendarEventAction: api.completeCalendarEventAction,
  deleteCalendarEventAction: api.deleteCalendarEventAction,
  readCalendarEventAction: api.readCalendarEventAction,
  retryCalendarReminderAction: api.retryCalendarReminderAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: api.refresh, push: api.push }),
}));
vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: api.saveLocalePreferencesAction,
}));
vi.mock("@/features/activities/useLocalNow", () => ({ useLocalNow: () => null }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/activities/calendar",
}));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({
    html,
    onChange,
    ariaLabel,
  }: {
    html: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={html}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: api.invalidate },
        listRows: { invalidate: api.invalidate },
      },
    }),
    activities: {
      listTypes: {
        useQuery: () => ({
          data: [{ id: "00000000-0000-4000-8000-000000000002", key: "meeting", name: "Meeting" }],
        }),
      },
      dayLoad: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

vi.mock("@/components/ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  const { forwardRef } = await import("react");
  return {
    ...actual,
    // Observe real Radix close-autofocus settlement without replacing its event or focus behavior.
    DialogContent: forwardRef<
      ElementRef<typeof actual.DialogContent>,
      ComponentPropsWithoutRef<typeof actual.DialogContent>
    >(function ObservedDialogContent(props, ref) {
      return (
        <actual.DialogContent
          {...props}
          ref={ref}
          onCloseAutoFocus={(event) => {
            props.onCloseAutoFocus?.(event);
            api.closeAutoFocus();
          }}
        />
      );
    }),
  };
});

const actorId = "00000000-0000-4000-8000-000000000003";
const anchor = "2027-03-22";
const slotDate = "2027-03-24";
const week = [
  anchor,
  "2027-03-23",
  slotDate,
  "2027-03-25",
  "2027-03-26",
  "2027-03-27",
  "2027-03-28",
];

function calendar(days = week) {
  return (
    <NativeActorProvider actorId={actorId}>
      <LocaleProvider locale="en" calendar="gregory" timeZone="UTC">
        <CalendarClient
          view="week"
          anchorIso={days[0] ?? anchor}
          initialTodayIso={anchor}
          dayIsos={days}
          activities={[]}
        />
      </LocaleProvider>
    </NativeActorProvider>
  );
}

function expectNoCalendarActions(): void {
  expect(api.createCalendarEventAction).not.toHaveBeenCalled();
  expect(api.editCalendarEventAction).not.toHaveBeenCalled();
  expect(api.completeCalendarEventAction).not.toHaveBeenCalled();
  expect(api.deleteCalendarEventAction).not.toHaveBeenCalled();
  expect(api.readCalendarEventAction).not.toHaveBeenCalled();
  expect(api.retryCalendarReminderAction).not.toHaveBeenCalled();
  expect(api.invalidate).not.toHaveBeenCalled();
  expect(api.refresh).not.toHaveBeenCalled();
  expect(api.push).not.toHaveBeenCalled();
  expect(api.saveLocalePreferencesAction).not.toHaveBeenCalled();
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  { entry: "C from a week slot", close: "Cancel" },
  { entry: "C from a week slot", close: "Escape" },
  { entry: "the header creation button", close: "Cancel" },
  { entry: "the header creation button", close: "Escape" },
  { entry: "a timed week slot", close: "Cancel" },
  { entry: "a timed week slot", close: "Escape" },
] as const)(
  "returns focus after $entry closes with $close and admits the next C",
  async ({ entry, close }) => {
    const user = userEvent.setup();
    render(calendar());
    const region = screen.getByRole("region", { name: "Calendar" });
    const opener = screen.getByRole("button", {
      name:
        entry === "the header creation button"
          ? "New event"
          : `Add activity on ${slotDate} at 09:00`,
    });
    opener.focus();
    expect(opener).toHaveFocus();
    await user.keyboard(entry === "C from a week slot" ? "c" : "{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "New event" });
    expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    expect(region.contains(dialog)).toBe(false);
    const title = within(dialog).getByRole("textbox", { name: "Event title" });
    expect(title).toHaveFocus();
    await user.keyboard("Authored c draft");
    expect(title).toHaveValue("Authored c draft");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    if (entry === "a timed week slot") {
      expect(within(dialog).getByRole("button", { name: "Start date" })).toHaveTextContent(
        "03/24/2027",
      );
      expect(within(dialog).getByLabelText("Start time")).toHaveValue("09:00");
    }

    if (close === "Cancel")
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    else await user.keyboard("{Escape}");
    const discard = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    await user.click(within(discard).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(api.closeAutoFocus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Assert after the actual close-autofocus event, without waiting for the desired focus outcome.
    expect(opener).toHaveFocus();
    expectNoCalendarActions();

    await user.keyboard("c");
    const nextDialog = await screen.findByRole("dialog", { name: "New event" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(nextDialog).getByRole("textbox", { name: "Event title" })).toHaveValue("");
    expect(within(nextDialog).getByRole("button", { name: "Start date" })).toHaveTextContent(
      "03/22/2027",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(api.closeAutoFocus).toHaveBeenCalledTimes(2));
    expect(opener).toHaveFocus();
    expectNoCalendarActions();
  },
);

it("does not restore focus to a week slot removed while its creation dialog is open", async () => {
  const user = userEvent.setup();
  const { rerender } = render(calendar());
  const opener = screen.getByRole("button", { name: `Add activity on ${slotDate} at 09:00` });
  opener.focus();
  await user.keyboard("c");
  const dialog = await screen.findByRole("dialog", { name: "New event" });
  expect(within(dialog).getByRole("textbox", { name: "Event title" })).toHaveFocus();
  const focus = vi.spyOn(opener, "focus");
  rerender(
    calendar([
      "2027-03-29",
      "2027-03-30",
      "2027-03-31",
      "2027-04-01",
      "2027-04-02",
      "2027-04-03",
      "2027-04-04",
    ]),
  );
  expect(opener).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(api.closeAutoFocus).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(focus).not.toHaveBeenCalled();
  expectNoCalendarActions();
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
