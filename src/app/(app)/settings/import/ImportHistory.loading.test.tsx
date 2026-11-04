// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import type { BatchSummary } from "@/features/import/results";

const { query, retry, undo, report } = vi.hoisted(() => ({
  query: vi.fn(),
  retry: vi.fn(),
  undo: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ import: { listBatches: { invalidate: vi.fn() } } }),
    import: { listBatches: { useQuery: () => query() } },
  },
}));
vi.mock("@/features/import/actions", () => ({ undoImportAction: undo }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import { ImportHistory } from "./ImportHistory";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

it("does not describe a pending history read as no imports", () => {
  query.mockReturnValue({ data: undefined, isError: false, refetch: retry });
  render(<ImportHistory />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading import history");
  expect(screen.queryByText("No imports yet.")).not.toBeInTheDocument();
});

it("shows a retryable read error instead of an empty history", () => {
  query.mockReturnValue({ data: undefined, isError: true, refetch: retry });
  render(<ImportHistory />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load these import details");
  expect(screen.queryByText("No imports yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

const fixtureBatch: BatchSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  filename: "fixture-people.csv",
  targetEntity: "person",
  status: "completed",
  totalRows: 3,
  importedRows: 3,
  errorRows: 0,
  warnedRows: 0,
  createdAt: new Date("2026-11-01T12:00:00Z"),
  undoneAt: null,
};
const locales = ["en", "de", "fa"] as const;
const cases = locales.flatMap((locale) =>
  (["empty", "rows"] as const).map((outcome) => ({ locale, outcome })),
);

function content(locale: Locale) {
  return (
    <LocaleProvider locale={locale}>
      <ImportHistory />
    </LocaleProvider>
  );
}

it.each(cases)(
  "keeps cached empty history unavailable until a retry confirms $outcome in $locale",
  ({ locale, outcome }) => {
    const L = settingsMessagesForLocale(locale);
    const J = L._extra.importJourney;
    const IMP = L.importer;
    query.mockReturnValue({ data: [], isError: true, isFetching: false, refetch: retry });
    const view = render(content(locale));
    expect(screen.getByRole("alert")).toHaveTextContent(J.loadFailed);
    expect(screen.queryByText(IMP.historyEmpty)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: J.retry }));
    expect(retry).toHaveBeenCalledTimes(1);

    // A retry may retain the preceding error while the cached empty array remains present.
    query.mockReturnValue({ data: [], isError: true, isFetching: true, refetch: retry });
    view.rerender(content(locale));
    expect(screen.getByRole("alert")).toHaveTextContent(J.loadFailed);
    const retryButton = screen.getByRole("button", { name: J.retry });
    expect(retryButton).toBeDisabled();
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(IMP.historyEmpty)).not.toBeInTheDocument();

    // Clearing the error flag alone is not a newly confirmed empty result while fetching.
    query.mockReturnValue({ data: [], isError: false, isFetching: true, refetch: retry });
    view.rerender(content(locale));
    expect(screen.getByRole("status")).toHaveTextContent(J.loadingHistory);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(IMP.historyEmpty)).not.toBeInTheDocument();

    const data = outcome === "empty" ? [] : [fixtureBatch];
    query.mockReturnValue({ data, isError: false, isFetching: false, refetch: retry });
    view.rerender(content(locale));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    if (outcome === "empty") {
      expect(screen.getByText(IMP.historyEmpty)).toBeVisible();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(fixtureBatch.filename)).toBeVisible();
      expect(screen.queryByText(IMP.historyEmpty)).not.toBeInTheDocument();
      const undoButton = screen.getByRole("button", { name: IMP.undo });
      expect(undoButton).toBeEnabled();
      // Nonempty cached records keep their existing action behavior during a later read error.
      query.mockReturnValue({ data, isError: true, isFetching: false, refetch: retry });
      view.rerender(content(locale));
      expect(screen.getByRole("alert")).toHaveTextContent(J.loadFailed);
      expect(screen.getByText(fixtureBatch.filename)).toBeVisible();
      expect(undoButton).toBeInTheDocument();
      expect(undoButton).toBeEnabled();
      expect(screen.queryByText(IMP.historyEmpty)).not.toBeInTheDocument();
    }
    expect(retry).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
  },
);
