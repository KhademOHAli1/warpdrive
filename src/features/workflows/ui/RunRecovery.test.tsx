// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { RunHistory } from "./RunHistory";
import { RunRecovery } from "./RunRecovery";

type Command = { runId: string; failureId: string; requestKey: string };
type Reply = { ok: true; value: { id: string } } | { ok: false; error: string };
const queries = vi.hoisted(() => ({
  rows: [] as unknown[],
  retry: vi.fn<(input: Command, token: string | null) => Promise<Reply>>(),
  refetch: vi.fn<(input?: { id: string }) => Promise<void>>(),
  invalidateRun: vi.fn<(input: { id: string; runId: string }) => Promise<void>>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        run: { invalidate: queries.invalidateRun },
        runs: { invalidate: queries.refetch },
      },
    }),
    workflows: {
      runs: {
        useQuery: () => ({
          data: queries.rows,
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: queries.refetch,
        }),
      },
    },
  },
}));
vi.mock("../actions", () => ({
  cancelWorkflowAction: vi.fn(),
  retryWorkflowAction: queries.retry,
}));
vi.mock("./WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from retry regression</div>,
}));

const workflowId = "07f14a03-284b-4e7e-a9fb-8653f605ef02";
const runId = "ff6acd57-f33a-44b8-82fb-cd455ff79c58";
const failureId = "2018ff7a-0b30-4de0-a3b2-25489e73ce1a";
function row(eligible = true) {
  return {
    id: runId,
    status: "failed",
    mode: "live",
    resumeAt: null,
    versionId: "605f6b96-8398-4874-8cdd-a7cef782ff69",
    errorId: "E_PERM_001",
    createdAt: new Date("2026-11-02T14:00:00Z"),
    updatedAt: new Date("2026-11-02T14:01:00Z"),
    steps: [{ nodeId: "start", simulated: false, completedAt: new Date("2026-11-02T14:00:01Z") }],
    recovery: { eligible, failureId, reason: eligible ? "available" : "unsupported", history: [] },
  };
}
beforeEach(() => {
  queries.rows = [];
  queries.retry.mockReset();
  queries.refetch.mockReset();
  queries.invalidateRun.mockReset();
  queries.refetch.mockResolvedValue(undefined);
  queries.invalidateRun.mockResolvedValue(undefined);
});
afterEach(cleanup);

function mount(locale: "en" | "de" | "fa" = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <RunHistory workflowId={workflowId} canCancel />
    </LocaleProvider>,
  );
}

it("offers an explicit retry for a server-qualified failed task while preserving its completed count", () => {
  queries.rows = [row()];
  mount();
  expect(screen.getByRole("button", { name: "Retry failed step" })).toBeEnabled();
  expect(screen.getByText("One step completed")).toBeInTheDocument();
  expect(queries.retry).not.toHaveBeenCalled();
});

it("does not offer terminal retry for a server-ineligible failure", () => {
  queries.rows = [row(false)];
  mount();
  expect(screen.queryByRole("button", { name: "Retry failed step" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View run" })).toBeEnabled();
});

it("does not expose retry for completed runs", () => {
  queries.rows = [{ ...row(), status: "succeeded", errorId: null }];
  mount();
  expect(screen.queryByRole("button", { name: "Retry failed step" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View run" })).toBeEnabled();
});

it("retains the same failure-bound request key after uncertain transport and always clears pending", async () => {
  queries.rows = [row()];
  queries.retry.mockRejectedValueOnce(new Error("Response lost"));
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry failed step" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("We could not confirm the retry");
  expect(screen.getByRole("button", { name: "Retry failed step" })).toBeEnabled();
  queries.retry.mockResolvedValueOnce({ ok: true, value: { id: runId } });
  await user.click(screen.getByRole("button", { name: "Retry failed step" }));
  await waitFor(() => expect(queries.retry).toHaveBeenCalledTimes(2));
  const first: unknown = queries.retry.mock.calls[0]?.[0];
  expect(first).toEqual(
    expect.objectContaining({ runId, failureId, requestKey: expect.any(String) }),
  );
  expect(queries.retry.mock.calls[1]?.[0]).toEqual(first);
  expect(queries.refetch).toHaveBeenCalledWith({ id: workflowId });
  expect(queries.invalidateRun).toHaveBeenCalledWith({ id: workflowId, runId });
});

it("uses a new request identity only for a newly observed failure generation", async () => {
  queries.rows = [row()];
  queries.retry.mockResolvedValue({ ok: false, error: "E_WORKFLOW_003" });
  const view = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry failed step" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry failed step" })).toBeEnabled(),
  );
  const nextId = "b3aab005-7205-4c96-9143-6c1c516fb4d4";
  queries.rows = [{ ...row(), recovery: { ...row().recovery, failureId: nextId } }];
  view.rerender(
    <LocaleProvider locale="en">
      <RunHistory workflowId={workflowId} canCancel />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry failed step" }));
  expect(queries.retry.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ failureId: nextId }));
  expect(queries.retry.mock.calls[1]?.[0].requestKey).not.toBe(
    queries.retry.mock.calls[0]?.[0].requestKey,
  );
});

it.each([
  [
    "de",
    "Fehlgeschlagenen Schritt wiederholen",
    "Abgeschlossene Aufgaben werden nicht erneut ausgeführt",
  ],
  ["fa", "تلاش دوباره برای گام ناموفق", "کارهای تکمیل‌شده دوباره اجرا نمی‌شوند"],
] as const)("renders the explicit recovery meaning in %s", (locale, button, meaning) => {
  queries.rows = [row()];
  mount(locale);
  expect(screen.getByRole("button", { name: button })).toBeEnabled();
  expect(screen.getByText(new RegExp(meaning))).toBeInTheDocument();
});

it("shows legacy snapshot times and a recorded failed-wait deadline without offering a restart", () => {
  render(
    <LocaleProvider locale="en">
      <RunRecovery
        workflowId={workflowId}
        runId={runId}
        status="failed"
        detailed
        recovery={{
          eligible: false,
          failureId,
          reason: "unsupported",
          history: [
            {
              id: failureId,
              nodeId: "wait",
              errorId: "E_WORKFLOW_001",
              failedAt: new Date("2026-01-02T03:04:05Z"),
              origin: "recorded",
              originalResumeAt: new Date("2026-01-02T03:03:00Z"),
              retriedAt: null,
            },
            {
              id: "2093ec59-0fb1-4adf-935e-69bd21974ecd",
              nodeId: "task",
              errorId: "E_PERM_001",
              failedAt: new Date("2026-01-01T03:04:05Z"),
              origin: "legacy_snapshot",
              originalResumeAt: null,
              retriedAt: new Date("2026-01-01T03:05:00Z"),
            },
          ],
        }}
        nodeName={(id) => (id === "wait" ? "Wait for customer" : "Earlier task")}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("Wait for customer")).toBeInTheDocument();
  expect(screen.getByText(/Earlier failure snapshot, stored update time/)).toBeInTheDocument();
  expect(
    screen.getByText(/Original wait deadline \(automatic restart unavailable\)/),
  ).toBeInTheDocument();
  expect(screen.getByText("E_WORKFLOW_001")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry failed step" })).not.toBeInTheDocument();
});
