// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import { RunHistory } from "./RunHistory";

type Status = "all" | "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
type Mode = "all" | "live" | "simulation";
type Input = { id: string; status?: Status; mode?: Mode; cursor?: string };
type Row = {
  id: string;
  status: Exclude<Status, "all">;
  mode: Exclude<Mode, "all">;
  versionId: string;
  errorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resumeAt: Date | null;
  steps: [];
};
type Reply = { items: Row[]; nextCursor: string | null };
type Poll = { refetchInterval: (query: { state: { data?: Reply } }) => number | false };
type Cancel = (
  id: string,
  token: string | null,
) => Promise<{ ok: true; value: "cancelled" } | { ok: false; error: string }>;
type Invalidate = (input: { id: string }, filters?: { refetchType: "none" }) => Promise<void>;
const io = vi.hoisted<{
  read: ReturnType<typeof vi.fn<(input: Input) => Reply>>;
  refetch: ReturnType<typeof vi.fn<() => Promise<{ isError: boolean; data?: Reply }>>>;
  cancel: ReturnType<typeof vi.fn<Cancel>>;
  legacy: ReturnType<typeof vi.fn<Invalidate>>;
  pages: ReturnType<typeof vi.fn<Invalidate>>;
  fetch: ReturnType<typeof vi.fn<(input: Input, options: { staleTime: number }) => Promise<Reply>>>;
  loading: boolean;
  fetching: boolean;
  isError: boolean;
  placeholder: boolean;
  denyOlder: boolean;
  options: Poll | undefined;
}>(() => ({
  read: vi.fn(),
  refetch: vi.fn(),
  cancel: vi.fn(),
  legacy: vi.fn(),
  pages: vi.fn(),
  fetch: vi.fn(),
  loading: false,
  fetching: false,
  isError: false,
  placeholder: false,
  denyOlder: false,
  options: undefined,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        runs: { invalidate: io.legacy },
        runsPage: { invalidate: io.pages, fetch: io.fetch },
      },
    }),
    workflows: {
      runsPage: {
        useQuery: (input: Input, options: Poll) => {
          io.options = options;
          const data = io.read(input);
          const denied = io.denyOlder && input.cursor !== undefined;
          return {
            data: io.loading || denied ? undefined : data,
            isLoading: io.loading,
            isFetching: io.fetching,
            isError: io.isError || denied,
            isPlaceholderData: io.placeholder,
            refetch: io.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({ cancelWorkflowAction: io.cancel }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "history-csrf" }));
vi.mock("./RunDetailDialog", () => ({ RunDetailDialog: () => null }));
vi.mock("./RunRecovery", () => ({ RunRecovery: () => null }));

const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const secondWorkflowId = "bd53940c-4869-4467-acd4-e70bfe8a8872";
const runId = "53719a17-7044-4092-8629-6f1497d4d5c4";
const newest = new Date("2026-11-04T10:00:00.000Z");
const older = new Date("2025-11-04T10:00:00.000Z");
function row(input: Input = { id: workflowId }): Row {
  return {
    id: runId,
    status: input.status === undefined || input.status === "all" ? "waiting" : input.status,
    mode: input.mode === undefined || input.mode === "all" ? "live" : input.mode,
    versionId: "2d2e682c-beca-4a38-9d24-af2d23604d40",
    errorId: null,
    createdAt: input.cursor === undefined ? newest : older,
    updatedAt: newest,
    resumeAt: new Date("2030-03-20T12:34:56.123Z"),
    steps: [],
  };
}
function reply(input: Input): Reply {
  return { items: [row(input)], nextCursor: input.cursor === undefined ? "opaque-older" : null };
}
const profiles = [
  { name: "English", locale: "en", calendar: "gregory", numberingSystem: "latn", copy: english },
  { name: "German", locale: "de", calendar: "gregory", numberingSystem: "latn", copy: german },
  {
    name: "Persian calendar/digits",
    locale: "fa",
    calendar: "persian",
    numberingSystem: "arabext",
    copy: persian,
  },
  {
    name: "Persian Gregorian/Latin",
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    copy: persian,
  },
] as const;
function page(id = workflowId, canCancel = true) {
  return (
    <LocaleProvider locale="en" timeZone="UTC">
      <RunHistory workflowId={id} canCancel={canCancel} />
    </LocaleProvider>
  );
}
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option, exact: true }));
}
beforeEach(() => {
  io.read.mockReset();
  io.read.mockImplementation(reply);
  io.fetch.mockReset();
  io.fetch.mockImplementation((input) => Promise.resolve(reply(input)));
  io.refetch.mockReset();
  io.refetch.mockResolvedValue({ isError: false });
  io.cancel.mockReset();
  io.cancel.mockResolvedValue({ ok: true, value: "cancelled" });
  io.legacy.mockReset();
  io.legacy.mockResolvedValue(undefined);
  io.pages.mockReset();
  io.pages.mockResolvedValue(undefined);
  io.loading = false;
  io.fetching = false;
  io.isError = false;
  io.placeholder = false;
  io.denyOlder = false;
  io.options = undefined;
});
afterEach(cleanup);

