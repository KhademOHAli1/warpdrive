// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  people: vi.fn(),
  orgs: vi.fn(),
  personal: vi.fn(),
  selected: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/contacts/people" }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/identity/preferencesActions", () => ({
  setColumnViewAction: h.personal,
  setSavedViewSelectionAction: h.selected,
}));
vi.mock("./actions", () => ({ deletePersonAction: vi.fn(), deleteOrgAction: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      client: { contacts: { listPeople: { query: h.people }, listOrgs: { query: h.orgs } } },
    }),
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("@/components/data-table/ColumnsMenu", () => ({
  ColumnsMenu: ({
    order,
    onToggle,
  }: {
    order: readonly string[];
    onToggle: (key: string) => void;
  }) => (
    <div>
      <span data-testid="columns">{JSON.stringify(order)}</span>
      <button type="button" onClick={() => onToggle("closedDeals")}>
        Edit columns
      </button>
    </div>
  ),
}));
vi.mock("@/features/saved-filters/SavedViewControl", () => ({
  SavedViewControl: ({
    targetEntity,
    onSelectView,
    selectedViewId,
    presentationCapture,
  }: {
    targetEntity: string;
    onSelectView: (view: unknown) => void;
    selectedViewId: string | null;
    presentationCapture?: { ok: boolean; error?: string };
  }) => {
    const definition = {
      combinator: "and",
      conditions: [{ field: "name", op: "contains", value: "Acme" }],
    };
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Full",
      favorite: false,
      isShared: false,
      isOwn: true,
      definition,
    };
    return (
      <div>
        <span data-testid="selected">{selectedViewId ?? "personal"}</span>
        <span data-testid="capture">
          {presentationCapture?.ok === true ? "ready" : presentationCapture?.error}
        </span>
        <button
          type="button"
          onClick={() =>
            onSelectView({
              ...base,
              presentation: {
                version: 1,
                columns: targetEntity === "person" ? ["name", "email"] : ["name", "peopleCount"],
                sort: { field: targetEntity === "person" ? "primaryEmail" : "name", dir: "desc" },
              },
            })
          }
        >
          Apply full view
        </button>
        <button
          type="button"
          onClick={() =>
            onSelectView({
              ...base,
              id: "22222222-2222-4222-8222-222222222222",
              name: "Conditions only",
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

import { OrgsList } from "./OrgsList";
import { PeopleList } from "./PeopleList";

const person = {
  id: "p1",
  name: "Acme person",
  primaryEmail: "p@acme.test",
  phone: "123",
  orgId: null,
  orgName: null,
  closedDeals: 0,
  customFields: {},
};
const org = {
  id: "o1",
  name: "Acme org",
  address: "Street",
  closedDeals: 0,
  openDeals: 0,
  peopleCount: 1,
  customFields: {},
};
const refs = { user: {}, person: {}, org: {} };
beforeEach(() => {
  h.people.mockResolvedValue({
    rows: [{ ...person, phones: [{ value: "123", primary: true }] }],
    total: 1,
    refLabels: refs,
  });
  h.orgs.mockResolvedValue({ rows: [org], total: 1, refLabels: refs });
  h.personal.mockResolvedValue({ ok: true });
  h.selected.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(["person", "organization"] as const)(
  "%s named presentation integration",
  (target) => {
    const baseline = target === "person" ? ["name", "phone"] : ["name", "address"];
    const layout = target === "person" ? ["name", "email"] : ["name", "peopleCount"];
    const query = target === "person" ? h.people : h.orgs;
    function mount() {
      return render(
        target === "person" ? (
          <PeopleList rows={[person]} total={1} initialColumns={baseline} />
        ) : (
          <OrgsList rows={[org]} total={1} initialColumns={baseline} />
        ),
      );
    }

    it("applies filter, columns and sort in one query scope", async () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
      expect(screen.getByTestId("columns")).toHaveTextContent(JSON.stringify(layout));
      await vi.waitFor(() => expect(query).toHaveBeenCalled());
      for (const [input] of query.mock.calls)
        expect(input).toMatchObject({
          filter: { conditions: [{ field: "name", op: "contains", value: "Acme" }] },
          sort: { field: target === "person" ? "primaryEmail" : "name", dir: "desc" },
        });
    });

    it("switches to a legacy view using the original personal baseline, then Clear restores it", async () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
      expect(screen.getByTestId("columns")).toHaveTextContent(JSON.stringify(layout));
      fireEvent.click(screen.getByRole("button", { name: "Apply legacy view" }));
      expect(screen.getByTestId("columns")).toHaveTextContent(JSON.stringify(baseline));
      await vi.waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(
          expect.objectContaining({ sort: { field: "name", dir: "asc" } }),
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Clear selected view" }));
      expect(screen.getByTestId("columns")).toHaveTextContent(JSON.stringify(baseline));
      expect(screen.getByTestId("selected")).toHaveTextContent("personal");
      await vi.waitFor(() =>
        expect(h.selected).toHaveBeenLastCalledWith(
          { targetEntity: target, savedViewId: null },
          "csrf",
        ),
      );
    });

    it("a local column edit detaches identity while keeping view mode and protects personal persistence", () => {
      const mounted = mount();
      fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit columns" }));
      expect(screen.getByTestId("selected")).toHaveTextContent("personal");
      mounted.unmount();
      expect(h.personal).not.toHaveBeenCalled();
    });

    it("persists the selected ID separately from the personal layout", async () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
      await vi.waitFor(() =>
        expect(h.selected).toHaveBeenCalledWith(
          { targetEntity: target, savedViewId: "11111111-1111-4111-8111-111111111111" },
          "csrf",
        ),
      );
      expect(h.personal).not.toHaveBeenCalled();
    });

    it("replaces a previous search when applying the named scope", async () => {
      mount();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Previous search" } });
      await vi.waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "Previous search" }),
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Apply full view" }));
      expect(screen.getByRole("searchbox")).toHaveValue("");
      await vi.waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined })),
      );
    });

    it("refuses saving an unapplied search draft as a broader named scope", () => {
      mount();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Not yet applied" } });
      expect(screen.getByTestId("capture")).toHaveTextContent("unsupported-scope");
    });

    it("refuses saving while an applied search is settling toward an empty draft", async () => {
      mount();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Applied search" } });
      await vi.waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "Applied search" }),
        ),
      );
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
      expect(screen.getByTestId("capture")).toHaveTextContent("unsupported-scope");
    });
  },
);
