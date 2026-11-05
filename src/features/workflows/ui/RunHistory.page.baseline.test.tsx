// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import copy from "../messages/workflows.en.json";
import { RunHistory } from "./RunHistory";

type CancelReply = { ok: true; value: "cancelled" | "failed" } | { ok: false; error: string };
type CancelAction = (id: string, token: string | null) => Promise<CancelReply>;
type ReadReply = { isError: boolean };
type Refetch = () => Promise<ReadReply>;
type HistoryPoll = {
  refetchInterval: (query: { state: { data?: { status: string }[] } }) => number | false;
};
type PagePoll = {
  refetchInterval: (query: {
    state: { data?: { items: { status: string }[]; nextCursor: string | null } };
  }) => number | false;
};
interface HistoryRow {
  id: string;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  mode: "live" | "simulation";
  versionId: string;
  errorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resumeAt: Date | null;
  steps: { nodeId: string; simulated: boolean; completedAt: Date }[];
}
interface HistoryQueries {
  rows: HistoryRow[];
  isError: boolean;
  input: { id: string } | undefined;
  options: HistoryPoll | undefined;
  cancel: ReturnType<typeof vi.fn<CancelAction>>;
  refetch: ReturnType<typeof vi.fn<Refetch>>;
}
const queries = vi.hoisted<HistoryQueries>(() => ({
  rows: [],
  isError: false,
  input: undefined,
  options: undefined,
  cancel: vi.fn<CancelAction>(),
  refetch: vi.fn<Refetch>(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        runs: { invalidate: () => Promise.resolve() },
        runsPage: { invalidate: () => Promise.resolve() },
      },
    }),
    workflows: {
      runsPage: {
        useQuery: (input: { id: string }, options: PagePoll) => {
          queries.input = input;
          queries.options = {
            refetchInterval: (query) =>
              options.refetchInterval({
                state: {
                  data:
                    query.state.data === undefined
                      ? undefined
                      : { items: query.state.data, nextCursor: null },
                },
              }),
          };
          return {
            data: { items: queries.rows, nextCursor: null },
            isLoading: false,
            isError: queries.isError,
            isFetching: false,
            refetch: queries.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({ cancelWorkflowAction: queries.cancel }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "history-page-baseline-csrf" }));
vi.mock("./RunDetailDialog", () => ({ RunDetailDialog: () => null }));
vi.mock("./RunRecovery", () => ({ RunRecovery: () => null }));

const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const runId = "53719a17-7044-4092-8629-6f1497d4d5c4";
const createdAt = new Date("2026-11-01T10:00:00.000Z");
const resumeAt = new Date("2026-11-01T10:01:00.123Z");
function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: runId,
    status: "waiting",
    mode: "live",
    versionId: "2d2e682c-beca-4a38-9d24-af2d23604d40",
    errorId: null,
    createdAt,
    updatedAt: createdAt,
    resumeAt,
    steps: [],
    ...overrides,
  };
}
function page(canCancel = true) {
  return (
    <LocaleProvider locale="en" calendar="gregory" numberingSystem="latn" timeZone="UTC">
      <RunHistory workflowId={workflowId} canCancel={canCancel} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  queries.rows = [row()];
  queries.isError = false;
  queries.input = undefined;
  queries.options = undefined;
  queries.cancel.mockReset();
  queries.refetch.mockReset();
  queries.cancel.mockResolvedValue({ ok: true, value: "cancelled" });
  queries.refetch.mockResolvedValue({ isError: false });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

it("control: shows the waiting state and stored resume deadline through the current array API", () => {
  const view = render(page());
  const history = within(screen.getByRole("region", { name: copy.runs }));
  expect(history.getByText(copy.status.waiting)).toBeVisible();
  expect(history.getByText(copy.scheduledResume)).toBeVisible();
  expect(history.getByText(copy.waitRecoveryHint)).toBeVisible();
  expect(
    view.container.querySelector(`time[datetime="${resumeAt.toISOString()}"]`),
  ).toBeInTheDocument();
  expect(queries.input).toEqual({ id: workflowId });
  expect(queries.options?.refetchInterval({ state: { data: queries.rows } })).toBe(2500);
  expect(queries.cancel).not.toHaveBeenCalled();
});

it("control: keeps waiting timing and inspection visible while read-only history hides cancellation", () => {
  const view = render(page(false));
  expect(screen.getByText(copy.status.waiting)).toBeVisible();
  expect(screen.getByText(copy.scheduledResume)).toBeVisible();
  expect(
    view.container.querySelector(`time[datetime="${resumeAt.toISOString()}"]`),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: copy.viewRun })).toBeEnabled();
  expect(screen.getByRole("button", { name: copy.refresh })).toBeEnabled();
  expect(screen.queryByRole("button", { name: copy.cancelRun })).not.toBeInTheDocument();
  expect(queries.cancel).not.toHaveBeenCalled();
});

it("control: preserves a cancellation acknowledgment when its history refresh fails without resending", async () => {
  queries.refetch.mockRejectedValueOnce(new Error("history refresh unavailable"));
  const user = userEvent.setup();
  render(page());
  await user.click(screen.getByRole("button", { name: copy.cancelRun }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.loadError));
  expect(screen.getByText(copy.runCancelled)).toBeVisible();
  expect(screen.getByText(copy.refreshAfterAck)).toBeVisible();
  expect(screen.queryByRole("button", { name: copy.cancelRun })).not.toBeInTheDocument();
  expect(screen.queryByText(copy.cancelUnknown)).not.toBeInTheDocument();
  expect(screen.queryByText(copy.error)).not.toBeInTheDocument();
  expect(queries.cancel).toHaveBeenCalledExactlyOnceWith(runId, "history-page-baseline-csrf");
  expect(queries.refetch).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: copy.refresh }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByText(copy.runCancelled)).toBeVisible();
  expect(screen.queryByRole("button", { name: copy.cancelRun })).not.toBeInTheDocument();
  expect(queries.refetch).toHaveBeenCalledTimes(2);
  expect(queries.cancel).toHaveBeenCalledTimes(1);
});

it("gap: exposes a discoverable run-status filter on the current history surface", () => {
  render(page(false));
  expect(screen.getByRole("region", { name: copy.runs })).toBeVisible();
  expect(screen.getByText(copy.status.waiting)).toBeVisible();
  expect(screen.getByRole("combobox", { name: /run status/i })).toBeVisible();
});

it("gap: exposes a discoverable live-or-simulation mode filter on the current history surface", () => {
  queries.rows = [row({ status: "succeeded", mode: "simulation", resumeAt: null })];
  render(page(false));
  expect(screen.getByRole("region", { name: copy.runs })).toBeVisible();
  expect(screen.getByText(copy.simulationMode)).toBeVisible();
  expect(screen.getByRole("combobox", { name: /run mode/i })).toBeVisible();
});

it("gap: exposes Older runs navigation after rendering a full current fifty-row history array", () => {
  queries.rows = Array.from({ length: 50 }, (_, index) =>
    row({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      status: "succeeded",
      mode: index % 2 === 0 ? "live" : "simulation",
      createdAt: new Date(createdAt.getTime() - index * 60_000),
      resumeAt: null,
    }),
  );
  render(page(false));
  expect(screen.getAllByRole("article")).toHaveLength(50);
  expect(queries.input).toEqual({ id: workflowId });
  expect(screen.getByRole("button", { name: /older runs/i })).toBeVisible();
});
