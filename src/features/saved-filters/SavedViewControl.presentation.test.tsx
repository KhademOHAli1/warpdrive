// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppTranslator } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { Result } from "@/types/result";
import type { SavedView, SavedViewDefinition } from "./savedView";

const invalidate = vi.fn(() => Promise.resolve());
const listData = vi.fn<() => SavedView[]>(() => []);
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ savedFilters: { listByTarget: { invalidate } } }),
    savedFilters: { listByTarget: { useQuery: () => ({ data: listData() }) } },
  },
}));
const createSavedFilterAction = vi.fn();
vi.mock("./serverActions", () => ({
  createSavedFilterAction: (...args: unknown[]) => createSavedFilterAction(...args),
  toggleFavoriteAction: vi.fn(),
  removeSavedFilterAction: vi.fn(),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { SavedViewControl } from "./SavedViewControl";

const PRESENTATION = {
  version: 1 as const,
  columns: ["name", "email"],
  sort: { field: "name", dir: "asc" as const },
};
type Capture = Result<
  typeof PRESENTATION,
  "unsupported-column" | "unsupported-sort" | "unsupported-scope"
>;
const CAPTURE: Capture = { ok: true, value: PRESENTATION };
const EMPTY: SavedViewDefinition = { combinator: "and", conditions: [] };
const CONDITIONS: SavedViewDefinition = {
  combinator: "and",
  conditions: [{ field: "primaryEmail", op: "contains", value: "acme" }],
};

function control({
  definition = EMPTY,
  capture,
  locale = "en",
  onSelect = vi.fn(),
}: {
  definition?: SavedViewDefinition | null;
  capture?: Capture;
  locale?: Locale;
  onSelect?: (value: unknown) => void;
} = {}) {
  const captureProps = capture === undefined ? {} : { presentationCapture: capture };
  return (
    <LocaleProvider locale={locale}>
      <SavedViewControl
        targetEntity="person"
        allLabel="All people"
        currentDefinition={definition}
        selectedViewId={null}
        onSelectView={onSelect}
        {...captureProps}
      />
    </LocaleProvider>
  );
}
async function openMenu(user: ReturnType<typeof userEvent.setup>, locale: Locale = "en") {
  await user.click(
    screen.getByRole("button", {
      name: createAppTranslator(locale, "tableControls")("savedViews"),
    }),
  );
}
function saveItem(locale: Locale = "en") {
  const label = createAppTranslator(locale, "tableControls")("saveCurrentView");
  return screen.getByRole("menuitem", { name: (name) => name.includes(label) });
}

beforeEach(() =>
  createSavedFilterAction.mockResolvedValue({ ok: true, value: { id: "new-view" } }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listData.mockReturnValue([]);
});

describe("SavedViewControl presentation capture", () => {
  it.each([EMPTY, null])("saves a layout-only view when conditions are %j", async (definition) => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(control({ definition, capture: CAPTURE, onSelect }));
    await openMenu(user);
    expect(saveItem()).not.toHaveAttribute("aria-disabled", "true");
    await user.click(saveItem());
    await user.type(screen.getByLabelText("View name"), "نمای من / Meine Ansicht");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createSavedFilterAction).toHaveBeenCalledWith(
      {
        name: "نمای من / Meine Ansicht",
        targetEntity: "person",
        isShared: false,
        definition: {
          version: 1,
          targetEntity: "person",
          definition: EMPTY,
          presentation: PRESENTATION,
        },
      },
      "csrf",
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-view", definition: EMPTY, presentation: PRESENTATION }),
    );
  });

  it.each([
    ["fa", "unsupported-column", /ستون/],
    ["fa", "unsupported-sort", /مرتب|ترتیب/],
    ["de", "unsupported-column", /Spalte/i],
    ["de", "unsupported-sort", /Sortier/i],
    ["en", "unsupported-column", /column/i],
    ["en", "unsupported-sort", /sort/i],
  ] as const)(
    "blocks %s saves for %s and explains the unsupported layout",
    async (locale, error, explanation) => {
      const user = userEvent.setup();
      render(control({ definition: CONDITIONS, capture: { ok: false, error }, locale }));
      await openMenu(user, locale);
      expect(saveItem(locale)).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText(explanation)).toBeVisible();
      expect(createSavedFilterAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["fa", /جست‌وجو.*فیلتر|جستجو.*فیلتر/],
    ["de", /Suche.*Schnellfilter/i],
    ["en", /clear search or quick filters/i],
  ] as const)(
    "explains unsupported search or quick filters in %s without saving a weaker view",
    async (locale, explanation) => {
      const user = userEvent.setup();
      render(
        control({
          definition: CONDITIONS,
          capture: { ok: false, error: "unsupported-scope" },
          locale,
        }),
      );
      await openMenu(user, locale);
      expect(saveItem(locale)).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText(explanation)).toBeVisible();
      await user.click(saveItem(locale));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(createSavedFilterAction).not.toHaveBeenCalled();
    },
  );

  it("keeps the conditions-only save disabled for an empty definition when capture is absent", async () => {
    const user = userEvent.setup();
    render(control());
    await openMenu(user);
    expect(saveItem()).toHaveAttribute("aria-disabled", "true");
  });

  it("retains the bare conditions-only format when the optional capture is absent", async () => {
    const user = userEvent.setup();
    render(control({ definition: CONDITIONS }));
    await openMenu(user);
    await user.click(saveItem());
    await user.type(screen.getByLabelText("View name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createSavedFilterAction).toHaveBeenCalledWith(
      { name: "Acme", targetEntity: "person", definition: CONDITIONS, isShared: false },
      "csrf",
    );
  });

  it("does not silently drop a capture that becomes unsupported while the dialog is open", async () => {
    const user = userEvent.setup();
    const view = render(control({ definition: CONDITIONS, capture: CAPTURE }));
    await openMenu(user);
    await user.click(saveItem());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    view.rerender(
      control({ definition: CONDITIONS, capture: { ok: false, error: "unsupported-column" } }),
    );
    const save = screen.queryByRole("button", { name: "Save" });
    if (save !== null) expect(save).toBeDisabled();
    expect(screen.getByText(/column/i)).toBeVisible();
    expect(createSavedFilterAction).not.toHaveBeenCalled();
  });
});

it("blocks a malformed saved selection without inventing an ID or claiming all records", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <SavedViewControl
      targetEntity="person"
      allLabel="All people"
      currentDefinition={null}
      selectedViewId={null}
      onSelectView={onSelect}
      {...{ selectionBlocked: true }}
    />,
  );
  expect(screen.queryByRole("alert")).toBeInTheDocument();
  await openMenu(user);
  expect(screen.getByRole("menuitem", { name: "All people" })).not.toHaveAttribute(
    "aria-current",
    "true",
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Show all permitted records" }));
  expect(onSelect).toHaveBeenCalledWith(null);
});

it("revalidates a presentation-only update even when the active conditions are unchanged", () => {
  const selected: SavedView = {
    id: "saved-1",
    name: "Layout",
    favorite: false,
    isShared: false,
    isOwn: true,
    definition: CONDITIONS,
  };
  const updated = { ...selected, presentation: PRESENTATION };
  listData.mockReturnValue([updated]);
  const onSelect = vi.fn();
  render(
    <SavedViewControl
      targetEntity="person"
      allLabel="All people"
      currentDefinition={CONDITIONS}
      selectedViewId={selected.id}
      selectedView={selected}
      onSelectView={onSelect}
    />,
  );
  expect(onSelect).toHaveBeenCalledWith(updated);
});
