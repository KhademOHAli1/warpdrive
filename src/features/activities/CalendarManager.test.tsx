// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarManager } from "./CalendarManager";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  member: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  defaults: vi.fn(),
  readDefaults: vi.fn(),
}));
const fixture = vi.hoisted(() => ({ role: "owner" }));
vi.mock("./reminderSettingsActions", () => ({ setCalendarReminderDefaultsAction: api.defaults }));
vi.mock("./calendarActions", () => ({
  createCalendarAction: api.create,
  setCalendarMemberAction: api.member,
  updateCalendarAction: api.update,
  setCalendarArchivedAction: api.archive,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      calendars: {
        list: { invalidate: () => Promise.resolve() },
        reminders: { calendarDefaults: { invalidate: () => Promise.resolve() } },
      },
    }),
    calendars: {
      reminders: {
        calendarDefaults: {
          useQuery: (input: unknown) => {
            api.readDefaults(input);
            return {
              data: {
                defaults: { timed: [{ method: "notification", minutesBefore: 10 }], allDay: [] },
                revision: 0,
                emailCapability: "available",
              },
              isFetchedAfterMount: true,
              isError: false,
              refetch: () => Promise.resolve(),
            };
          },
        },
      },
      list: {
        useQuery: () => ({
          data: [
            {
              id: "cal",
              name: "Team",
              timeZone: "Europe/Berlin",
              role: fixture.role,
              isPrimary: false,
              deletedAt: null,
            },
          ],
          refetch: () => Promise.resolve(),
        }),
      },
      members: {
        useQuery: () => ({
          data: [{ userId: "reader", name: "Sara", role: "reader" }],
          refetch: () => Promise.resolve(),
        }),
      },
    },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  fixture.role = "owner";
});
it.each([
  {
    locale: "fa",
    manage: "مدیریت تقویم‌ها",
    name: "نام تقویم",
    create: "ایجاد تقویم",
    remove: "لغو دسترسی Sara",
  },
  {
    locale: "de",
    manage: "Kalender verwalten",
    name: "Kalendername",
    create: "Kalender erstellen",
    remove: "Zugriff für Sara entfernen",
  },
] as const)(
  "creates a calendar and revokes a member in $locale",
  async ({ locale, manage, name, create, remove }) => {
    let finishCreate: (() => void) | undefined;
    api.create.mockReturnValue(
      new Promise((resolve) => {
        finishCreate = () => resolve({ ok: true, value: { id: "new" } });
      }),
    );
    api.member.mockResolvedValue({ ok: true });
    render(
      <LocaleProvider locale={locale}>
        <CalendarManager />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: manage }));
    fireEvent.change(screen.getByLabelText(name), { target: { value: "تقویم / Kalender" } });
    fireEvent.click(screen.getByRole("button", { name: create }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "تقویم / Kalender" }),
        "csrf",
      ),
    );
    expect(screen.getByRole("button", { name: "Team" })).toBeDisabled();
    finishCreate?.();
    // The action call precedes invalidation/refetch and the navigation guard stays locked
    // until the complete mutation settles. A click during that interval is intentionally ignored.
    await waitFor(() => expect(screen.getByRole("button", { name: "Team" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    fireEvent.click(await screen.findByRole("button", { name: remove }));
    await waitFor(() =>
      expect(api.member).toHaveBeenCalledWith(
        { calendarId: "cal", userId: "reader", role: null },
        "csrf",
      ),
    );
  },
);

it("protects unsaved calendar settings when closing or switching calendars", async () => {
  render(
    <LocaleProvider locale="en">
      <CalendarManager />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
  fireEvent.change(screen.getByLabelText("Calendar name"), { target: { value: "New draft" } });
  fireEvent.click(screen.getByText("Close", { selector: "button" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Calendar name")).toHaveValue("New draft");
});

it.each(["owner", "editor", "reader"] as const)(
  "offers personal defaults only after selecting a %s calendar",
  async (role) => {
    fixture.role = role;
    render(
      <LocaleProvider locale="en">
        <CalendarManager />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
    expect(api.readDefaults).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(await screen.findByRole("button", { name: "My reminder defaults" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(api.readDefaults).toHaveBeenCalledWith({ calendarId: "cal" });
  },
);

it("does not query or expose personal defaults to a free/busy-only member", () => {
  fixture.role = "freeBusy";
  render(
    <LocaleProvider locale="en">
      <CalendarManager />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  expect(screen.queryByRole("button", { name: "My reminder defaults" })).not.toBeInTheDocument();
  expect(api.readDefaults).not.toHaveBeenCalled();
});

it("protects raw personal-default edits when closing or changing the selected calendar", async () => {
  fixture.role = "reader";
  render(
    <LocaleProvider locale="en">
      <CalendarManager />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  const reminder = await screen.findByRole("button", { name: "My reminder defaults" });
  fireEvent.click(reminder);
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "40321" },
  });
  fireEvent.click(reminder);
  fireEvent.click(screen.getByText("Close", { selector: "button" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "New calendar" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(reminder);
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("40321");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("keeps a personal-default draft when shared calendar settings are saved", async () => {
  api.update.mockResolvedValue({ ok: true });
  render(
    <LocaleProvider locale="en">
      <CalendarManager />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  fireEvent.click(await screen.findByRole("button", { name: "My reminder defaults" }));
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Calendar name"), { target: { value: "Team renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.update).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Team" })).toBeEnabled());
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("5");
  expect(api.defaults).not.toHaveBeenCalled();
});

it("keeps shared settings and personal defaults as distinct siblings across selection and saves", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    api.defaults.mockResolvedValue({
      ok: true,
      value: {
        defaults: { timed: [{ method: "notification", minutesBefore: 5 }], allDay: [] },
        revision: 1,
        emailCapability: "available",
      },
    });
    render(
      <StrictMode>
        <LocaleProvider locale="en">
          <CalendarManager />
        </LocaleProvider>
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    fireEvent.click(await screen.findByRole("button", { name: "My reminder defaults" }));
    fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save my defaults" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your reminder defaults were saved.",
    );
    expect(screen.getByLabelText("Calendar name")).toHaveValue("Team");
    expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("5");
    expect(errors.mock.calls.flat().map(String).join(" ")).not.toMatch(/same key|unique.*key/i);
  } finally {
    errors.mockRestore();
  }
});
