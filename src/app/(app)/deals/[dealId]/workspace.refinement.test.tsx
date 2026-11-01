// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Deal } from "@/db/schema";
import type { CalendarActivity } from "@/features/activities/calendar";
import type { HistoryItem } from "@/features/deal-workspace/historyTimeline";
import { WorkspaceTabs } from "./tabs";

const state = vi.hoisted(() => ({ pending: false, failed: false, retry: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      email: {
        listMessagesForDeal: { invalidate: vi.fn() },
        drafts: { listForDeal: { invalidate: vi.fn() } },
      },
    }),
    collaboration: {
      listNotes: {
        useQuery: () => ({
          data: state.pending || state.failed ? undefined : [],
          isPending: state.pending,
          isError: state.failed,
          refetch: state.retry,
        }),
      },
      listChangeLog: { useQuery: () => ({ data: [], refetch: state.retry }) },
    },
    email: {
      listMessagesForDeal: { useQuery: () => ({ data: [] }) },
      drafts: { listForDeal: { useQuery: () => ({ data: [] }) } },
    },
    files: { listForEntity: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("@/features/deal-workspace/HistoryFeed", () => ({
  HistoryFeed: ({ items, emptyLabel }: { items: HistoryItem[]; emptyLabel: string }) =>
    items.length ? (
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.kind === "activity" ? item.activity.subject : item.id}</li>
        ))}
      </ul>
    ) : (
      <p>{emptyLabel}</p>
    ),
}));

afterEach(cleanup);
beforeEach(() => {
  state.pending = false;
  state.failed = false;
  state.retry.mockReset();
});
const deal = { id: "deal", createdAt: new Date("2026-10-01T00:00:00Z") } as Deal;
function activity(id: string, at: string, overdue = false): CalendarActivity {
  return {
    id,
    subject: id,
    dueAt: new Date(at),
    allDay: false,
    durationMinutes: null,
    typeKey: "call",
    done: false,
    dealId: "deal",
    personId: null,
    orgId: null,
    ownerName: "Alex",
    overdue,
  };
}
function show(
  activities: CalendarActivity[] = [],
  readState: "pending" | "error" | "success" = "success",
  retry = vi.fn(),
) {
  return render(
    <WorkspaceTabs
      deal={deal}
      tab="all"
      onTab={() => {}}
      activities={activities}
      stages={[]}
      createdActorName="Alex"
      activityReadState={readState}
      onRetryActivities={retry}
    />,
  );
}

it("shows overdue work before the earliest upcoming work without reordering history", () => {
  show([
    activity("Later", "2026-11-10"),
    activity("Next", "2026-11-03"),
    activity("Overdue", "2026-10-30", true),
  ]);
  const focus = screen.getByRole("region", { name: /Focus|Next actions/i });
  expect(
    within(focus)
      .getAllByRole("listitem")
      .map((row) => row.textContent),
  ).toEqual(["Overdue", "Next", "Later"]);
});

it("keeps the initial action list short and lets the user reveal every action", () => {
  show(
    Array.from({ length: 6 }, (_, n) =>
      activity(`Call ${n}`, `2026-11-${String(n + 2).padStart(2, "0")}`),
    ),
  );
  const focus = screen.getByRole("region", { name: /Focus|Next actions/i });
  expect(within(focus).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(within(focus).getByRole("button", { name: /View all 6/i }));
  expect(within(focus).getAllByRole("listitem")).toHaveLength(6);
});

it("never reports no work while the activity read is pending", () => {
  show([], "pending");
  expect(screen.getByRole("status")).toHaveTextContent(/Loading activities/i);
  expect(screen.queryByText(/Nothing needs your attention/i)).not.toBeInTheDocument();
});

it("allows retry after a failed activity read without claiming there is no work", () => {
  const retry = vi.fn();
  show([], "error", retry);
  const focus = screen.getByRole("region", { name: /Focus|Next actions/i });
  fireEvent.click(within(focus).getByRole("button", { name: /Retry/i }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Nothing needs your attention/i)).not.toBeInTheDocument();
});

it("shows pending and failed note reads instead of presenting an empty history", () => {
  state.pending = true;
  const view = show();
  expect(screen.getByRole("status")).toHaveTextContent(/Loading history/i);
  state.pending = false;
  state.failed = true;
  view.rerender(
    <WorkspaceTabs
      deal={deal}
      tab="all"
      onTab={() => {}}
      activities={[]}
      stages={[]}
      createdActorName="Alex"
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/history/i);
  fireEvent.click(screen.getByRole("button", { name: /Retry history/i }));
  expect(state.retry).toHaveBeenCalled();
});

it("offers scheduling directly from a successfully loaded empty next-action area", () => {
  const schedule = vi.fn();
  render(
    <WorkspaceTabs
      deal={deal}
      tab="all"
      onTab={() => {}}
      activities={[]}
      stages={[]}
      createdActorName="Alex"
      onScheduleActivity={schedule}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Schedule activity" }));
  expect(schedule).toHaveBeenCalledOnce();
  expect(screen.getByText("No next action scheduled.")).toBeInTheDocument();
});

it.each(["pending", "failed"])(
  "does not claim the Notes tab is empty when its read is %s",
  (status) => {
    state.pending = status === "pending";
    state.failed = status === "failed";
    render(
      <WorkspaceTabs
        deal={deal}
        tab="notes"
        onTab={() => {}}
        activities={[]}
        stages={[]}
        createdActorName="Alex"
      />,
    );
    expect(screen.queryByText(/^No notes/i)).not.toBeInTheDocument();
  },
);
