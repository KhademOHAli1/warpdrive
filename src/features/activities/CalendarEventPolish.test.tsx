// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";

const api = vi.hoisted(() => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  completeActivityAction: vi.fn(),
}));
const calendarFixture = vi.hoisted(() => ({ zone: "UTC", available: true, typesAvailable: true }));
vi.mock("./actions", () => api);
vi.mock("./reminderSettingsActions", () => ({ setEventReminderSettingsAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({
    html,
    onChange,
    ariaLabel,
  }: {
    html: string;
    onChange: (v: string) => void;
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
    calendars: {
      list: {
        useQuery: () => ({
          data: calendarFixture.available
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000010",
                  name: "",
                  role: "owner",
                  isPrimary: true,
                  timeZone: calendarFixture.zone,
                },
              ]
            : undefined,
        }),
      },
    },
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: () => Promise.resolve() },
        listRows: { invalidate: () => Promise.resolve() },
      },
    }),
    activities: {
      listTypes: {
        useQuery: () => ({
          data: calendarFixture.typesAvailable
            ? [
                { id: "00000000-0000-4000-8000-000000000020", key: "call", name: "Call" },
                { id: "00000000-0000-4000-8000-000000000002", key: "meeting", name: "Meeting" },
              ]
            : [],
        }),
      },
      dayLoad: { useQuery: () => ({ data: undefined }) },
    },
  },
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  calendarFixture.zone = "UTC";
  calendarFixture.available = true;
  calendarFixture.typesAvailable = true;
});

const stored: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Team planning",
  priority: "medium",
  dueAt: "2027-03-21T09:00:00.000Z",
  endAt: "2027-03-21T10:00:00.000Z",
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: "Berlin",
  note: "<p>Agenda</p>",
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  assigneeId: "00000000-0000-4000-8000-000000000003",
  done: false,
  dealId: null,
  personId: "00000000-0000-4000-8000-000000000004",
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: "Sara",
  orgName: null,
};

it("starts with a focused calendar form and reveals optional fields on demand", () => {
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  expect(screen.getByLabelText("Event title")).toBeInTheDocument();
  expect(screen.queryByLabelText("Activity type")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Meeting link")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add video meeting" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add description" }));
  expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
});

it("reveals CRM details inline while keeping the same event draft", () => {
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Planning" } });
  fireEvent.click(screen.getByRole("button", { name: "CRM details" }));
  const activity = screen.getByRole("complementary", { name: "Activity details" });
  expect(within(activity).getByLabelText("Activity type")).toBeInTheDocument();
  expect(within(activity).getByLabelText("Priority")).toBeInTheDocument();
  expect(screen.getByLabelText("Event title")).toHaveValue("Planning");
  fireEvent.click(screen.getByRole("button", { name: "CRM details" }));
  expect(screen.getByLabelText("Event title")).toHaveValue("Planning");
  expect(screen.getByLabelText("Start time")).toHaveValue("09:00");
});

it("shows a meeting summary, and applying a link never submits the event", () => {
  render(<CalendarEventDialog editing={stored} onClose={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute(
    "href",
    stored.videoCallUrl,
  );
  expect(screen.queryByLabelText("Meeting link")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit meeting link" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Meeting link" }), {
    target: { value: "https://zoom.us/j/123456789" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Meeting link" }), { key: "Enter" });
  expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute(
    "href",
    "https://zoom.us/j/123456789",
  );
  expect(api.createActivityAction).not.toHaveBeenCalled();
  expect(api.editActivityAction).not.toHaveBeenCalled();
});

it("keeps linked CRM context visible and places completion in the actions menu", async () => {
  api.completeActivityAction.mockResolvedValue({ ok: true });
  const onMarkedDone = vi.fn();
  render(<CalendarEventDialog editing={stored} onClose={vi.fn()} onMarkedDone={onMarkedDone} />);
  fireEvent.click(screen.getByRole("button", { name: "CRM details" }));
  expect(screen.getByRole("link", { name: "Sara" })).toHaveAttribute(
    "href",
    `/contacts/people/${stored.personId}`,
  );
  expect(screen.queryByRole("button", { name: "Mark as done" })).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Event actions" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as done" }));
  await waitFor(() => expect(onMarkedDone).toHaveBeenCalledWith(stored.id));
});

it("supports the save shortcut without duplicating the submission", async () => {
  api.createActivityAction.mockResolvedValue({ ok: true });
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  const title = screen.getByLabelText("Event title");
  fireEvent.change(title, { target: { value: "Planning" } });
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(api.createActivityAction).toHaveBeenCalledTimes(1));
  expect(api.createActivityAction).toHaveBeenCalledWith(
    expect.objectContaining({ typeId: stored.typeId }),
    "csrf",
  );
});

