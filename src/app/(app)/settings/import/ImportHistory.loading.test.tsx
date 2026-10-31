// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { query, retry } = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ import: { listBatches: { invalidate: vi.fn() } } }),
    import: { listBatches: { useQuery: () => query() } },
  },
}));
vi.mock("@/features/import/actions", () => ({ undoImportAction: vi.fn() }));

import { ImportHistory } from "./ImportHistory";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