it.each(profiles)("keeps named filters and navigation available in $name", (profile) => {
  render(
    <LocaleProvider
      locale={profile.locale}
      calendar={profile.calendar}
      numberingSystem={profile.numberingSystem}
    >
      <RunHistory workflowId={workflowId} canCancel={false} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("combobox", { name: profile.copy.historyStatusFilter })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: profile.copy.historyModeFilter })).toBeEnabled();
  expect(screen.getByRole("button", { name: profile.copy.historyOlderRuns })).toBeEnabled();
  expect(screen.getByRole("button", { name: profile.copy.historyNewestRuns })).toBeDisabled();
  expect(screen.queryByRole("button", { name: profile.copy.cancelRun })).not.toBeInTheDocument();
});

it.each(profiles)("changes status and mode through real controls in $name", async (profile) => {
  render(
    <LocaleProvider
      locale={profile.locale}
      calendar={profile.calendar}
      numberingSystem={profile.numberingSystem}
    >
      <RunHistory workflowId={workflowId} canCancel={false} />
    </LocaleProvider>,
  );
  const user = userEvent.setup();
  const status = screen.getByRole("combobox", { name: profile.copy.historyStatusFilter });
  status.focus();
  await user.keyboard("{Enter}{End}{ArrowUp}{Enter}");
  expect(status).toHaveFocus();
  expect(io.read.mock.lastCall?.[0]).toEqual({ id: workflowId, status: "failed" });
  await choose(user, profile.copy.historyModeFilter, profile.copy.simulationMode);
  expect(io.read.mock.lastCall?.[0]).toEqual({
    id: workflowId,
    status: "failed",
    mode: "simulation",
  });
  expect(io.cancel).not.toHaveBeenCalled();
});

it("opens one older page by keyboard and returns focus to the surviving history heading", async () => {
  const view = render(page());
  const user = userEvent.setup();
  screen.getByRole("button", { name: english.historyOlderRuns }).focus();
  await user.keyboard("{Enter}");
  expect(io.read.mock.lastCall?.[0]).toEqual({ id: workflowId, cursor: "opaque-older" });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(view.container.querySelector(`time[datetime="${newest.toISOString()}"]`)).toBeNull();
  expect(
    view.container.querySelector(`time[datetime="${older.toISOString()}"]`),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: english.runs, level: 2 })).toHaveFocus();
});

it.each(["status", "mode"] as const)(
  "resets the older cursor when the %s filter changes",
  async (field) => {
    render(page());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
    await choose(
      user,
      field === "status" ? english.historyStatusFilter : english.historyModeFilter,
      field === "status" ? english.status.failed : english.simulationMode,
    );
    expect(io.read.mock.lastCall?.[0]).toEqual(
      field === "status"
        ? { id: workflowId, status: "failed" }
        : { id: workflowId, mode: "simulation" },
    );
    expect(screen.getByRole("button", { name: english.historyNewestRuns })).toBeDisabled();
  },
);

it("never sends a previous workflow's cursor when the workflow prop changes", async () => {
  const view = render(page());
  await userEvent.setup().click(screen.getByRole("button", { name: english.historyOlderRuns }));
  view.rerender(page(secondWorkflowId));
  expect(
    io.read.mock.calls.filter(([input]) => input.id === secondWorkflowId).map(([input]) => input),
  ).toEqual([{ id: secondWorkflowId }]);
  expect(screen.getByRole("button", { name: english.historyNewestRuns })).toBeDisabled();
});

