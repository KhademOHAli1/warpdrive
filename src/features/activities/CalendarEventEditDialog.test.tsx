// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarEventEditDialog } from "./CalendarEventEditDialog";

const state = vi.hoisted(() => ({
  query: {
    data: undefined as { id: string; allDay: boolean; assigneeId: string } | undefined,
    isFetching: true,
    isFetchedAfterMount: false,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  },
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { activities: { getForEdit: { useQuery: () => state.query } } },
}));
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
afterEach(() => {
  cleanup();
  Object.assign(state.query, {
    data: undefined,
    isFetching: true,
    isFetchedAfterMount: false,
    isError: false,
    isSuccess: false,
  });
});

it("waits for a fresh visibility-checked read even if an old record is cached", () => {
  state.query.data = { id: "a1", allDay: false, assigneeId: "stale-assignee" };
  render(<CalendarEventEditDialog id="a1" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByTestId("loaded-event")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Opening event");
});

it("keeps an open draft mounted when a later refresh fails", () => {
  Object.assign(state.query, {
    data: { id: "a1", allDay: true, assigneeId: "assigned-user" },
    isFetching: false,
    isFetchedAfterMount: true,
    isSuccess: true,
  });
  const { rerender } = render(
    <CalendarEventEditDialog id="a1" onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  expect(screen.getByTestId("loaded-event")).toHaveTextContent("a1,true,assigned-user");
  Object.assign(state.query, { isError: true, isSuccess: false });
  rerender(<CalendarEventEditDialog id="a1" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByTestId("loaded-event")).toHaveTextContent("a1,true,assigned-user");
});

it("does not show cached data after an initial read fails", () => {
  Object.assign(state.query, {
    data: { id: "a1", allDay: true, assigneeId: "private-user" },
    isFetching: false,
    isFetchedAfterMount: true,
    isError: true,
  });
  render(<CalendarEventEditDialog id="a1" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByTestId("loaded-event")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
