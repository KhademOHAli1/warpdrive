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

type CancelReply = { ok: true; value: "cancelled" } | { ok: false; error: string };
type ReadReply = { isError: boolean };
type HistoryPoll = {
  refetchInterval: (query: { state: { data?: { status: string }[] } }) => number | false;
};

const queries = vi.hoisted(() => ({
  rows: [] as unknown[],
  isError: false,
  isFetching: false,
  input: undefined as { id: string } | undefined,
  options: undefined as HistoryPoll | undefined,
  cancel: vi.fn<(id: string, token: string | null) => Promise<CancelReply>>(),
  refetch: vi.fn<() => Promise<ReadReply>>(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      runs: {
        useQuery: (input: { id: string }, options: HistoryPoll) => {
          queries.input = input;
          queries.options = options;
          return {
            data: queries.rows,
            isLoading: false,
            isError: queries.isError,
            isFetching: queries.isFetching,
            refetch: queries.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({ cancelWorkflowAction: queries.cancel }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-01 10:00" }),
}));
vi.mock("./RunDetailDialog", () => ({ RunDetailDialog: () => null }));
vi.mock("./RunRecovery", () => ({ RunRecovery: () => null }));

const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const runId = "53719a17-7044-4092-8629-6f1497d4d5c4";
const secondRunId = "d218039c-a169-4f0a-b299-d14339e11d7c";
const locales = [
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const;

function row(status = "waiting", id = runId) {
  return {
    id,
    status,
    mode: "live",
    versionId: "2d2e682c-beca-4a38-9d24-af2d23604d40",
    errorId: null,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    resumeAt: new Date("2026-11-01T10:01:00Z"),
    steps: [],
  };
}

function page(locale: "en" | "de" | "fa" = "en", canCancel = true) {
  return (
    <LocaleProvider locale={locale}>
      <RunHistory workflowId={workflowId} canCancel={canCancel} />
    </LocaleProvider>
  );
}

function expectOneCancellation() {
  expect(queries.cancel).toHaveBeenCalledTimes(1);
  expect(queries.cancel).toHaveBeenCalledWith(runId, "csrf");
  expect(queries.input).toEqual({ id: workflowId });
}

beforeEach(() => {
  queries.rows = [row()];
  queries.isError = false;
  queries.isFetching = false;
  queries.input = undefined;
  queries.options = undefined;
  queries.cancel.mockReset();
  queries.refetch.mockReset();
  queries.cancel.mockResolvedValue({ ok: true, value: "cancelled" });
  queries.refetch.mockResolvedValue({ isError: false });
});
afterEach(cleanup);

for (const failure of ["rejection", "synchronous throw", "error state"] as const) {
  it.each(locales)(
    `keeps acknowledged cancellation separate from read ${failure} and refreshes without recancelling in $locale`,
    async ({ locale, messages }) => {
      if (failure === "rejection") {
        queries.refetch.mockRejectedValueOnce(new Error("history unavailable"));
      } else if (failure === "synchronous throw") {
        queries.refetch.mockImplementationOnce(() => {
          throw new Error("history unavailable");
        });
      } else {
        queries.refetch.mockImplementationOnce(() => {
          queries.isError = true;
          return Promise.resolve({ isError: true });
        });
      }
      const user = userEvent.setup();
      const view = render(page(locale));
      const cancel = screen.getByRole("button", { name: messages.cancelRun });

      await user.click(cancel);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: messages.cancelRun })).not.toBeInTheDocument();
        expect(screen.getByText(messages.refreshAfterAck)).toBeVisible();
        expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
      });
      expect(screen.getByText(messages.runCancelled)).toBeVisible();
      expect(screen.queryByText(messages.error)).not.toBeInTheDocument();
      expectOneCancellation();
      expect(queries.refetch).toHaveBeenCalledTimes(1);

      queries.refetch.mockImplementationOnce(() => {
        queries.isError = false;
        queries.rows = [row("cancelled")];
        return Promise.resolve({ isError: false });
      });
      const refresh = screen.getByRole("button", { name: messages.refresh });
      await user.click(refresh);
      view.rerender(page(locale));

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(queries.refetch).toHaveBeenCalledTimes(2);
      expectOneCancellation();
      expect(screen.queryByRole("button", { name: messages.cancelRun })).not.toBeInTheDocument();
      expect(refresh).toHaveFocus();
    },
  );
}

it("preserves a returned cancellation failure, releases pending, and does not auto-refetch", async () => {
  queries.cancel.mockResolvedValueOnce({ ok: false, error: "E_WORKFLOW_001" });
  const user = userEvent.setup();
  render(page());
  const cancel = screen.getByRole("button", { name: english.cancelRun });

  await user.click(cancel);

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(english.error));
  expect(screen.queryByText(english.loadError)).not.toBeInTheDocument();
  expect(cancel).toBeEnabled();
  expectOneCancellation();
  expect(queries.refetch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: english.refresh }));
  await waitFor(() => expect(queries.refetch).toHaveBeenCalledTimes(1));

  expectOneCancellation();
  expect(screen.getByRole("alert")).toHaveTextContent(english.error);
  expect(screen.queryByText(english.loadError)).not.toBeInTheDocument();
});

