// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventViewer } from "./CalendarEventViewer";
import type { EditableActivity } from "./getForEdit";
import type { EventReminderContext } from "./personalReminderSettings";

const api = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  editRead: vi.fn(() => Promise.resolve()),
}));
vi.mock("./reminderSettingsActions", () => ({ setEventReminderSettingsAction: api.save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: { getForEdit: { invalidate: api.editRead } },
      calendars: { reminders: { eventSettings: { invalidate: api.refresh } } },
    }),
  },
}));
const context: EventReminderContext = {
  selection: { useDefault: false, timed: [], allDay: [] },
  defaults: { timed: [{ method: "notification", minutesBefore: 10 }], allDay: [] },
  revision: 3,
  subscribed: false,
  emailCapability: "mailboxMissing",
  timeZone: "Asia/Tehran",
};
const event: EditableActivity = {
  id: "event",
  typeId: "meeting",
  subject: "جلسه / Besprechung",
  priority: null,
  dueAt: "2027-03-21T09:00:00Z",
  endAt: "2027-03-21T10:00:00Z",
  allDay: false,
  durationMinutes: 60,
  location: "Berlin",
  note: null,
  videoCallUrl: null,
  assigneeId: "owner",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  canEdit: false,
  eventTimeZone: "Asia/Tehran",
  personalReminders: context,
};
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each([
  { locale: "fa", reminders: "یادآوری‌ها", add: "افزودن یادآوری", save: "ذخیرهٔ یادآوری‌های من" },
  {
    locale: "de",
    reminders: "Erinnerungen",
    add: "Erinnerung hinzufügen",
    save: "Meine Erinnerungen speichern",
  },
] as const)(
  "lets a read-only viewer save only their personal reminders in $locale",
  async ({ locale, reminders, add, save }) => {
    const selection = {
      useDefault: false as const,
      timed: [{ method: "notification" as const, minutesBefore: 10 }],
      allDay: [],
    };
    api.save.mockResolvedValue({
      ok: true,
      value: { ...context, selection, revision: 4, subscribed: true },
    });
    render(
      <LocaleProvider locale={locale}>
        <CalendarEventViewer event={event} onClose={vi.fn()} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: reminders }));
    fireEvent.click(screen.getByRole("button", { name: add }));
    fireEvent.click(screen.getByRole("button", { name: save }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        { activityId: "event", expectedRevision: 3, selection },
        "csrf",
      ),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(event.subject);
    expect(
      screen.queryByRole("button", { name: /Event actions|Terminaktionen|گزینه‌های رویداد/ }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  },
);

it("protects an unfinished personal reminder draft when closing the read-only viewer", async () => {
  const onClose = vi.fn();
  render(
    <LocaleProvider locale="en">
      <CalendarEventViewer event={event} onClose={onClose} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByText("Close", { selector: "button" }));
  const alert = await screen.findByRole("alertdialog");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(within(alert).getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