it("commits the visible clock draft before keyboard saving and blocks an invalid clock", async () => {
  api.createActivityAction.mockResolvedValue({ ok: true });
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Planning" } });
  const clock = screen.getByLabelText("Start time");
  fireEvent.change(clock, { target: { value: "25:99" } });
  fireEvent.keyDown(clock, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(clock).toHaveAttribute("aria-invalid", "true"));
  expect(api.createActivityAction).not.toHaveBeenCalled();
  fireEvent.change(clock, { target: { value: "11:30" } });
  fireEvent.keyDown(clock, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(api.createActivityAction).toHaveBeenCalledTimes(1));
  expect(api.createActivityAction).toHaveBeenCalledWith(
    expect.objectContaining({ dueAt: "2027-03-21T11:30:00.000Z", durationMinutes: 60 }),
    "csrf",
  );
});

it("rejects unsafe meeting links and lets Escape cancel just the link edit", async () => {
  const onClose = vi.fn();
  render(<CalendarEventDialog editing={stored} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit meeting link" }));
  const link = screen.getByRole("textbox", { name: "Meeting link" });
  fireEvent.change(link, { target: { value: "https://user:secret@example.com/meeting" } });
  fireEvent.keyDown(link, { key: "Enter" });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(link).toHaveAttribute("aria-invalid", "true");
  fireEvent.keyDown(link, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Meeting link" })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute(
    "href",
    stored.videoCallUrl,
  );
  expect(onClose).not.toHaveBeenCalled();
});

it("never renders an unsafe stored meeting URL as a clickable link", () => {
  render(
    <CalendarEventDialog
      editing={{ ...stored, videoCallUrl: "javascript:alert(1)" }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole("link", { name: "Join meeting" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit meeting link" })).toBeInTheDocument();
});

it.each([
  {
    locale: "fa",
    title: "عنوان رویداد",
    cancel: "انصراف",
    keep: "ادامهٔ ویرایش",
    discard: "حذف تغییرات ذخیره‌نشده",
  },
  {
    locale: "de",
    title: "Termintitel",
    cancel: "Abbrechen",
    keep: "Weiter bearbeiten",
    discard: "Änderungen verwerfen",
  },
] as const)(
  "protects a dirty draft in $locale and keeps it when discard is cancelled",
  async ({ locale, title, cancel, keep, discard }) => {
    const onClose = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <CalendarEventDialog defaultDate="2027-03-21" onClose={onClose} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText(title), { target: { value: "جلسه / Besprechung" } });
    fireEvent.click(screen.getByRole("button", { name: cancel }));
    const alert = await screen.findByRole("alertdialog");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: keep }));
    expect(screen.getByLabelText(title)).toHaveValue("جلسه / Besprechung");
    fireEvent.click(screen.getByRole("button", { name: cancel }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: discard }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

it("protects raw uncommitted clock edits and browser navigation", async () => {
  const onClose = vi.fn();
  render(<CalendarEventDialog editing={stored} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "12:45" } });
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.keyDown(screen.getByLabelText("Start time"), { key: "Escape" });
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it("opens in the authored event zone and preserves the draft on a revision conflict", async () => {
  api.editActivityAction.mockResolvedValue({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_CONFLICT },
  });
  render(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <CalendarEventDialog
        editing={{ ...stored, eventTimeZone: "Asia/Tehran", version: 4 }}
        onClose={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect(screen.getByLabelText("Start time")).toHaveValue("12:30");
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "My draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.editActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 4 }),
      "csrf",
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("changed since");
  expect(screen.getByLabelText("Event title")).toHaveValue("My draft");
});

it("uses the chosen calendar's zone when its delayed read arrives without losing typed input", async () => {
  calendarFixture.available = false;
  calendarFixture.zone = "Asia/Tehran";
  api.createActivityAction.mockResolvedValue({ ok: true });
  const view = render(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("Event title"), {
    target: { value: "Typed while loading" },
  });
  calendarFixture.available = true;
  calendarFixture.typesAvailable = true;
  view.rerender(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Typed while loading",
        eventTimeZone: "Asia/Tehran",
        dueAt: "2027-03-21T05:30:00.000Z",
      }),
      "csrf",
    ),
  );
});

it.each([
  {
    locale: "fa",
    crm: "جزئیات CRM",
    calendar: "تقویم رویداد: تقویم من",
    zone: "منطقهٔ زمانی رویداد: UTC",
    visibility: "دسترسی به جزئیات",
    title: "عنوان رویداد",
  },
  {
    locale: "de",
    crm: "CRM-Details",
    calendar: "Kalender des Termins: Mein Kalender",
    zone: "Zeitzone des Termins: UTC",
    visibility: "Sichtbarkeit",
    title: "Termintitel",
  },
] as const)(
  "keeps secondary settings collapsed and reveals them by keyboard in $locale",
  async ({ locale, crm, calendar, zone, visibility, title }) => {
    render(
      <LocaleProvider locale={locale}>
        <CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: crm })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: calendar })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: zone })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: visibility })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(title), { target: { value: "جلسه / Termin" } });
    const calendarButton = screen.getByRole("button", { name: calendar });
    calendarButton.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(screen.getByRole("combobox", { name: visibility })).toBeInTheDocument();
    fireEvent.click(calendarButton);
    expect(screen.getByLabelText(title)).toHaveValue("جلسه / Termin");
    expect(screen.queryByRole("combobox", { name: visibility })).not.toBeInTheDocument();
  },
);

