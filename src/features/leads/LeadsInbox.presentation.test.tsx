// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ read: vi.fn(), personal: vi.fn(), selected: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/leads",
}));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/identity/preferencesActions", () => ({
  setLeadsViewAction: h.personal,
  setSavedViewSelectionAction: h.selected,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ lead: { list: { invalidate: vi.fn() } } }),
    lead: { list: { useQuery: h.read } },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    customFields: { listDefs: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("./leadServerActions", () => ({
  archiveLeadAction: vi.fn(),
  bulkUpdateLeadsAction: vi.fn(),
  bulkConvertLeadsAction: vi.fn(),
  convertLeadAction: vi.fn(),
}));
vi.mock("./inbox/LeadsActionBar", () => ({
  LeadsActionBar: ({
    filterBuilder,
    count,
    exportDisabled,
    onToggleColumn,
    order,
    onFilter,
    onLabelKeys,
    onNextActivity,
    owner,
  }: {
    filterBuilder: ReactNode;
    count: number | null;
    exportDisabled: boolean;
    onToggleColumn: (key: string) => void;
    order: readonly string[];
    onFilter: (filter: "inbox" | "archived") => void;
    onLabelKeys: (keys: string[]) => void;
    onNextActivity: (bucket: "today") => void;
    owner: { onChange: (ids: string[]) => void };
  }) => (
    <div>
      {filterBuilder}
      <span data-testid="columns">{JSON.stringify(order)}</span>
      <button type="button" disabled={exportDisabled}>
        Export
      </button>
      <button type="button" onClick={() => onToggleColumn("value")}>
        Edit columns
      </button>
      <button type="button" onClick={() => onFilter("archived")}>
        Use archived
      </button>
      <button type="button" onClick={() => owner.onChange(["owner-id"])}>
        Use owner
      </button>
      <button type="button" onClick={() => onLabelKeys(["label-key"])}>
        Use label
      </button>
      <button type="button" onClick={() => onNextActivity("today")}>
        Use next activity
      </button>
      {count !== null && <span>{count} visible count</span>}
    </div>
  ),
}));
vi.mock("./inbox/LeadsTable", () => ({
  LeadsTable: ({ rows }: { rows: { id: string; title: string }[] }) => (
    <div>
      {rows.map((row) => (
        <span key={row.id}>{row.title}</span>
      ))}
    </div>
  ),
}));
vi.mock("./inbox/LeadFilterBuilder", () => ({
  LeadFilterBuilder: ({ onApply }: { onApply: (condition: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onApply({
          combinator: "and",
          conditions: [{ field: "title", op: "contains", value: "Edited" }],
        })
      }
    >
      Edit condition
    </button>
  ),
}));
vi.mock("@/features/saved-filters/SavedViewControl", () => ({
  SavedViewControl: ({
    onSelectView,
    selectedViewId,
    presentationCapture,
  }: {
    onSelectView: (view: unknown) => void;
    selectedViewId: string | null;
    presentationCapture?: { ok: boolean; error?: string };
  }) => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Full lead view",
      favorite: false,
      isShared: false,
      isOwn: true,
      definition: {
        combinator: "and",
        conditions: [{ field: "title", op: "contains", value: "Acme" }],
      },
      presentation: {
        version: 1,
        columns: ["title", "owner"],
        sort: { field: "ownerName", dir: "asc" },
      },
    };
    return (
      <div>
        <span data-testid="selected">{selectedViewId ?? "personal"}</span>
        <span data-testid="capture">
          {presentationCapture?.ok === true ? "ready" : presentationCapture?.error}
        </span>
        <button type="button" onClick={() => onSelectView(base)}>
          Apply full view
        </button>
        <button
          type="button"
          onClick={() =>
            onSelectView({
              ...base,
              id: "22222222-2222-4222-8222-222222222222",
              presentation: undefined,
            })
          }
        >
          Apply legacy view
        </button>
        <button type="button" onClick={() => onSelectView(null)}>
          Clear selected view
        </button>
      </div>
    );
  },
}));

import { LeadsInbox } from "./LeadsInbox";

