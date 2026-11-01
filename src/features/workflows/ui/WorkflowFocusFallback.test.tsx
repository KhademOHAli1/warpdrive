// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { RunHistory } from "./RunHistory";

const queries = vi.hoisted(() => ({
  rows: [] as {
    id: string;
    status: "succeeded" | "running";
    mode: "simulation" | "live";
    versionId: string;
    errorId: null;
    createdAt: Date;
    updatedAt: Date;
    steps: [];
  }[],
  isFetching: false,
  cancel: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      runs: {
        useQuery: () => ({
          data: queries.rows,
          isLoading: false,
          isError: false,
          isFetching: queries.isFetching,
          refetch: vi.fn(),
        }),
      },
      run: {
        useQuery: () => ({ data: undefined, isLoading: true, isError: false }),
      },
    },
  },
}));
vi.mock("../actions", () => ({ cancelWorkflowAction: queries.cancel }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));

afterEach(() => {
  cleanup();
  queries.rows = [];
  queries.isFetching = false;
  queries.cancel.mockClear();
});

it.each([
  { isFetching: false, destination: "Refresh" },
  { isFetching: true, destination: "Run history heading" },
])(
  "returns to $destination when a history update removes the run-detail opener",
  async ({ isFetching, destination }) => {
    const now = new Date("2026-10-31T12:00:00Z");
    const base = {
      status: "succeeded" as const,
      versionId: "3a20c3a5-a2ed-4b18-8db6-8e57d54fcd68",
      errorId: null,
      createdAt: now,
      updatedAt: now,
      steps: [] as [],
    };
    const selectedId = "8755a40e-fda9-4456-a3f4-7f6ff73a0eea";
    queries.rows = [
      {
        ...base,
        id: "cb3defef-b67b-4502-b9a4-fb7ff761895a",
        mode: "simulation",
        status: "running",
      },
      { ...base, id: selectedId, mode: "live" },
    ];
    const page = (
      <LocaleProvider locale="en">
        <RunHistory workflowId="6ef69ee6-a029-476c-9f26-020fa475cdec" canCancel={false} />
      </LocaleProvider>
    );
    const view = render(page);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    const heading = screen.getByRole("heading", { name: "Run history", level: 2 });
    const selectedRow = screen.getByText("Live run").closest("article");
    const opener = within(selectedRow ?? document.body).getByRole("button", { name: "View run" });
    const user = userEvent.setup();
    opener.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    queries.rows = queries.rows.filter((row) => row.id !== selectedId);
    queries.isFetching = isFetching;
    view.rerender(
      <LocaleProvider locale="en">
        <RunHistory workflowId="6ef69ee6-a029-476c-9f26-020fa475cdec" canCancel={false} />
      </LocaleProvider>,
    );
    expect(opener.isConnected).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });
    expect(queries.cancel).not.toHaveBeenCalled();
    if (isFetching) expect(refresh).toBeDisabled();
    else expect(refresh).toBeEnabled();
    const target = isFetching ? heading : refresh;
    await waitFor(
      () =>
        expect(
          document.activeElement === target,
          `Closing details after its opener disappears should focus ${destination}; active element is ${document.activeElement?.tagName}`,
        ).toBe(true),
      { timeout: 1000, onTimeout: (error) => error },
    );
  },
);