it("fences a rejected cancellation until a successful read and explicit rearm", async () => {
  queries.cancel.mockRejectedValueOnce(new Error("cancellation unavailable"));
  const user = userEvent.setup();
  render(page());
  const cancel = screen.getByRole("button", { name: english.cancelRun });

  await user.click(cancel);

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(english.cancelUnknown));
  expect(screen.queryByText(english.error)).not.toBeInTheDocument();
  expect(screen.queryByText(english.loadError)).not.toBeInTheDocument();
  expect(cancel).toBeDisabled();
  expect(screen.getByRole("button", { name: english.allowCancelRetry })).toBeDisabled();
  expect(queries.refetch).not.toHaveBeenCalled();

  await user.click(cancel);
  expect(queries.cancel).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: english.refresh }));
  await waitFor(() => expect(queries.refetch).toHaveBeenCalledTimes(1));
  const rearm = screen.getByRole("button", { name: english.allowCancelRetry });
  await waitFor(() => expect(rearm).toBeEnabled());

  await user.click(rearm);
  expect(screen.queryByText(english.cancelUnknown)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: english.cancelRun })).toBeEnabled();
  expect(queries.cancel).toHaveBeenCalledTimes(1);
});

it.each(locales)("identifies a query-only load failure in $locale", ({ locale, messages }) => {
  queries.isError = true;
  render(page(locale, false));

  expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
  expect(screen.queryByText(messages.error)).not.toBeInTheDocument();
  expect(queries.cancel).not.toHaveBeenCalled();
  expect(queries.refetch).not.toHaveBeenCalled();
});

it("keeps every cancel control pending through acknowledgement and the follow-up read", async () => {
  let acknowledge!: (value: CancelReply) => void;
  const cancellation = new Promise<CancelReply>((resolve) => {
    acknowledge = resolve;
  });
  let finishRead!: (value: ReadReply) => void;
  const read = new Promise<ReadReply>((resolve) => {
    finishRead = resolve;
  });
  queries.cancel.mockReturnValueOnce(cancellation);
  queries.refetch.mockReturnValueOnce(read);
  queries.rows = [row(), row("running", secondRunId)];
  const user = userEvent.setup();
  render(page());
  const cancels = screen.getAllByRole("button", { name: english.cancelRun });
  const [firstCancel, secondCancel] = cancels;
  if (firstCancel === undefined || secondCancel === undefined) {
    throw new Error("Both active run cancellation controls must be present");
  }

  await user.click(firstCancel);

  expectOneCancellation();
  expect(queries.refetch).not.toHaveBeenCalled();
  for (const cancel of cancels) expect(cancel).toBeDisabled();
  await user.click(secondCancel);
  expectOneCancellation();

  await act(() => {
    acknowledge({ ok: true, value: "cancelled" });
    return Promise.resolve();
  });

  expect(queries.refetch).toHaveBeenCalledTimes(1);
  expect(firstCancel).not.toBeInTheDocument();
  const [remainingCancel] = screen.getAllByRole("button", { name: english.cancelRun });
  if (remainingCancel === undefined) {
    throw new Error("The other active run cancellation control must remain present");
  }
  expect(remainingCancel).toBeDisabled();

  await act(() => {
    finishRead({ isError: false });
    return Promise.resolve();
  });

  expect(screen.getByRole("button", { name: english.cancelRun })).toBeEnabled();
  expectOneCancellation();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([
  { canCancel: false, status: "waiting" },
  { canCancel: true, status: "succeeded" },
])(
  "preserves cancellation gates for $status with permission $canCancel",
  ({ canCancel, status }) => {
    queries.rows = [row(status)];
    render(page("en", canCancel));

    expect(screen.queryByRole("button", { name: english.cancelRun })).not.toBeInTheDocument();
    expect(queries.cancel).not.toHaveBeenCalled();
    expect(queries.refetch).not.toHaveBeenCalled();
  },
);