it("summarizes non-default settings and authored zone even with disclosures closed", () => {
  render(
    <CalendarEventDialog
      editing={{
        ...stored,
        calendarId: "00000000-0000-4000-8000-000000000010",
        eventVisibility: "private",
        availability: "free",
        eventTimeZone: "Asia/Tehran",
      }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Event calendar: My calendar" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.getByText("Private")).toBeVisible();
  expect(screen.getByText("Free")).toBeVisible();
  expect(screen.getByRole("button", { name: "Event time zone: Asia/Tehran" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Visibility" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
});

it("preserves settings across closing their disclosure and saves them while collapsed", async () => {
  api.createActivityAction.mockResolvedValue({ ok: true });
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Private planning" } });
  const calendarButton = screen.getByRole("button", { name: "Event calendar: My calendar" });
  fireEvent.click(calendarButton);
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Visibility" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Private" }));
  fireEvent.click(calendarButton);
  expect(screen.getByText("Private")).toBeVisible();
  fireEvent.click(calendarButton);
  expect(screen.getByRole("combobox", { name: "Visibility" })).toHaveTextContent("Private");
  fireEvent.click(calendarButton);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Private planning", eventVisibility: "private" }),
      "csrf",
    ),
  );
});

it("reveals CRM controls when a hidden activity-type validation error blocks saving", async () => {
  calendarFixture.typesAvailable = false;
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Planning" } });
  expect(screen.getByRole("button", { name: "CRM details" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Event types are unavailable");
  expect(screen.getByRole("button", { name: "CRM details" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByLabelText("Activity type")).toBeVisible();
  expect(api.createActivityAction).not.toHaveBeenCalled();
});

it("retains an authored zone after closing its picker and submits with settings collapsed", async () => {
  api.createActivityAction.mockResolvedValue({ ok: true });
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Tehran planning" } });
  fireEvent.click(screen.getByRole("button", { name: "Event time zone: UTC" }));
  fireEvent.click(screen.getByRole("button", { name: "Event time zone" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Search..." }), {
    target: { value: "Asia/Tehran" },
  });
  fireEvent.click(await screen.findByRole("option", { name: "Asia/Tehran" }));
  const zoneButton = screen.getByRole("button", { name: "Event time zone: Asia/Tehran" });
  fireEvent.click(zoneButton);
  expect(zoneButton).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Event time zone" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventTimeZone: "Asia/Tehran", dueAt: "2027-03-21T05:30:00.000Z" }),
      "csrf",
    ),
  );
});
