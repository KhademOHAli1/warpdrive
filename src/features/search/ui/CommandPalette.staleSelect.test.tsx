// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, useQueryMock, useEquipmentMock, useOperationsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useQueryMock: vi.fn(),
  useEquipmentMock: vi.fn(),
  useOperationsMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    search: {
      query: { useQuery: useQueryMock },
      equipment: { useQuery: useEquipmentMock },
      operations: { useQuery: useOperationsMock },
    },
  },
}));

import { CommandPalette } from "./CommandPalette";
import { OPEN_SEARCH_EVENT } from "./events";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  pushMock.mockClear();
  useQueryMock.mockReset();
  useEquipmentMock.mockReset().mockReturnValue({});
  useOperationsMock.mockReset().mockReturnValue({});
});

const ACME = {
  deals: [],
  people: [],
  organizations: [{ id: "org-1", primary: "Acme Inc", secondary: null }],
  leads: [],
};

function open(): HTMLElement {
  render(<CommandPalette />);
  fireEvent(window, new Event(OPEN_SEARCH_EVENT));
  return screen.getByRole("searchbox", { name: "Search" });
}

function type(input: HTMLElement, text: string, settleDebounce: boolean): void {
  fireEvent.change(input, { target: { value: text } });
  if (settleDebounce) {
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }
}

// Enter used to act on whatever the last resolved query returned. Once the results for a stale
// query are hidden behind the skeleton, acting on them navigates somewhere the user cannot see.
describe("CommandPalette stale selection", () => {
  it("does not navigate to a result that is hidden behind the searching skeleton", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME, error: null });
    const input = open();
    type(input, "Acme", true);
    // The result is on screen and selectable at this point.
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();

    // Refine the query. The debounce has not fired, so "Acme Inc" is now behind a skeleton.
    type(input, "Acme W", false);
    expect(screen.queryByText("Acme Inc")).toBeNull();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not navigate when the search failed", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME, error: { message: "boom" } });
    const input = open();
    type(input, "Acme", true);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("still navigates once the results on screen are the current ones", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME, error: null });
    const input = open();
    type(input, "Acme", true);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/contacts/orgs/org-1");
  });
});

describe("CommandPalette native Operations search", () => {
  const matches = [
    { id: "site-booking", kind: "booking", primary: "Acme reservation", secondary: null },
    { id: "workshop", kind: "location", primary: "Acme workshop", secondary: null },
  ];

  it("enables the separately registered query and opens a checked result by keyboard", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME });
    useOperationsMock.mockReturnValue({ data: matches, fetchStatus: "idle" });
    render(<CommandPalette operationsAvailable />);
    fireEvent(window, new Event(OPEN_SEARCH_EVENT));
    const input = screen.getByRole("searchbox", { name: "Search" });
    type(input, "Acme", true);

    expect(useOperationsMock).toHaveBeenLastCalledWith(
      { q: "Acme" },
      expect.objectContaining({ enabled: true, staleTime: 0 }),
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/assets/bookings?bookingId=site-booking");
  });

  it.each([
    { fetchStatus: "fetching" },
    { fetchStatus: "paused" },
    { fetchStatus: "idle", error: new Error("Current scope could not be checked") },
    { fetchStatus: "idle", isPlaceholderData: true },
  ])("withholds unconfirmed operations results while preserving CRM and Equipment", (state) => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME });
    useEquipmentMock.mockReturnValue({
      data: [{ id: "meter", kind: "asset", primary: "Acme meter", secondary: null }],
    });
    useOperationsMock.mockReturnValue({ data: matches, fetchStatus: "idle" });
    const { rerender } = render(<CommandPalette operationsAvailable equipmentAvailable />);
    fireEvent(window, new Event(OPEN_SEARCH_EVENT));
    const input = screen.getByRole("searchbox", { name: "Search" });
    type(input, "Acme", true);
    expect(screen.getByRole("option", { name: "Acme workshop" })).toBeVisible();

    useOperationsMock.mockReturnValue({ data: matches, ...state });
    rerender(<CommandPalette operationsAvailable equipmentAvailable />);
    expect(screen.queryByRole("group", { name: "Locations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Bookings" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Acme Inc" })).toBeVisible();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/assets?assetId=meter");
  });

  it("does not request Operations without the bootstrap capability", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue({ data: ACME });
    useOperationsMock.mockReturnValue({ data: matches, fetchStatus: "idle" });
    const input = open();
    type(input, "Acme", true);
    expect(useOperationsMock).toHaveBeenLastCalledWith(
      { q: "Acme" },
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.queryByRole("group", { name: "Locations" })).not.toBeInTheDocument();
  });
});
