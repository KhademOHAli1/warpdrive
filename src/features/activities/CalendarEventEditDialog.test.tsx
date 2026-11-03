// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { CalendarEventEditDialog } from "./CalendarEventEditDialog";

const api = vi.hoisted(() => ({ readCalendarEventAction: vi.fn() }));
vi.mock("./calendarNativeActions", () => api);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./CalendarEventDialog", () => ({
  CalendarEventDialog: ({
    editing,
  }: {
    editing: { id: string; allDay: boolean; assigneeId: string };
  }) => (
    <div data-testid="loaded-event">
      {editing.id},{String(editing.allDay)},{editing.assigneeId}
    </div>
  ),
}));
const actorA = "00000000-0000-4000-8000-000000000001";
const actorB = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";
function view(actorId = actorA) {
  return (
    <NativeActorProvider actorId={actorId}>
      <CalendarEventEditDialog id={eventId} onClose={vi.fn()} onSaved={vi.fn()} />
    </NativeActorProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("waits for a new credential-bound read instead of using a cached DTO", () => {
  api.readCalendarEventAction.mockReturnValue(new Promise(() => {}));
  render(view());
  expect(screen.queryByTestId("loaded-event")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Opening event");
  expect(api.readCalendarEventAction).toHaveBeenCalledWith(
    { v: 1, expectedActorId: actorA, activityId: eventId },
    "csrf",
  );
});
it("keeps an opened draft mounted across ordinary rerenders", async () => {
  api.readCalendarEventAction.mockResolvedValue({
    ok: true,
    value: { id: eventId, allDay: true, assigneeId: actorA },
  });
  const { rerender } = render(view());
  const mounted = await screen.findByTestId("loaded-event");
  api.readCalendarEventAction.mockRejectedValue(new Error("offline"));
  rerender(view());
  expect(screen.getByTestId("loaded-event")).toBe(mounted);
  expect(api.readCalendarEventAction).toHaveBeenCalledTimes(1);
});
it("does not reveal event data when the initial authoritative read fails", async () => {
  api.readCalendarEventAction.mockResolvedValue({ ok: false, error: { id: "E_ACTIVITY_001" } });
  render(view());
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByTestId("loaded-event")).not.toBeInTheDocument();
});
it("discards a late read from the previous account", async () => {
  let finish: ((result: unknown) => void) | undefined;
  api.readCalendarEventAction
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ok: false, error: { id: "E_ACTIVITY_001" } });
  const { rerender } = render(view());
  rerender(view(actorB));
  await screen.findByRole("alert");
  finish?.({ ok: true, value: { id: eventId, allDay: true, assigneeId: actorA } });
  await waitFor(() => expect(api.readCalendarEventAction).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("loaded-event")).not.toBeInTheDocument();
});