it("refreshes newest matching results without refetching the old cursor", async () => {
  render(page());
  const user = userEvent.setup();
  await choose(user, english.historyStatusFilter, english.status.failed);
  await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
  await user.click(screen.getByRole("button", { name: english.refresh }));
  expect(io.read.mock.lastCall?.[0]).toEqual({ id: workflowId, status: "failed" });
  expect(io.fetch).toHaveBeenCalledExactlyOnceWith(
    { id: workflowId, status: "failed" },
    { staleTime: 0 },
  );
  expect(io.refetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: english.refresh }));
  expect(io.refetch).toHaveBeenCalledTimes(1);
});

it("keeps filter controls available during loading", () => {
  io.loading = true;
  render(page());
  expect(screen.getByText(english.loading)).toBeVisible();
  expect(screen.getByRole("combobox", { name: english.historyStatusFilter })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: english.historyModeFilter })).toBeEnabled();
  expect(screen.queryByText(english.historyEmpty)).not.toBeInTheDocument();
});

it("distinguishes an empty workflow history from filtered no matches", async () => {
  io.read.mockImplementation(() => ({ items: [], nextCursor: null }));
  render(page());
  expect(screen.getByText(english.historyEmpty)).toBeVisible();
  await choose(userEvent.setup(), english.historyStatusFilter, english.status.failed);
  expect(screen.getByText(english.historyNoMatches)).toBeVisible();
  expect(screen.queryByText(english.historyEmpty)).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: english.historyStatusFilter })).toBeEnabled();
});

it("lets Newest runs recover an older page emptied by current-scope changes", async () => {
  io.read.mockImplementation((input) =>
    input.cursor === undefined ? reply(input) : { items: [], nextCursor: null },
  );
  render(page());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
  expect(screen.getByText(english.historyPageEmpty)).toBeVisible();
  await user.click(screen.getByRole("button", { name: english.historyNewestRuns }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(io.read.mock.lastCall?.[0]).toEqual({ id: workflowId });
});

it("shows a denied page read truthfully and retains newest-page recovery", async () => {
  io.denyOlder = true;
  render(page());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
  expect(screen.getByRole("alert")).toHaveTextContent(english.loadError);
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.queryByText(english.historyEmpty)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: english.historyNewestRuns }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not show placeholder rows under new filter labels", async () => {
  const view = render(page());
  io.placeholder = true;
  await choose(userEvent.setup(), english.historyStatusFilter, english.status.failed);
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByText(english.loading)).toBeVisible();
  io.placeholder = false;
  view.rerender(page());
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("retains read-error feedback and filters after a transport failure", () => {
  io.isError = true;
  render(page());
  expect(screen.getByRole("alert")).toHaveTextContent(english.loadError);
  expect(screen.getByRole("combobox", { name: english.historyStatusFilter })).toBeEnabled();
  expect(screen.getByRole("button", { name: english.refresh })).toBeEnabled();
});

it("polls only a successful visible page containing active runs", () => {
  render(page());
  expect(io.options?.refetchInterval({ state: { data: reply({ id: workflowId }) } })).toBe(2500);
  expect(
    io.options?.refetchInterval({
      state: { data: reply({ id: workflowId, status: "succeeded" }) },
    }),
  ).toBe(false);
  expect(io.options?.refetchInterval({ state: { data: undefined } })).toBe(false);
});

it.each(["legacy", "pages"] as const)(
  "keeps a known cancellation after %s cache invalidation fails",
  async (cache) => {
    io[cache].mockRejectedValueOnce(new Error("read cache unavailable"));
    render(page());
    await userEvent.setup().click(screen.getByRole("button", { name: english.cancelRun }));
    await waitFor(() => expect(screen.getByText(english.runCancelled)).toBeVisible());
    expect(screen.queryByText(english.cancelUnknown)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: english.cancelRun })).not.toBeInTheDocument();
    expect(io.cancel).toHaveBeenCalledExactlyOnceWith(runId, "history-csrf");
    expect(io.legacy).toHaveBeenCalledExactlyOnceWith({ id: workflowId }, { refetchType: "none" });
    expect(io.pages).toHaveBeenCalledExactlyOnceWith({ id: workflowId }, { refetchType: "none" });
  },
);

it("preserves an actual cancellation failure without reading or invalidating", async () => {
  io.cancel.mockResolvedValueOnce({ ok: false, error: "E_WORKFLOW_DENIED" });
  render(page());
  await userEvent.setup().click(screen.getByRole("button", { name: english.cancelRun }));
  expect(screen.getByRole("alert")).toHaveTextContent(english.error);
  expect(io.refetch).not.toHaveBeenCalled();
  expect(io.legacy).not.toHaveBeenCalled();
  expect(io.pages).not.toHaveBeenCalled();
});

