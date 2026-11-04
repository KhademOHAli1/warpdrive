// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";
import type { ActivityReminderView } from "./reminderReadModel";

const api = vi.hoisted(() => ({
  createCalendarEventAction: vi.fn(),
  editCalendarEventAction: vi.fn(),
  completeCalendarEventAction: vi.fn(),
  deleteCalendarEventAction: vi.fn(),
  readCalendarEventAction: vi.fn(),
  retryCalendarReminderAction: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("./calendarNativeActions", () => api);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({ html, onChange }: { html: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Description"
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
const actorId = "00000000-0000-4000-8000-000000000003";
const secondActor = "00000000-0000-4000-8000-000000000004";
const generationId = "00000000-0000-4000-8000-000000000005";
const reminder: ActivityReminderView = {
  generationId,
  selection: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
  reminderTimeZone: "Europe/Berlin",
  status: "pending",
  fireAt: "2027-03-21T08:50:00.000Z",
  outcomeReason: null,
  retryable: false,
};
const event: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Team planning",
  dueAt: "2027-03-21T09:00:00.000Z",
  endAt: "2027-03-21T10:00:00.000Z",
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  authoredTimeZone: "Europe/Berlin",
  priority: null,
  location: null,
  note: null,
  videoCallUrl: null,
  assigneeId: actorId,
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  reminder,
};
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  api.invalidate.mockResolvedValue(undefined);
  api.readCalendarEventAction.mockResolvedValue({ ok: true, value: event });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function view({
  editing,
  actor = actorId,
  onClose = vi.fn(),
  onSaved = vi.fn(),
}: {
  editing?: EditableActivity;
  actor?: string;
  onClose?: () => void;
  onSaved?: () => void;
} = {}) {
  return (
    <NativeActorProvider actorId={actor}>
      <LocaleProvider timeZone="UTC">
        <CalendarEventDialog
          editing={editing}
          defaultDate="2027-03-21"
          defaultTime="09:00"
          onClose={onClose}
          onSaved={onSaved}
        />
      </LocaleProvider>
    </NativeActorProvider>
  );
}
function titleAndSave(): void {
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "My event" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

it("persists an explicit in-app choice and authored zone without the legacy email default", async () => {
  api.createCalendarEventAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  titleAndSave();
  await waitFor(() =>
    expect(api.createCalendarEventAction).toHaveBeenCalledWith(
      {
        v: 1,
        expectedActorId: actorId,
        activity: expect.objectContaining({
          authoredTimeZone: "UTC",
          reminderTimeZone: "UTC",
          reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
        }),
      },
      "csrf",
    ),
  );
});
it("introduces the 09:00 all-day clock only after the user enables the reminder", async () => {
  api.createCalendarEventAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
  expect(screen.queryByLabelText("Reminder time")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  expect(screen.getByLabelText("Reminder time")).toHaveValue("09:00");
  fireEvent.change(screen.getByLabelText("Reminder time"), { target: { value: "11:45" } });
  fireEvent.blur(screen.getByLabelText("Reminder time"));
  titleAndSave();
  await waitFor(() =>
    expect(api.createCalendarEventAction).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          allDay: true,
          dueDate: "2027-03-21",
          reminder: { kind: "all_day_at", channel: "in_app", localTime: "11:45" },
        }),
      }),
      "csrf",
    ),
  );
});
it("warns about unknown prior delivery only when enabling a new reminder on an older event", () => {
  render(view({ editing: { ...event, authoredTimeZone: null, reminder: null } }));
  expect(screen.queryByText(/An earlier reminder may already/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  expect(screen.getByText(/An earlier reminder may already/)).toBeInTheDocument();
});
it("requires explicit date and zone authoring before enabling an older all-day reminder", async () => {
  api.editCalendarEventAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  render(
    view({
      editing: {
        ...event,
        allDay: true,
        dueDate: null,
        endDate: null,
        authoredTimeZone: null,
        reminder: null,
      },
    }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  titleAndSave();
  expect(api.editCalendarEventAction).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Confirm the displayed date");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Save the displayed date as this event’s date in UTC." }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.editCalendarEventAction).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          allDay: true,
          dueDate: "2027-03-21",
          authoredTimeZone: "UTC",
          reminder: { kind: "all_day_at", channel: "in_app", localTime: "09:00" },
        }),
      }),
      "csrf",
    ),
  );
});
it("keeps a title-only save from rescheduling the current reminder", async () => {
  api.editCalendarEventAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  render(view({ editing: event }));
  expect(screen.getByLabelText("Start time")).toHaveValue("10:00");
  titleAndSave();
  await waitFor(() =>
    expect(api.editCalendarEventAction).toHaveBeenCalledWith(
      {
        v: 1,
        expectedActorId: actorId,
        activity: { id: event.id, subject: "My event", expectedReminderGeneration: generationId },
      },
      "csrf",
    ),
  );
});
it("shows in-app insertion without claiming an email was sent or the notification was read", () => {
  render(view({ editing: { ...event, reminder: { ...reminder, status: "delivered" } } }));
  expect(screen.getByRole("status")).toHaveTextContent("Added to notifications");
  expect(screen.queryByText(/email sent|notification read/i)).not.toBeInTheDocument();
});
it("retries a failed reminder against its current identity without creating another event", async () => {
  api.retryCalendarReminderAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  render(
    view({ editing: { ...event, reminder: { ...reminder, status: "failed", retryable: true } } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Try reminder again" }));
  await waitFor(() =>
    expect(api.retryCalendarReminderAction).toHaveBeenCalledWith(
      { v: 1, expectedActorId: actorId, activityId: event.id, expectedGenerationId: generationId },
      "csrf",
    ),
  );
  expect(api.createCalendarEventAction).not.toHaveBeenCalled();
});
it("retains a confirmed save and retries only its authoritative read after refresh failure", async () => {
  api.createCalendarEventAction.mockResolvedValue({ ok: true, value: { id: event.id } });
  api.readCalendarEventAction.mockRejectedValueOnce(new Error("offline"));
  const onClose = vi.fn();
  render(view({ onClose }));
  titleAndSave();
  const refresh = await screen.findByRole("button", { name: "Refresh saved event" });
  await waitFor(() => expect(refresh).not.toBeDisabled());
  expect(screen.getByLabelText("Event title")).toHaveValue("My event");
  expect(screen.getByLabelText("Event title")).toBeDisabled();
  fireEvent.click(refresh);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.createCalendarEventAction).toHaveBeenCalledOnce();
  expect(api.readCalendarEventAction).toHaveBeenCalledTimes(2);
});
it("blocks unsafe resubmission after a lost acknowledgment and preserves the draft and choice", async () => {
  api.createCalendarEventAction.mockRejectedValue(new Error("lost response"));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(view({ onClose, onSaved }));
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  titleAndSave();
  const check = await screen.findByRole("button", { name: "Check Calendar" });
  await waitFor(() => expect(check).not.toBeDisabled());
  expect(screen.getByLabelText("Event title")).toHaveValue("My event");
  expect(screen.getByRole("checkbox", { name: "In-app reminder" })).toBeChecked();
  const form = screen.getByRole("button", { name: "Check Calendar" }).closest("form");
  if (form === null) throw new Error("Calendar form missing");
  fireEvent.submit(form);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.createCalendarEventAction).toHaveBeenCalledOnce();
  expect(api.readCalendarEventAction).not.toHaveBeenCalled();
  expect(api.invalidate).toHaveBeenCalledTimes(2);
  expect(api.editCalendarEventAction).not.toHaveBeenCalled();
  expect(api.retryCalendarReminderAction).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledOnce();
});
it("ignores a completed save response after the account changes", async () => {
  let complete: ((value: unknown) => void) | undefined;
  const response = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  api.createCalendarEventAction.mockReturnValue(response);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(view({ onSaved, onClose }));
  titleAndSave();
  await waitFor(() => expect(api.createCalendarEventAction).toHaveBeenCalledOnce());
  rerender(view({ actor: secondActor, onSaved, onClose }));
  await act(async () => {
    complete?.({ ok: true, value: { id: event.id } });
    await response;
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(api.invalidate).not.toHaveBeenCalled();
  expect(api.readCalendarEventAction).not.toHaveBeenCalled();
});
it("disables mutations when no server-established account identity is available", () => {
  render(<CalendarEventDialog defaultDate="2027-03-21" defaultTime="09:00" onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(api.createCalendarEventAction).not.toHaveBeenCalled();
});

function expectNoCalendarWrites(): void {
  expect(api.createCalendarEventAction).not.toHaveBeenCalled();
  expect(api.editCalendarEventAction).not.toHaveBeenCalled();
  expect(api.completeCalendarEventAction).not.toHaveBeenCalled();
  expect(api.deleteCalendarEventAction).not.toHaveBeenCalled();
  expect(api.retryCalendarReminderAction).not.toHaveBeenCalled();
  expect(api.invalidate).not.toHaveBeenCalled();
}

it.each([
  ["returned failure", "E_PERM_001"],
  ["rejected read", null],
  ["stale reminder read", "E_ACTIVITY_010"],
  ["invalid reminder read", "E_ACTIVITY_009"],
] as const)(
  "clears a failed manual reminder read after a successful refreshed status (%s)",
  async (_failure, errorId) => {
    if (errorId === null) api.readCalendarEventAction.mockRejectedValueOnce(new Error("offline"));
    else api.readCalendarEventAction.mockResolvedValueOnce({ ok: false, error: { id: errorId } });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(view({ editing: event, onClose, onSaved }));
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Authored title" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "<p>Authored note</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh status" })).not.toBeDisabled(),
    );
    let finishRead: ((value: { ok: true; value: EditableActivity }) => void) | undefined;
    const refreshed = new Promise<{ ok: true; value: EditableActivity }>((resolve) => {
      finishRead = resolve;
    });
    api.readCalendarEventAction.mockReturnValueOnce(refreshed);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(api.readCalendarEventAction).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeDisabled();
    expect(screen.getByLabelText("Event title")).toHaveValue("Authored title");
    await act(async () => {
      finishRead?.({
        ok: true,
        value: { ...event, reminder: { ...reminder, status: "delivered" } },
      });
      await refreshed;
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Added to notifications"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Event title")).toHaveValue("Authored title");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "<p>Authored note</p>",
    );
    expect(screen.getByRole("checkbox", { name: "In-app reminder" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Refresh status" })).not.toBeDisabled();
    expect(api.readCalendarEventAction.mock.calls).toEqual([
      [{ v: 1, expectedActorId: actorId, activityId: event.id }, "csrf"],
      [{ v: 1, expectedActorId: actorId, activityId: event.id }, "csrf"],
    ]);
    expectNoCalendarWrites();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  },
);

it("preserves authored date and reminder drafts while recovering a manual read", async () => {
  api.readCalendarEventAction.mockRejectedValueOnce(new Error("offline"));
  render(view({ editing: event }));
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Authored title" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "<p>Authored note</p>" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start date" }));
  fireEvent.click(await screen.findByRole("button", { name: "Monday, March 22nd, 2027" }));
  expect(screen.getByRole("button", { name: "Start date" })).toHaveTextContent("03/22/2027");
  fireEvent.click(screen.getByRole("checkbox", { name: "In-app reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh status" })).not.toBeDisabled(),
  );
  api.readCalendarEventAction.mockResolvedValueOnce({
    ok: true,
    value: {
      ...event,
      location: "Refreshed location",
      reminder: { ...reminder, status: "delivered" },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(screen.getByLabelText("Location")).toHaveValue("Refreshed location"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Event title")).toHaveValue("Authored title");
  expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("<p>Authored note</p>");
  expect(screen.getByRole("button", { name: "Start date" })).toHaveTextContent("03/22/2027");
  expect(screen.getByRole("checkbox", { name: "In-app reminder" })).not.toBeChecked();
  expect(api.readCalendarEventAction).toHaveBeenCalledTimes(2);
  expectNoCalendarWrites();
});

it("keeps a validation error when a manual reminder read succeeds", async () => {
  render(view({ editing: event }));
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a title for this event.");
  api.readCalendarEventAction.mockResolvedValueOnce({
    ok: true,
    value: { ...event, reminder: { ...reminder, status: "delivered" } },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Added to notifications"),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a title for this event.");
  expect(screen.getByLabelText("Event title")).toHaveValue("");
  expect(api.readCalendarEventAction).toHaveBeenCalledOnce();
  expectNoCalendarWrites();
});

it("keeps a returned save error when a manual reminder read succeeds", async () => {
  api.editCalendarEventAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
  render(view({ editing: event }));
  titleAndSave();
  const error = await screen.findByRole("alert");
  const saveError = error.textContent;
  expect(saveError).not.toBe("");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh status" })).not.toBeDisabled(),
  );
  api.readCalendarEventAction.mockResolvedValueOnce({
    ok: true,
    value: { ...event, reminder: { ...reminder, status: "delivered" } },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Added to notifications"),
  );
  expect(screen.getByRole("alert").textContent).toBe(saveError);
  expect(screen.getByLabelText("Event title")).toHaveValue("My event");
  expect(api.editCalendarEventAction).toHaveBeenCalledExactlyOnceWith(
    {
      v: 1,
      expectedActorId: actorId,
      activity: { id: event.id, subject: "My event", expectedReminderGeneration: generationId },
    },
    "csrf",
  );
  expect(api.readCalendarEventAction).toHaveBeenCalledOnce();
  expect(api.createCalendarEventAction).not.toHaveBeenCalled();
  expect(api.completeCalendarEventAction).not.toHaveBeenCalled();
  expect(api.deleteCalendarEventAction).not.toHaveBeenCalled();
  expect(api.retryCalendarReminderAction).not.toHaveBeenCalled();
  expect(api.invalidate).not.toHaveBeenCalled();
});
