// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { RunDetailDialog } from "./RunDetailDialog";
import { RunHistory } from "./RunHistory";

type HistoryPoll = {
  refetchInterval: (query: { state: { data: { status: string }[] } }) => number | false;
};
type PagePoll = {
  refetchInterval: (query: {
    state: { data?: { items: { status: string }[]; nextCursor: string | null } };
  }) => number | false;
};
type DetailPoll = {
  refetchInterval: (query: { state: { data: { status: string } } }) => number | false;
};
interface QueryFixtures {
  rows: unknown[];
  detail: unknown;
  historyOptions: HistoryPoll | undefined;
  detailOptions: DetailPoll | undefined;
  cancel: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
}
const queries = vi.hoisted(
  (): QueryFixtures => ({
    rows: [],
    detail: undefined,
    historyOptions: undefined,
    detailOptions: undefined,
    cancel: vi.fn(),
    refetch: vi.fn(),
  }),
);

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
        useQuery: (_input: unknown, options: PagePoll) => {
          queries.historyOptions = {
            refetchInterval: (query) =>
              options.refetchInterval({
                state: { data: { items: query.state.data, nextCursor: null } },
              }),
          };
          return {
            data: { items: queries.rows, nextCursor: null },
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: queries.refetch,
          };
        },
      },
      run: {
        useQuery: (_input: unknown, options: DetailPoll) => {
          queries.detailOptions = options;
          return { data: queries.detail, isLoading: false, isError: false };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({ cancelWorkflowAction: queries.cancel }));
vi.mock("./WorkflowCanvas", () => ({ WorkflowCanvas: () => <div>Read-only graph</div> }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));

afterEach(() => {
  cleanup();
  queries.rows = [];
  queries.detail = undefined;
  queries.historyOptions = undefined;
  queries.detailOptions = undefined;
  queries.cancel.mockReset();
  queries.refetch.mockReset();
});

const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const runId = "53719a17-7044-4092-8629-6f1497d4d5c4";
const createdAt = new Date("2026-11-01T10:00:00Z");
const resumeAt = new Date("2026-11-01T10:01:00Z");

function waitingRow() {
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
  };
}

function waitingDetail() {
  const definition = initialDefinition({
    start: "Start",
    read: "Read deal",
    task: "Follow up",
    subject: "Call",
  });
  definition.nodes.push({
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait one minute",
    nameMode: "custom",
    config: { minutes: { kind: "value", value: 1 } },
  });
  for (const node of definition.nodes) node.nameMode = "custom";
  definition.edges = [
    { from: "start", to: "wait", port: "next" },
    { from: "wait", to: "read", port: "next" },
    { from: "read", to: "task", port: "next" },
  ];
  return {
    ...waitingRow(),
    number: 2,
    nextNodeId: "wait",
    definition,
    steps: [{ nodeId: "start", simulated: false, completedAt: createdAt }],
  };
}

it.each([
  { locale: "en", waiting: "Waiting", cancel: "Cancel run" },
  { locale: "fa", waiting: "در انتظار", cancel: "لغو اجرا" },
  { locale: "de", waiting: "Wartend", cancel: "Ausführung abbrechen" },
] as const)("shows a cancellable waiting run in $locale", async ({ locale, waiting, cancel }) => {
  queries.rows = [waitingRow()];
  queries.cancel.mockResolvedValueOnce({ ok: true, value: "cancelled" });
  render(
    <LocaleProvider locale={locale}>
      <RunHistory workflowId={workflowId} canCancel />
    </LocaleProvider>,
  );
  expect(screen.getByText(waiting)).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: cancel }));
  expect(queries.cancel).toHaveBeenCalledTimes(1);
  expect(queries.cancel.mock.calls[0]?.[0]).toBe(runId);
  expect(queries.refetch).toHaveBeenCalledTimes(1);
});

it("keeps waiting history eligible for refresh without granting cancellation", () => {
  queries.rows = [waitingRow()];
  render(
    <LocaleProvider locale="en">
      <RunHistory workflowId={workflowId} canCancel={false} />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument();
  const interval = queries.historyOptions?.refetchInterval({
    state: { data: [{ status: "waiting" }] },
  });
  expect(typeof interval).toBe("number");
  expect(interval).toBeGreaterThan(0);
});

it("identifies the armed wait and stored deadline while preserving a later step selection", async () => {
  queries.detail = waitingDetail();
  const page = () => (
    <LocaleProvider locale="en">
      <RunDetailDialog workflowId={workflowId} runId={runId} onClose={() => undefined} />
    </LocaleProvider>
  );
  const view = render(page());
  const wait = screen.getByRole("button", { name: /Wait one minute/ });
  expect(wait).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Waiting to continue")).toBeVisible();
  expect(screen.getByText("Scheduled resume")).toBeVisible();
  expect(document.querySelector(`time[datetime="${resumeAt.toISOString()}"]`)).toBeInTheDocument();
  const interval = queries.detailOptions?.refetchInterval({
    state: { data: { status: "waiting" } },
  });
  expect(typeof interval).toBe("number");
  expect(interval).toBeGreaterThan(0);
  const read = screen.getByRole("button", { name: /Read deal/ });
  await userEvent.setup().click(read);
  queries.detail = { ...waitingDetail(), updatedAt: new Date("2026-11-01T10:00:30Z") };
  view.rerender(page());
  expect(read).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector(`time[datetime="${resumeAt.toISOString()}"]`)).toBeInTheDocument();
});

it("dismisses waiting run details without cancelling execution", async () => {
  queries.detail = waitingDetail();
  const close = vi.fn();
  render(
    <LocaleProvider locale="en">
      <RunDetailDialog workflowId={workflowId} runId={runId} onClose={close} />
    </LocaleProvider>,
  );
  await userEvent.setup().keyboard("{Escape}");
  expect(close).toHaveBeenCalledTimes(1);
  expect(queries.cancel).not.toHaveBeenCalled();
});

it("labels an immediately advanced simulated wait and its projected resume time", () => {
  queries.detail = {
    ...waitingDetail(),
    status: "succeeded",
    mode: "simulation",
    resumeAt: null,
    nextNodeId: null,
    steps: [
      { nodeId: "start", simulated: true, completedAt: createdAt },
      { nodeId: "wait", simulated: true, completedAt: createdAt, waitResumeAt: resumeAt },
      { nodeId: "read", simulated: true, completedAt: createdAt },
      { nodeId: "task", simulated: true, completedAt: createdAt },
    ],
  };
  render(
    <LocaleProvider locale="en">
      <RunDetailDialog workflowId={workflowId} runId={runId} onClose={() => undefined} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Simulated wait; no real waiting.")).toBeVisible();
  expect(screen.getByText("Simulated resume time")).toBeVisible();
  expect(document.querySelector(`time[datetime="${resumeAt.toISOString()}"]`)).toBeInTheDocument();
  expect(screen.queryByText("Waiting to continue")).not.toBeInTheDocument();
});