it("keeps an unknown mutation fenced through older-to-newest read review", async () => {
  let completeNewestRead!: (value: Reply) => void;
  const newestRead = new Promise<Reply>((resolve) => {
    completeNewestRead = resolve;
  });
  io.fetch.mockReturnValueOnce(newestRead);
  io.cancel.mockRejectedValueOnce(new Error("transport unknown"));
  render(page());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
  await user.click(screen.getByRole("button", { name: english.cancelRun }));
  expect(screen.getByRole("alert")).toHaveTextContent(english.cancelUnknown);
  expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: english.refresh }));
  expect(io.fetch).toHaveBeenCalledExactlyOnceWith({ id: workflowId }, { staleTime: 0 });
  expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
  await act(async () => {
    completeNewestRead(reply({ id: workflowId }));
    await newestRead;
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeEnabled(),
  );
  expect(io.cancel).toHaveBeenCalledTimes(1);
});

it("ignores a late newest-read success or failure after the filter scope changes", async () => {
  for (const outcome of ["success", "failure"] as const) {
    let finishRead!: (value: Reply) => void;
    let failRead!: (error: Error) => void;
    const oldRead = new Promise<Reply>((resolve, reject) => {
      finishRead = resolve;
      failRead = reject;
    });
    io.fetch.mockReturnValueOnce(oldRead);
    io.cancel.mockRejectedValueOnce(new Error("unknown mutation"));
    const view = render(page());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
    await user.click(screen.getByRole("button", { name: english.cancelRun }));
    await user.click(screen.getByRole("button", { name: english.refresh }));
    expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
    await choose(user, english.historyStatusFilter, english.status.failed);
    expect(io.read.mock.lastCall?.[0]).toEqual({ id: workflowId, status: "failed" });
    await act(async () => {
      if (outcome === "success") finishRead(reply({ id: workflowId }));
      else failRead(new Error("old-scope read failed"));
      await oldRead.catch(() => undefined);
    });
    expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
    expect(screen.getByText(english.cancelUnknown)).toBeVisible();
    expect(screen.queryByText(english.loadError)).not.toBeInTheDocument();
    expect(io.refetch).not.toHaveBeenCalled();
    view.unmount();
  }
});

it("keeps retry fenced when a pre-unknown refresh completes after cancellation becomes unknown", async () => {
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<Awaited<ReturnType<Cancel>>>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  let finishEarlierRead!: (value: { isError: boolean; data?: Reply }) => void;
  const earlierRead = new Promise<{ isError: boolean; data?: Reply }>((resolve) => {
    finishEarlierRead = resolve;
  });
  io.cancel.mockReturnValueOnce(cancellation);
  io.refetch.mockReturnValueOnce(earlierRead);
  render(page());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: english.cancelRun }));
  expect(io.cancel).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: english.refresh }));
  expect(io.refetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    rejectCancellation(new Error("cancellation outcome unknown"));
    await cancellation.catch(() => undefined);
  });
  expect(screen.getByRole("alert")).toHaveTextContent(english.cancelUnknown);
  expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
  await act(async () => {
    finishEarlierRead({ isError: false });
    await earlierRead;
  });
  expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: english.refresh }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeEnabled(),
  );
  expect(io.refetch).toHaveBeenCalledTimes(2);
  expect(io.cancel).toHaveBeenCalledTimes(1);
});

it("does not reset a page or refetch when the selected filter is reselected", async () => {
  render(page());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: english.historyOlderRuns }));
  const before = io.read.mock.calls.length;
  await choose(user, english.historyStatusFilter, english.historyAllStatuses);
  expect(io.read.mock.calls).toHaveLength(before);
  expect(io.refetch).not.toHaveBeenCalled();
});

it("renders the fifty-row page without accumulating the previously viewed page", async () => {
  io.read.mockImplementation((input) => ({
    items: Array.from({ length: 50 }, (_, index) => ({
      ...row(input),
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    })),
    nextCursor: input.cursor === undefined ? "opaque-older" : null,
  }));
  render(page());
  expect(screen.getAllByRole("article")).toHaveLength(50);
  await userEvent.setup().click(screen.getByRole("button", { name: english.historyOlderRuns }));
  expect(screen.getAllByRole("article")).toHaveLength(50);
});
