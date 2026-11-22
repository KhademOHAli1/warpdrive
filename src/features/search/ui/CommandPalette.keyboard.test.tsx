// @vitest-environment jsdom
// Keyboard-navigation behavior for the command palette, split out of
// CommandPalette.test.tsx (which covers rendering/selection) to keep both
// files under the project's line-count limit.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const { pushMock, useQueryMock, useEquipmentMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useQueryMock: vi.fn(),
  useEquipmentMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    search: {
      query: {
        useQuery: useQueryMock,
      },
      equipment: { useQuery: useEquipmentMock },
    },
  },
}));

import type { SearchResults } from "@/types/search";
import { CommandPalette } from "./CommandPalette";
import type { EquipmentSearchEntry } from "./equipmentFixture";
import { OPEN_SEARCH_EVENT } from "./events";

const EMPTY_RESULTS: SearchResults = { deals: [], people: [], organizations: [], leads: [] };

// Sets the data the mocked trpc.search.query.useQuery hook returns on its
// next call. The mock ignores its input args, so tests only need to control
// the shape of the response, not the query string routing.
function setResults(results: SearchResults) {
  useQueryMock.mockReturnValue({ data: results });
}

beforeEach(() => {
  pushMock.mockClear();
  setResults(EMPTY_RESULTS);
  useEquipmentMock.mockReset().mockReturnValue({});
  vi.useFakeTimers();
});

// Opens the palette, types a query, and advances past the debounce so the
// results list (rather than the idle placeholder) is rendered.
function openAndSearch(
  query: string,
  fixtureEquipment?: readonly EquipmentSearchEntry[],
  equipmentAvailable?: boolean,
) {
  render(
    <CommandPalette fixtureEquipment={fixtureEquipment} equipmentAvailable={equipmentAvailable} />,
  );
  fireEvent(window, new Event(OPEN_SEARCH_EVENT));
  const input = screen.getByRole("searchbox", { name: "Search" });
  fireEvent.change(input, { target: { value: query } });
  act(() => {
    vi.advanceTimersByTime(200);
  });
  return input;
}

describe("CommandPalette keyboard navigation", () => {
  const MIXED_RESULTS: SearchResults = {
    deals: [{ id: "d1", primary: "Deal A", secondary: null }],
    people: [],
    organizations: [],
    leads: [{ id: "l1", primary: "Lead B", secondary: null }],
  };

  it("queries native equipment only when available and opens an exact kit", () => {
    setResults(MIXED_RESULTS);
    useEquipmentMock.mockReturnValue({
      data: [{ id: "kit", kind: "kit", primary: "Bench kit", secondary: "BENCH-1" }],
    });
    const input = openAndSearch("Bench", undefined, true);
    expect(useEquipmentMock).toHaveBeenLastCalledWith(
      { q: "Bench" },
      expect.objectContaining({ enabled: true, staleTime: 0 }),
    );
    expect(screen.getByRole("group", { name: "Equipment" })).toHaveTextContent("Bench kit");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/assets?kitId=kit");
  });

  it.each([{ isFetching: true }, { error: new Error("Current grants could not be loaded") }])(
    "withholds prior equipment results during revalidation or an error",
    (state) => {
      setResults(MIXED_RESULTS);
      useEquipmentMock.mockReturnValue({
        data: [{ id: "kit", kind: "kit", primary: "Private kit", secondary: "BENCH-1" }],
        ...state,
      });
      openAndSearch("Bench", undefined, true);
      expect(screen.queryByRole("group", { name: "Equipment" })).not.toBeInTheDocument();
      screen.getByText("Deal A").click();
      expect(pushMock).toHaveBeenCalledWith("/deals/d1");
    },
  );

  it("moves the active row with arrow keys and selects it with Enter", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> Deal A (already first)
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> Lead B
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/leads/l1");
  });

  it("clamps at the first row when ArrowUp is pressed with nothing above it", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/deals/d1");
  });

  it("clamps at the last row when ArrowDown is pressed past the end", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/leads/l1");
  });

  it("highlights the active row visually as the selection moves", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getByText("Lead B").closest("button")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Deal A").closest("button")).toHaveAttribute("aria-selected", "false");
  });

  it("resets the active index to the first row when the result set changes size", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> Lead B (index 1 of 2)

    // A new query collapses the result set to a single row; the stale
    // index (1) would be out of bounds, so it must reset to 0.
    setResults({
      deals: [{ id: "d3", primary: "Only Deal", secondary: null }],
      people: [],
      organizations: [],
      leads: [],
    });
    fireEvent.change(input, { target: { value: "y" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/deals/d3");
  });

  it("resets the active index to the top when the results change content at the same length", () => {
    setResults(MIXED_RESULTS); // [Deal A, Lead B], 2 rows
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> Lead B (index 1 of 2)

    // A new query returns a DIFFERENT set of rows, but the same count (2).
    // Length-only reset logic would leave the stale index (1) pointing at
    // the new second row instead of resetting to the top.
    setResults({
      deals: [{ id: "d9", primary: "New Deal", secondary: null }],
      people: [],
      organizations: [],
      leads: [{ id: "l9", primary: "New Lead", secondary: null }],
    });
    fireEvent.change(input, { target: { value: "y" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("New Deal").closest("button")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/deals/d9");
  });

  it("preserves Escape closing the palette", () => {
    setResults(MIXED_RESULTS);
    const input = openAndSearch("x");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates equipment and lets keyboard navigation reach an exact asset after CRM results", () => {
    setResults({
      ...EMPTY_RESULTS,
      leads: [{ id: "l1", primary: "Signal lead", secondary: null }],
    });
    const assets = [
      { id: "asset10", name: "Signal generator", code: "SIGNAL-10", serial: "SG-10" },
      { id: "asset2", name: "Signal generator", code: "SIGNAL-02", serial: "SG-2" },
    ];
    const input = openAndSearch("sg-2", assets);
    expect(screen.getByRole("group", { name: "Equipment" })).toBeVisible();
    expect(screen.queryByText("SIGNAL-10 · SG-10")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/assets?assetId=asset2");
  });

  it("omits the equipment group unless fixture data was supplied", () => {
    openAndSearch("signal");
    expect(screen.queryByRole("group", { name: "Equipment" })).not.toBeInTheDocument();
  });
});
