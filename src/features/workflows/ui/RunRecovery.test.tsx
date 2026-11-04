// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
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
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "fixture-csrf" }));
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
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

function mount(locale: "en" | "de" | "fa" = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <RunHistory workflowId={workflowId} canCancel />
    </LocaleProvider>,
  );
}

type Outcome = "denied" | "conflict" | "acknowledged" | "transport";
type Invalidator = "list" | "detail";
const catalogs = { en: english, de: german, fa: persian };
const readFailureCases: {
  locale: "en" | "de" | "fa";
  outcome: Outcome;
  invalidator: Invalidator;
}[] = [
  ...(["list", "detail"] as const).flatMap((invalidator) =>
    (["denied", "conflict", "acknowledged", "transport"] as const).map((outcome) => ({
      locale: "en" as const,
      outcome,
      invalidator,
    })),
  ),
  ...(["de", "fa"] as const).flatMap((locale) => [
    { locale, outcome: "denied" as const, invalidator: "detail" as const },
    { locale, outcome: "conflict" as const, invalidator: "list" as const },
  ]),
];

function deferredRefresh() {
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

it.each(readFailureCases)(
  "preserves $outcome in $locale when $invalidator invalidation fails",
  async ({ locale, outcome, invalidator }) => {
    const L = catalogs[locale];
    queries.rows = [row()];
    if (outcome === "transport")
      queries.retry.mockRejectedValueOnce(new Error("private action diagnostic"));
    else
      queries.retry.mockResolvedValueOnce(
        outcome === "acknowledged"
          ? { ok: true, value: { id: runId } }
          : {
              ok: false,
              error: outcome === "denied" ? ERROR_IDS.WORKFLOW_DENIED : ERROR_IDS.WORKFLOW_CONFLICT,
            },
      );
    const refresh = deferredRefresh();
    (invalidator === "list" ? queries.refetch : queries.invalidateRun).mockReturnValueOnce(
      refresh.promise,
    );
    const view = mount(locale);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: L.retryRun }));
    await waitFor(() => expect(queries.retry).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: L.retrying })).toBeDisabled();
    const expectedError =
      outcome === "denied"
        ? L.retryDenied
        : outcome === "conflict"
          ? L.retryConflict
          : L.retryUnknown;
    if (outcome === "acknowledged") expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    else expect(await screen.findByRole("alert")).toHaveTextContent(expectedError);
    await user.click(screen.getByRole("button", { name: L.retrying }));
    expect(queries.retry).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh.reject(new Error("private refresh diagnostic"));
      await refresh.promise.catch(() => undefined);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: L.retryRun })).toBeEnabled());
    if (outcome === "acknowledged") expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    else expect(screen.getByRole("alert")).toHaveTextContent(expectedError);
    if (outcome === "denied" || outcome === "conflict") {
      expect(screen.getByRole("alert")).not.toHaveTextContent(L.retryUnknown);
    }
    expect(screen.queryByText("private action diagnostic")).not.toBeInTheDocument();
    expect(screen.queryByText("private refresh diagnostic")).not.toBeInTheDocument();
    expect(queries.retry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ runId, failureId, requestKey: expect.any(String) }),
      "fixture-csrf",
    );
    expect(queries.refetch).toHaveBeenCalledExactlyOnceWith({ id: workflowId });
    expect(queries.invalidateRun).toHaveBeenCalledExactlyOnceWith({ id: workflowId, runId });

    if (outcome === "transport") {
      const original = queries.retry.mock.calls[0]?.[0];
      queries.retry.mockResolvedValueOnce({ ok: true, value: { id: runId } });
      await user.click(screen.getByRole("button", { name: L.retryRun }));
      await waitFor(() => expect(screen.getByRole("button", { name: L.retryRun })).toBeEnabled());
      expect(queries.retry).toHaveBeenCalledTimes(2);
      expect(queries.retry.mock.calls[1]?.[0]).toEqual(original);
    } else if (outcome === "acknowledged") {
      queries.rows = [{ ...row(), status: "queued", errorId: null }];
      view.rerender(
        <LocaleProvider locale={locale}>
          <RunHistory workflowId={workflowId} canCancel />
        </LocaleProvider>,
      );
      expect(screen.getByRole("status")).toHaveTextContent(L.retryRequested);
      expect(screen.queryByRole("button", { name: L.retryRun })).not.toBeInTheDocument();
      expect(queries.retry).toHaveBeenCalledTimes(1);
    }
  },
);

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
