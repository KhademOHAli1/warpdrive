import { Children, isValidElement, type ReactElement, type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prefs: vi.fn(),
  views: vi.fn(),
  people: vi.fn(),
  orgs: vi.fn(),
  orgOptions: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/db/client", async () => {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return {
    db: drizzle(new Pool({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused" })),
  };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/trpc/context", () => ({ createContext: h.context }));
vi.mock("@/server/trpc/root", () => ({
  createCaller: () => ({
    contacts: { listPeople: h.people, listOrgs: h.orgs, orgOptions: h.orgOptions },
    savedFilters: { listByTarget: h.views },
  }),
}));
vi.mock("@/features/saved-filters/savedFilterList", () => ({
  listCompatibleSavedFilterViews: h.views,
}));
vi.mock("@/features/identity/preferencesForActor", () => ({ getPreferencesForActor: h.prefs }));
vi.mock("@/features/i18n/server", () => ({ getAppTranslations: async () => (key: string) => key }));
vi.mock("@/features/custom-fields/defsRepo", () => ({ listDefs: async () => [] }));
vi.mock("@/features/settings/readBaseCurrency", () => ({ readBaseCurrency: async () => "EUR" }));
vi.mock("@/features/permissions/can", () => ({ can: () => false }));
vi.mock("@/features/contacts/PeopleList", () => ({ PeopleList: () => null }));
vi.mock("@/features/contacts/OrgsList", () => ({ OrgsList: () => null }));
vi.mock("@/features/leads/LeadsInbox", () => ({ LeadsInbox: () => null }));
vi.mock("@/features/contacts/QuickAddContact", () => ({ QuickAddContact: () => null }));

import OrgsPage from "@/app/(app)/contacts/orgs/page";
import PeoplePage from "@/app/(app)/contacts/people/page";
import LeadsPage from "@/app/(app)/leads/page";
import { db } from "@/db/client";

const id = "11111111-1111-4111-8111-111111111111";
const definition = {
  combinator: "and",
  conditions: [{ field: "name", op: "contains", value: "Acme" }],
};
const baseView = {
  id,
  name: "Selected",
  favorite: false,
  isShared: true,
  isOwn: false,
  definition,
};
const preferences = (ui: object) => ({ timezone: null, density: "comfortable", ui });
beforeEach(() => {
  h.context.mockResolvedValue({ actor: { id: "native-actor" }, db });
  h.prefs.mockResolvedValue(preferences({}));
  h.views.mockResolvedValue([]);
  h.people.mockResolvedValue({ rows: [], total: 0, refLabels: { user: {}, person: {}, org: {} } });
  h.orgs.mockResolvedValue({ rows: [], total: 0, refLabels: { user: {}, person: {}, org: {} } });
  h.orgOptions.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

async function contactRegion(
  page: () => Promise<ReactNode>,
): Promise<ReactElement<Record<string, unknown>>> {
  const tree = (await page()) as ReactElement<{ children: ReactNode }>;
  const suspense = Children.toArray(tree.props.children).find(
    (child) => isValidElement(child) && child.type === Suspense,
  ) as ReactElement<{ children: ReactNode }>;
  const child = suspense.props.children as ReactElement<Record<string, unknown>>;
  return await (
    child.type as (props: Record<string, unknown>) => Promise<ReactElement<Record<string, unknown>>>
  )(child.props);
}

for (const target of ["person", "organization"] as const) {
  const page = target === "person" ? PeoplePage : OrgsPage;
  const selectionKey = target === "person" ? "peopleSavedViewSelection" : "orgsSavedViewSelection";
  const baselineKey = target === "person" ? "peopleView" : "orgsView";
  const baseline = target === "person" ? ["name", "phone"] : ["name", "address"];
  const columns = target === "person" ? ["name", "email"] : ["name", "peopleCount"];
  const sort = { field: target === "person" ? "primaryEmail" : "name", dir: "desc" };
  const query = target === "person" ? h.people : h.orgs;

  it(`${target} waits for selection preferences before reading any records`, async () => {
    let release: ((value: unknown) => void) | undefined;
    h.prefs.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = contactRegion(page);
    await vi.waitFor(() => expect(h.prefs).toHaveBeenCalled());
    expect(query).not.toHaveBeenCalled();
    expect(h.orgOptions).not.toHaveBeenCalled();
    release?.(preferences({ [selectionKey]: { version: 1, savedViewId: id } }));
    await pending;
  });

  it(`${target} resolves current visibility and fetches only the selected scope while preserving its personal baseline`, async () => {
    h.prefs.mockResolvedValue(
      preferences({ [selectionKey]: { version: 1, savedViewId: id }, [baselineKey]: baseline }),
    );
    h.views.mockResolvedValue([{ ...baseView, presentation: { version: 1, columns, sort } }]);
    const result = await contactRegion(page);
    expect(h.views).toHaveBeenCalled();
    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ filter: definition, sort }),
    );
    expect(result.props.initialColumns).toEqual(baseline);
    expect(result.props.initialSavedView).toMatchObject({ id, presentation: { columns, sort } });
  });

  it(`${target} retains an inaccessible selected ID without record or row-label lookups`, async () => {
    h.prefs.mockResolvedValue(preferences({ [selectionKey]: { version: 1, savedViewId: id } }));
    const result = await contactRegion(page);
    expect(query).not.toHaveBeenCalled();
    expect(h.orgOptions).not.toHaveBeenCalled();
    expect(result.props.rows).toEqual([]);
    expect(result.props.total).toBe(0);
    expect(result.props.initialSavedView).toMatchObject({ id, availability: "unavailable" });
  });

  it(`${target} blocks a malformed selected preference rather than admitting all records`, async () => {
    h.prefs.mockResolvedValue(
      preferences({ [selectionKey]: { status: "blocked", reason: "invalid-selection" } }),
    );
    const result = await contactRegion(page);
    expect(query).not.toHaveBeenCalled();
    expect(h.orgOptions).not.toHaveBeenCalled();
    expect(result.props.initialSelectionBlocked).toBe(true);
  });
}

it("Leads route seeds a selected view separately from its personal baseline", async () => {
  const personal = { columns: ["title", "createdAt"], sort: { field: "createdAt", dir: "desc" } };
  const view = {
    ...baseView,
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
  h.prefs.mockResolvedValue(
    preferences({ leadsSavedViewSelection: { version: 1, savedViewId: id }, leadsView: personal }),
  );
  h.views.mockResolvedValue([view]);
  const result = (await LeadsPage()) as ReactElement<{
    children: ReactElement<Record<string, unknown>>;
  }>;
  expect(result.props.children.props.initialView).toEqual(personal);
  expect(result.props.children.props.initialSavedView).toEqual(view);
});
