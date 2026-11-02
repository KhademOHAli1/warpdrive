// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";

const api = vi.hoisted(() => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  completeActivityAction: vi.fn(),
}));
vi.mock("./actions", () => api);
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
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: () => Promise.resolve() },
        listRows: { invalidate: () => Promise.resolve() },
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

it("expands the same draft into a separate activity-details area", () => {
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Planning" } });
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  const activity = screen.getByRole("complementary", { name: "Activity details" });
  expect(within(activity).getByLabelText("Activity type")).toBeInTheDocument();
  expect(within(activity).getByLabelText("Priority")).toBeInTheDocument();
  expect(screen.getByLabelText("Event title")).toHaveValue("Planning");
  fireEvent.click(screen.getByRole("button", { name: "Fewer options" }));
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
