// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";

const mocks = vi.hoisted(() => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  completeActivityAction: vi.fn(),
  setEventReminderSettingsAction: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve()),
  defaults: {
    timed: [{ method: "notification" as const, minutesBefore: 10 }],
    allDay: [{ method: "notification" as const, daysBefore: 0, time: "09:00" }],
  },
}));
vi.mock("./actions", () => mocks);
vi.mock("./reminderSettingsActions", () => mocks);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({ RichTextBody: () => null }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    calendars: {
      list: {
        useQuery: () => ({
          data: [
            {
              id: "00000000-0000-4000-8000-000000000010",
              name: "Team",
              role: "owner",
              isPrimary: true,
              timeZone: "Europe/Berlin",
              personalReminders: {
                defaults: mocks.defaults,
                revision: 0,
                emailCapability: "available",
              },
            },
          ],
        }),
      },
    },
    activities: {
      listTypes: {
        useQuery: () => ({
          data: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              key: "meeting",
              name: "Meeting",
            },
          ],
        }),
      },
      dayLoad: { useQuery: () => ({ data: undefined }) },
    },
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: mocks.invalidate },
        listRows: { invalidate: mocks.invalidate },
      },
    }),
  },
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  mocks.invalidate.mockImplementation(() => Promise.resolve());
  mocks.createActivityAction.mockResolvedValue({ ok: true });
  mocks.editActivityAction.mockResolvedValue({ ok: true });
  mocks.completeActivityAction.mockResolvedValue({ ok: true, version: 5 });
  mocks.deleteActivityAction.mockResolvedValue({ ok: true });
  mocks.setEventReminderSettingsAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const stored: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Team meeting",
  priority: null,
  dueAt: "2027-03-21T08:00:00.000Z",
  endAt: null,
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: null,
  note: null,
  videoCallUrl: null,
  assigneeId: "00000000-0000-4000-8000-000000000003",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  version: 4,
  calendarId: "00000000-0000-4000-8000-000000000010",
  eventTimeZone: "Europe/Berlin",
  personalReminders: {
    selection: { useDefault: true },
    defaults: mocks.defaults,
    revision: 3,
    subscribed: true,
    emailCapability: "available",
    timeZone: "Europe/Berlin",
  },
};
function open(editing?: EditableActivity) {
  const close = vi.fn();
  render(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <CalendarEventDialog
        editing={editing}
        defaultDate="2027-03-21"
        defaultTime="09:00"
        onClose={close}
      />
    </LocaleProvider>,
  );
  return close;
}
function customize() {
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Use my calendar defaults" }));
}
function changeMinutes(value: string) {
  const minutes = screen.getByLabelText("Minutes before the event for reminder 1");
  fireEvent.change(minutes, { target: { value } });
  fireEvent.blur(minutes);
}

it("saves a collapsed explicit no-reminder override with a new event", async () => {
  open();
  fireEvent.change(screen.getByRole("textbox", { name: "Event title" }), {
    target: { value: "New" },
  });
  expect(screen.getByRole("button", { name: "Reminders" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  customize();
  fireEvent.click(screen.getByRole("button", { name: "Remove reminder 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        personalReminders: {
          selection: { useDefault: false, timed: [], allDay: mocks.defaults.allDay },
          expectedRevision: 0,
        },
      }),
      "csrf",
    ),
  );
});
it("writes only the current user's preference when shared event fields are unchanged", async () => {
  const close = open(stored);
  customize();
  changeMinutes("30");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.setEventReminderSettingsAction).toHaveBeenCalledWith(
      {
        activityId: stored.id,
        selection: {
          useDefault: false,
          timed: [{ method: "notification", minutesBefore: 30 }],
          allDay: mocks.defaults.allDay,
        },
        expectedRevision: 3,
      },
      "csrf",
    ),
  );
  expect(mocks.editActivityAction).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it("sends event and own reminder edits together for one transactional save", async () => {
  open(stored);
  customize();
  changeMinutes("45");
  fireEvent.change(screen.getByRole("textbox", { name: "Event title" }), {
    target: { value: "Updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.editActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stored.id,
        subject: "Updated",
        expectedVersion: 4,
        personalReminders: {
          expectedRevision: 3,
          selection: {
            useDefault: false,
            timed: [{ method: "notification", minutesBefore: 45 }],
            allDay: mocks.defaults.allDay,
          },
        },
      }),
      "csrf",
    ),
  );
  expect(mocks.setEventReminderSettingsAction).not.toHaveBeenCalled();
});
it("keeps an invalid reminder draft through collapse and prevents accidental event save", async () => {
  open(stored);
  customize();
  changeMinutes("40321");
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reminders" })).toHaveAttribute(
      "aria-expanded",
      "true",
    ),
  );
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("40321");
  expect(mocks.editActivityAction).not.toHaveBeenCalled();
  expect(mocks.setEventReminderSettingsAction).not.toHaveBeenCalled();
});
it("closes an untouched editor without treating reminder clocks as schedule changes", () => {
  const close = open(stored);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it.each([false, true])(
  "keeps a committed save successful when cache refresh fails (existing: %s)",
  async (existing) => {
    const close = open(existing ? stored : undefined);
    if (existing) {
      customize();
      changeMinutes("30");
    } else
      fireEvent.change(screen.getByRole("textbox", { name: "Event title" }), {
        target: { value: "Saved" },
      });
    mocks.invalidate.mockRejectedValueOnce(new Error("synthetic cache refresh failure"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);
it.each(["complete", "delete"] as const)(
  "keeps a committed %s successful when cache refresh fails",
  async (kind) => {
    const close = open(stored);
    mocks.invalidate.mockRejectedValueOnce(new Error("synthetic cache refresh failure"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Event actions" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: kind === "complete" ? "Mark as done" : "Delete",
      }),
    );
    if (kind === "delete") await waitFor(() => expect(close).toHaveBeenCalledOnce());
    else await waitFor(() => expect(screen.getByText("Completed", { exact: true })).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);
