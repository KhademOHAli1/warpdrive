// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { CalendarReminderDefaultsPanel } from "./CalendarReminderDefaultsPanel";
import type { CalendarReminderContext } from "./personalReminderSettings";

const api = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  list: vi.fn(() => Promise.resolve()),
  refetch: vi.fn(() => Promise.resolve()),
}));
const query = vi.hoisted(() => ({
  data: undefined as CalendarReminderContext | undefined,
  isError: false,
  isFetchedAfterMount: true,
}));
vi.mock("./reminderSettingsActions", () => ({ setCalendarReminderDefaultsAction: api.save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    calendars: {
      reminders: { calendarDefaults: { useQuery: () => ({ ...query, refetch: api.refetch }) } },
    },
    useUtils: () => ({
      calendars: {
        list: { invalidate: api.list },
        reminders: { calendarDefaults: { invalidate: api.refresh } },
      },
    }),
  },
}));
const context: CalendarReminderContext = {
  defaults: {
    timed: [{ method: "notification", minutesBefore: 10 }],
    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
  },
  revision: 2,
  emailCapability: "available",
};
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  query.data = structuredClone(context);
  query.isError = false;
  query.isFetchedAfterMount = true;
  api.save.mockReset();
  api.refresh.mockClear();
  api.list.mockClear();
  api.refetch.mockClear();
});
afterEach(cleanup);

it("saves only personal defaults with their revision while the editor is collapsed", async () => {
  const dirty = vi.fn();
  const saved = {
    ...context,
    revision: 3,
    defaults: {
      ...context.defaults,
      timed: [{ method: "notification" as const, minutesBefore: 5 }],
    },
  };
  api.save.mockResolvedValue({ ok: true, value: saved });
  render(
    <CalendarReminderDefaultsPanel
      calendarId="cal"
      timeZone="Europe/Berlin"
      onDirtyChange={dirty}
      onPendingChange={vi.fn()}
    />,
  );
  const trigger = await screen.findByRole("button", { name: "My reminder defaults" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "5" },
  });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Save my defaults" }));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith(
      { calendarId: "cal", expectedRevision: 2, defaults: saved.defaults },
      "csrf",
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Your reminder defaults were saved.");
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect(api.list).toHaveBeenCalledTimes(1);
});

it("retains a conflicting draft after a later background read error", async () => {
  api.save.mockResolvedValue({ ok: false, error: { id: ERROR_IDS.ACTIVITY_CONFLICT } });
  const view = render(
    <CalendarReminderDefaultsPanel
      calendarId="cal"
      timeZone="Europe/Berlin"
      onDirtyChange={vi.fn()}
      onPendingChange={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "My reminder defaults" }));
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "15" },
  });
  query.isError = true;
  view.rerender(
    <CalendarReminderDefaultsPanel
      calendarId="cal"
      timeZone="Europe/Berlin"
      onDirtyChange={vi.fn()}
      onPendingChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save my defaults" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("15");
  expect(api.save).toHaveBeenCalledTimes(1);
});

it("reveals a raw invalid value and never calls the save action", async () => {
  render(
    <CalendarReminderDefaultsPanel
      calendarId="cal"
      timeZone="Europe/Berlin"
      onDirtyChange={vi.fn()}
      onPendingChange={vi.fn()}
    />,
  );
  const trigger = await screen.findByRole("button", { name: "My reminder defaults" });
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "40321" },
  });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Save my defaults" }));
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("40321");
  expect(api.save).not.toHaveBeenCalled();
});

it("does not seed a stale cached value after an unsuccessful fresh read", async () => {
  query.isError = true;
  render(
    <CalendarReminderDefaultsPanel
      calendarId="cal"
      timeZone="Europe/Berlin"
      onDirtyChange={vi.fn()}
      onPendingChange={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "My reminder defaults" })).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(api.refetch).toHaveBeenCalledTimes(1);
});
