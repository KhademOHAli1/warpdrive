// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { query, retry } = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { import: { getBatch: { useQuery: () => query() } } },
}));
vi.mock("@/features/import/useImportProgress", () => ({
  useImportProgress: () => ({ processed: 0, total: 0, status: null }),
}));

import { PhaseWait } from "./PhaseWait";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("makes a failed progress read retryable without treating it as a failed import", () => {
  query.mockReturnValue({ data: undefined, isError: true, refetch: retry });
  const onError = vi.fn();
  render(
    <PhaseWait batchId="b1" until="ready" label="Validating" onReady={vi.fn()} onError={onError} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load these import details");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled();
});
