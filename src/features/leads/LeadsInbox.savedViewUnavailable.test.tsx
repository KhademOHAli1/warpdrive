// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const list = vi.hoisted(() => ({ read: vi.fn(), exportHref: vi.fn(() => "/api/leads/export") }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ lead: { list: { invalidate: vi.fn(async () => {}) } } }),
    lead: { list: { useQuery: (...args: unknown[]) => list.read(...args) } },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    customFields: { listDefs: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("@/features/identity/preferencesActions", () => ({
  setLeadsViewAction: vi.fn(),
  setSavedViewSelectionAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./inbox/exportHref", () => ({ buildLeadExportHref: list.exportHref }));
vi.mock("./leadServerActions", () => ({
  archiveLeadAction: vi.fn(),
  bulkUpdateLeadsAction: vi.fn(),
  bulkConvertLeadsAction: vi.fn(),
  convertLeadAction: vi.fn(),
}));
vi.mock("./inbox/LeadsActionBar", () => ({
  LeadsActionBar: ({
    filterBuilder,
    onExport,
    exportDisabled,
    count,
  }: {
    filterBuilder: ReactNode;
    onExport: () => void;
    exportDisabled: boolean;
    count: number | null;
  }) => (
    <div>
      {filterBuilder}
      <button type="button" onClick={onExport} disabled={exportDisabled}>
        Export
      </button>
      {count !== null && <span>{count} visible count</span>}
    </div>
  ),
}));
vi.mock("./inbox/LeadsTable", () => ({
  LeadsTable: ({ rows }: { rows: { id: string; title: string }[] }) => (
    <div>
      {rows.map((r) => (
        <span key={r.id}>{r.title}</span>
      ))}
    </div>
  ),
}));
vi.mock("@/features/saved-filters/SavedViewControl", () => ({
  SavedViewControl: ({
    onSelectView,
    selectedViewId,
  }: {
    onSelectView: (view: unknown) => void;
    selectedViewId: string | null;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSelectView({
            id: "v",
            name: "نظر مشتری",
            favorite: false,
            isShared: true,
            isOwn: false,
            availability: "unavailable",
            definition: null,
            problem: { kind: "missing", code: "missing" },
          })
        }
      >
        Invalidate selected view
      </button>
      <button type="button" onClick={() => onSelectView(null)}>
        Explicitly show all records
      </button>
      <span>{selectedViewId}</span>
    </div>
  ),
}));

import { LeadsInbox } from "./LeadsInbox";

const page = {
  rows: [{ id: "cached", title: "Cached lead" }],
  total: 250,
  refLabels: { user: {}, person: {}, org: {} },
};
afterEach(() => {
  cleanup();
  list.read.mockReset();
  list.exportHref.mockClear();
});

test("lead unavailable selection reaches query gate and suppresses cached table, count, paging and export", () => {
  list.read.mockReturnValue({ data: page, dataUpdatedAt: 1, isPlaceholderData: false });
  render(<LeadsInbox />);
  expect(screen.getByText("Cached lead")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Invalidate selected view" }));
  expect(list.read).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: false }),
  );
  expect(screen.queryByText("Cached lead")).not.toBeInTheDocument();
  expect(screen.queryByText("250 visible count")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(list.exportHref).not.toHaveBeenCalled();
  expect(screen.getByText("v")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Explicitly show all records" }));
  expect(list.read).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: true }),
  );
  expect(screen.getByRole("button", { name: "Export" })).not.toBeDisabled();
});
