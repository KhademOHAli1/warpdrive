// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";

const actions = vi.hoisted(() => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  completeActivityAction: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("./actions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({ html, onChange }: { html: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Description editor"
      value={html}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: actions.invalidate },
        listRows: { invalidate: actions.invalidate },
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

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const labels = {
  en: {
    title: "Subject",
    create: "New event",
    more: "More options",
    fewer: "Fewer options",
    start: "Start time",
    end: "End time",
    date: "Start date",
    allDay: "All day",
    location: "Location",
    meeting: "Meeting link",
    save: "Save",
    zone: "UTC",
  },
  fa: {
    title: "موضوع",
    create: "رویداد جدید",
    more: "گزینه‌های بیشتر",
    fewer: "گزینه‌های کمتر",
    start: "ساعت شروع",
    end: "ساعت پایان",
    date: "تاریخ شروع",
    allDay: "تمام روز",
    location: "مکان",
    meeting: "پیوند جلسه",
    save: "ذخیره",
    zone: "Asia/Tehran",
  },
  de: {
    title: "Betreff",
    create: "Neuer Termin",
    more: "Weitere Optionen",
    fewer: "Weniger Optionen",
    start: "Startzeit",
    end: "Endzeit",
    date: "Startdatum",
    allDay: "Ganztägig",
    location: "Ort",
    meeting: "Besprechungslink",
    save: "Speichern",
    zone: "Europe/Berlin",
  },
};

const stored: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Termin",
  priority: null,
  dueAt: "2026-10-25T01:30:29.123Z",
  endAt: null,
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: "Berlin",
  note: "<p>Bestehende Beschreibung</p>",
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
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
};

describe.each(["fa", "de", "en"] as Locale[])("calendar event workflow in %s", (locale) => {
  const l = labels[locale];
  function open() {
    return render(
      <LocaleProvider locale={locale} timeZone={l.zone}>
        <CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />
      </LocaleProvider>,
    );
  }

  it("keeps one draft through quick/details and timed/all-day transitions, then saves it", async () => {
    actions.createActivityAction.mockResolvedValue({ ok: true, value: { id: "created" } });
    open();
    expect(screen.getByRole("dialog", { name: l.create })).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    fireEvent.change(screen.getByLabelText(l.title), {
      target: { value: "جلسه با تیم / Teamtermin" },
    });
    fireEvent.click(screen.getByRole("button", { name: l.more }));
    fireEvent.change(screen.getByLabelText(l.location), { target: { value: "تهران / Berlin" } });
    fireEvent.change(screen.getByLabelText(l.meeting), {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    fireEvent.change(screen.getByLabelText("Description editor"), {
      target: { value: "<p>برنامهٔ جلسه / Tagesordnung</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: l.fewer }));
    fireEvent.click(screen.getByRole("checkbox", { name: l.allDay }));
    expect(screen.queryByLabelText(l.start)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: l.allDay }));
    expect(screen.getByLabelText(l.start)).toHaveValue(locale === "fa" ? "۰۹:۰۰" : "09:00");
    expect(screen.getByLabelText(l.end)).toHaveValue(locale === "fa" ? "۱۰:۰۰" : "10:00");
    fireEvent.click(screen.getByRole("button", { name: l.more }));
    expect(screen.getByLabelText(l.location)).toHaveValue("تهران / Berlin");
    expect(screen.getByLabelText("Description editor")).toHaveValue(
      "<p>برنامهٔ جلسه / Tagesordnung</p>",
    );
    fireEvent.click(screen.getByRole("button", { name: l.save }));
    await waitFor(() => expect(actions.createActivityAction).toHaveBeenCalledTimes(1));
    expect(actions.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "جلسه با تیم / Teamtermin",
        location: "تهران / Berlin",
        allDay: false,
        durationMinutes: 60,
        note: "<p>برنامهٔ جلسه / Tagesordnung</p>",
        videoCallUrl: "https://meet.google.com/abc-defg-hij",
      }),
      "csrf",
    );
  });

  it("retains the draft when a save fails", async () => {
    actions.createActivityAction.mockRejectedValue(new Error("offline"));
    open();
    fireEvent.change(screen.getByLabelText(l.title), { target: { value: "Besprechung / جلسه" } });
    fireEvent.click(screen.getByRole("button", { name: l.save }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("offline");
    expect(screen.getByLabelText(l.title)).toHaveValue("Besprechung / جلسه");
    expect(screen.getByRole("button", { name: l.save })).not.toBeDisabled();
  });
});

it("accepts Persian clock digits and moves the end without changing duration", async () => {
  actions.createActivityAction.mockResolvedValue({ ok: true, value: { id: "created" } });
  render(
    <LocaleProvider locale="fa" timeZone="Asia/Tehran">
      <CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("موضوع"), { target: { value: "جلسهٔ نوروزی" } });
  expect(screen.getByLabelText("تاریخ شروع")).toHaveTextContent("۱۴۰۶");
  fireEvent.change(screen.getByLabelText("ساعت شروع"), { target: { value: "۱۰:۳۰" } });
  fireEvent.blur(screen.getByLabelText("ساعت شروع"));
  fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
  await waitFor(() =>
    expect(actions.createActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: "2027-03-21T07:00:00.000Z",
        endAt: "2027-03-21T08:00:00.000Z",
        durationMinutes: 60,
      }),
      "csrf",
    ),
  );
});

it("reopens details and patches only a changed description", async () => {
  actions.editActivityAction.mockResolvedValue({ ok: true });
  render(
    <LocaleProvider locale="de" timeZone="Europe/Berlin">
      <CalendarEventDialog editing={stored} onClose={vi.fn()} />
    </LocaleProvider>,
  );
  expect(screen.getByLabelText("Endzeit")).toHaveValue("03:30");
  expect(screen.getByLabelText("Description editor")).toHaveValue(stored.note);
  fireEvent.change(screen.getByLabelText("Description editor"), {
    target: { value: "<p>Geänderte Beschreibung</p>" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(actions.editActivityAction).toHaveBeenCalledWith(
      { id: stored.id, note: "<p>Geänderte Beschreibung</p>" },
      "csrf",
    ),
  );
});

it("retains the completion workflow and reports it to the follow-up caller", async () => {
  actions.completeActivityAction.mockResolvedValue({ ok: true });
  const onMarkedDone = vi.fn();
  render(<CalendarEventDialog editing={stored} onClose={vi.fn()} onMarkedDone={onMarkedDone} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
  await waitFor(() => expect(onMarkedDone).toHaveBeenCalledWith(stored.id));
  expect(actions.completeActivityAction).toHaveBeenCalledWith(
    { id: stored.id, done: true },
    "csrf",
  );
});
