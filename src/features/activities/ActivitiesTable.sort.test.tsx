// @vitest-environment jsdom
// Sort-header behavior extracted from ActivitiesTable.test.tsx to keep both files under the
// project's file-size budget: this file owns the header-click-to-sort contract (which server
// sort field/direction each header click requests) and the day-grouping reconciliation (day
// headers only make sense for a date-ordered list), while ActivitiesTable.test.tsx owns
// rendering, ActivitiesTable.filters.test.tsx owns the filter toolbar, and
// ActivitiesTable.selection.test.tsx owns selection and bulk actions.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/activities",
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const refetch = vi.fn();
const useQuery = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: () => Promise.resolve() },
        listRows: { invalidate: () => Promise.resolve() },
      },
    }),
    activities: {
      listRows: { useQuery: (input?: unknown, opts?: unknown) => useQuery(input, opts) },
      listTypes: { useQuery: () => ({ data: [{ id: "t1", key: "call", name: "Call" }] }) },
    },
    identity: {
      assignableUsers: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("./AddActivityModal", () => ({
  AddActivityModal: () => <div data-testid="activity-modal" />,
}));
vi.mock("./ActivityEditModal", () => ({
  ActivityEditModal: () => <div data-testid="edit-modal" />,
}));
vi.mock("./actions", () => ({
  completeActivityAction: vi.fn(() => Promise.resolve({ ok: true, value: { id: "a1" } })),
  deleteActivityAction: vi.fn(() => Promise.resolve({ ok: true, value: { id: "a1" } })),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "tok" }));

import { ActivitiesTable } from "./ActivitiesTable";

// Without a provider the account fallback is UTC. Only sort field/direction varies below.
const DEFAULT_FILTER = {
  ownerId: "me",
  done: "open",
  from: "2026-07-08",
  to: "2026-07-08",
  typeKey: null,
  timeZone: "UTC",
};

function row(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    subject: "Call Jane",
    typeKey: "call",
    priority: "high",
    done: false,
    dueAtIso: null,
    dealId: null,
    dealTitle: null,
    leadId: null,
    leadTitle: null,
    personId: "pe1",
    personName: "Jane Roe",
    personEmail: "jane@acme.com",
    personPhone: "+14155550100",
    orgId: null,
    orgName: "Acme Inc",
    durationMinutes: null,
    assigneeId: "u1",
    assigneeName: "",
    ownerName: "",
    ...overrides,
  };
}

describe("ActivitiesTable sort headers", () => {
  it("clicking the Subject header re-queries listRows with the new sort", () => {
    useQuery.mockReturnValue({ data: [row({})], refetch });
    render(<ActivitiesTable currentUserId="me" />);
    fireEvent.click(screen.getByRole("button", { name: "Subject" }));
    expect(useQuery).toHaveBeenLastCalledWith(
      { ...DEFAULT_FILTER, sort: { field: "subject", dir: "asc" } },
      { enabled: true },
    );
  });

  it("clicking the Duration header re-queries listRows with the new sort", () => {
    useQuery.mockReturnValue({ data: [row({})], refetch });
    render(<ActivitiesTable currentUserId="me" />);
    fireEvent.click(screen.getByRole("button", { name: "Duration" }));
    expect(useQuery).toHaveBeenLastCalledWith(
      { ...DEFAULT_FILTER, sort: { field: "duration", dir: "asc" } },
      { enabled: true },
    );
  });

  it("cycles the Duration header asc to desc to the default sort on repeated clicks", () => {
    useQuery.mockReturnValue({ data: [row({})], refetch });
    render(<ActivitiesTable currentUserId="me" />);
    const header = screen.getByRole("button", { name: "Duration" });
    fireEvent.click(header);
    expect(useQuery).toHaveBeenLastCalledWith(
      { ...DEFAULT_FILTER, sort: { field: "duration", dir: "asc" } },
      { enabled: true },
    );
    fireEvent.click(header);
    expect(useQuery).toHaveBeenLastCalledWith(
      { ...DEFAULT_FILTER, sort: { field: "duration", dir: "desc" } },
      { enabled: true },
    );
    fireEvent.click(header);
    expect(useQuery).toHaveBeenLastCalledWith(
      { ...DEFAULT_FILTER, sort: { field: "dueAtIso", dir: "asc" } },
      { enabled: true },
    );
  });
});

describe("ActivitiesTable day-grouping reconciliation", () => {
  it("groups rows under day headers when the default (date) sort is active", () => {
    useQuery.mockReturnValue({
      data: [
        row({ id: "a1", subject: "Call Jane", dueAtIso: "2026-07-04T09:00:00.000Z" }),
        row({ id: "a2", subject: "Call Bob", dueAtIso: "2026-07-05T09:00:00.000Z" }),
      ],
      refetch,
    });
    render(<ActivitiesTable currentUserId="me" />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });

  it("suppresses day-grouping (flat list) when a non-date sort, e.g. Duration, is active", () => {
    useQuery.mockReturnValue({
      data: [
        row({ id: "a1", subject: "Call Jane", dueAtIso: "2026-07-04T09:00:00.000Z" }),
        row({ id: "a2", subject: "Call Bob", dueAtIso: "2026-07-05T09:00:00.000Z" }),
      ],
      refetch,
    });
    render(<ActivitiesTable currentUserId="me" />);
    fireEvent.click(screen.getByRole("button", { name: "Duration" }));
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getByText("Call Jane")).toBeInTheDocument();
    expect(screen.getByText("Call Bob")).toBeInTheDocument();
  });
});
