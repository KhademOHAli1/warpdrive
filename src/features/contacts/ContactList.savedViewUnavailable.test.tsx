// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const query = vi.hoisted(() => ({ people: vi.fn(), orgs: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/contacts/people" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        contacts: { listPeople: { query: query.people }, listOrgs: { query: query.orgs } },
      },
    }),
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("@/features/identity/preferencesActions", () => ({
  setColumnViewAction: vi.fn(),
  setSavedViewSelectionAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("./actions", () => ({
  deletePersonAction: vi.fn(),
  deleteOrgAction: vi.fn(),
  mergePersonsAction: vi.fn(),
  mergeOrgsAction: vi.fn(),
}));
vi.mock("./PeopleTable", () => ({
  toRow: (r: { id: string; name: string }) => ({ ...r, orgName: null }),
  PeopleTable: ({ rows }: { rows: { id: string; name: string }[] }) => (
    <div>
      {rows.map((r) => (
        <span key={r.id}>{r.name}</span>
      ))}
    </div>
  ),
}));
vi.mock("./OrgsTable", () => ({
  OrgsTable: ({ rows }: { rows: { id: string; name: string }[] }) => (
    <div>
      {rows.map((r) => (
        <span key={r.id}>{r.name}</span>
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
            id: "view1",
            name: "Original view",
            favorite: false,
            isOwn: true,
            isShared: false,
            availability: "available",
            definition: {
              combinator: "and",
              conditions: [{ field: "name", op: "contains", value: "Narrow" }],
            },
          })
        }
      >
        Choose narrowed view
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectView({
            id: "view1",
            name: "Original view",
            favorite: false,
            isOwn: true,
            isShared: false,
            availability: "unavailable",
            definition: null,
            problem: { kind: "unsupported", code: "unsupported-version" },
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

import { OrgsList } from "./OrgsList";
import { PeopleList } from "./PeopleList";

const labels = { user: {}, person: {}, org: {} };
const person = {
  id: "p1",
  name: "Unfiltered person",
  primaryEmail: null,
  phone: null,
  orgId: null,
  orgName: null,
  closedDeals: 0,
  customFields: {},
};
const org = {
  id: "o1",
  name: "Unfiltered organization",
  address: null,
  customFields: {},
  peopleCount: 0,
  closedDeals: 0,
  openDeals: 0,
};
afterEach(() => {
  cleanup();
  query.people.mockReset();
  query.orgs.mockReset();
});

for (const kind of ["person", "organization"] as const) {
  test(`${kind} invalid selected view blocks broad reads and hides cached rows until explicit clear`, async () => {
    const read = kind === "person" ? query.people : query.orgs;
    read.mockResolvedValue({ rows: [], total: 0, refLabels: labels });
    render(
      kind === "person" ? (
        <PeopleList rows={[person]} total={2} />
      ) : (
        <OrgsList rows={[org]} total={2} />
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Invalidate selected view" }));
    await act(() => Promise.resolve());
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText(kind === "person" ? person.name : org.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getByText("view1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explicitly show all records" }));
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ filter: undefined, offset: 0 })),
    );
  });

  test(`${kind} valid replacement does not redisplay the previous unfiltered cache while loading`, async () => {
    const read = kind === "person" ? query.people : query.orgs;
    let finish: (value: unknown) => void = () => undefined;
    read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      kind === "person" ? (
        <PeopleList rows={[person]} total={2} />
      ) : (
        <OrgsList rows={[org]} total={2} />
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Invalidate selected view" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose narrowed view" }));
    expect(screen.queryByText(/Unfiltered (person|organization)/)).not.toBeInTheDocument();
    await act(async () => {
      finish({
        rows: [{ ...(kind === "person" ? person : org), id: "narrow", name: "Narrow result" }],
        total: 1,
        refLabels: labels,
      });
      await Promise.resolve();
    });
    expect(screen.getByText("Narrow result")).toBeInTheDocument();
  });

  test(`${kind} ignores a late filtered page after selected-view invalidation`, async () => {
    const read = kind === "person" ? query.people : query.orgs;
    let finish: (value: unknown) => void = () => undefined;
    read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      kind === "person" ? (
        <PeopleList rows={[person]} total={2} />
      ) : (
        <OrgsList rows={[org]} total={2} />
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose narrowed view" }));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Invalidate selected view" }));
    await act(async () => {
      finish({
        rows: [{ ...(kind === "person" ? person : org), id: "late", name: "Late stale row" }],
        total: 1,
        refLabels: labels,
      });
      await Promise.resolve();
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Late stale row")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unfiltered (person|organization)/)).not.toBeInTheDocument();
  });
}