const initialView = {
  columns: ["title", "createdAt"],
  sort: { field: "createdAt" as const, dir: "desc" as const },
};
const unavailable = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Removed view",
  favorite: false,
  isShared: false,
  isOwn: true,
  availability: "unavailable" as const,
  definition: null,
  problem: { kind: "missing" as const, code: "missing" },
};
beforeEach(() => {
  h.read.mockReturnValue({
    data: {
      rows: [{ id: "cached", title: "Cached lead" }],
      total: 250,
      refLabels: { user: {}, person: {}, org: {} },
    },
    dataUpdatedAt: 1,
    isPlaceholderData: false,
  });
  h.personal.mockResolvedValue({ ok: true });
  h.selected.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("applies a lead presentation with its condition in every subsequent query", () => {
  render(<LeadsInbox initialView={initialView} />);
  h.read.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  expect(screen.getByTestId("columns")).toHaveTextContent('["title","owner"]');
  for (const [input] of h.read.mock.calls)
    expect(input).toMatchObject({
      sort: { field: "ownerName", dir: "asc" },
      filters: { condition: { conditions: [{ field: "title", op: "contains", value: "Acme" }] } },
    });
});

it("detaches an edited condition without restoring the personal layout, and Clear restores it", async () => {
  const mounted = render(<LeadsInbox initialView={initialView} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit condition" }));
  expect(screen.getByTestId("selected")).toHaveTextContent("personal");
  expect(screen.getByTestId("columns")).toHaveTextContent('["title","owner"]');
  expect(h.read).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: { field: "ownerName", dir: "asc" } }),
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear selected view" }));
  expect(screen.getByTestId("columns")).toHaveTextContent(JSON.stringify(initialView.columns));
  await vi.waitFor(() =>
    expect(h.selected).toHaveBeenLastCalledWith(
      { targetEntity: "lead", savedViewId: null },
      "csrf",
    ),
  );
  mounted.unmount();
  expect(h.personal).not.toHaveBeenCalled();
});

it("blocks an unavailable initial selection before the first query and hides cached rows, counts and export", () => {
  const props = { initialView, initialSavedView: unavailable };
  render(<LeadsInbox {...props} />);
  for (const [, options] of h.read.mock.calls) expect(options).toMatchObject({ enabled: false });
  expect(screen.queryByText("Cached lead")).not.toBeInTheDocument();
  expect(screen.queryByText("250 visible count")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  expect(screen.getByTestId("selected")).toHaveTextContent(unavailable.id);
});

it("blocks malformed initial selection before the first query until explicit Clear", () => {
  const props = { initialView, initialSelectionBlocked: true };
  render(<LeadsInbox {...props} />);
  for (const [, options] of h.read.mock.calls) expect(options).toMatchObject({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: "Clear selected view" }));
  expect(h.read).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: true }),
  );
});

it("serializes rapid A, B, Clear preference writes and reports pending until the last completes", async () => {
  const completions: ((value: { ok: true }) => void)[] = [];
  h.selected.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
  render(<LeadsInbox initialView={initialView} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  await vi.waitFor(() => expect(h.selected).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Apply legacy view" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear selected view" }));
  expect(h.selected).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(/saving/i);
  completions[0]?.({ ok: true });
  await vi.waitFor(() => expect(h.selected).toHaveBeenCalledTimes(2));
  expect(h.selected).toHaveBeenNthCalledWith(
    2,
    { targetEntity: "lead", savedViewId: "22222222-2222-4222-8222-222222222222" },
    "csrf",
  );
  completions[1]?.({ ok: true });
  await vi.waitFor(() => expect(h.selected).toHaveBeenCalledTimes(3));
  expect(h.selected).toHaveBeenNthCalledWith(
    3,
    { targetEntity: "lead", savedViewId: null },
    "csrf",
  );
  expect(screen.getByRole("status")).toHaveTextContent(/saving/i);
  completions[2]?.({ ok: true });
  await vi.waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
});

it("shows a failed selection write instead of claiming durable success", async () => {
  h.selected.mockResolvedValue({ ok: false, error: { id: "E_PERM_001" } });
  render(<LeadsInbox initialView={initialView} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not save|couldn't save/i);
});

it("fences a queued choice when the native actor changes before dispatch", async () => {
  const completions: ((value: { ok: true }) => void)[] = [];
  h.selected.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
  const first = { initialView, preferenceActorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  const mounted = render(<LeadsInbox {...first} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  await vi.waitFor(() => expect(h.selected).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Apply legacy view" }));
  const second = { initialView, preferenceActorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  mounted.rerender(<LeadsInbox {...second} />);
  await act(async () => {
    completions[0]?.({ ok: true });
  });
  expect(h.selected).toHaveBeenCalledTimes(1);
});

it.each(["Use archived", "Use owner", "Use label", "Use next activity"])(
  "refuses saving a scope omitted from the named definition: %s",
  (label) => {
    render(<LeadsInbox initialView={initialView} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByTestId("capture")).toHaveTextContent("unsupported-scope");
  },
);

it("resets the archived tab synchronously when applying a named lead scope", () => {
  render(<LeadsInbox initialView={initialView} />);
  fireEvent.click(screen.getByRole("button", { name: "Use archived" }));
  h.read.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
  expect(h.read).toHaveBeenCalled();
  for (const [input] of h.read.mock.calls)
    expect(input).toMatchObject({
      filter: "inbox",
      sort: { field: "ownerName", dir: "asc" },
      filters: { condition: { conditions: [{ field: "title", op: "contains", value: "Acme" }] } },
    });
});
