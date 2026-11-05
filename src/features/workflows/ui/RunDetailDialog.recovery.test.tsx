// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import { RunDetailDialog } from "./RunDetailDialog";
import type { RunDetail } from "./RunTrace";

type RunInput = { id: string; runId: string };
const reads = vi.hoisted(() => ({
  read: vi.fn<(input: RunInput) => Promise<RunDetail>>(),
}));

// Keep the actual query cache and observer transitions, including retained data after a
// background error. Only the transport is replaced; the Dialog remains the real component.
vi.mock("@/lib/trpc-client", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    trpc: {
      workflows: {
        run: {
          useQuery: (
            input: RunInput,
            options: Omit<
              UseQueryOptions<RunDetail, Error, RunDetail, ReturnType<typeof runKey>>,
              "queryKey" | "queryFn"
            >,
          ) =>
            useQuery({
              queryKey: runKey(input.id, input.runId),
              queryFn: () => reads.read(input),
              ...options,
            }),
        },
      },
    },
  };
});

vi.mock("./RunTrace", () => ({
  RunTrace: function TraceFixture({
    detail,
    workflowId,
  }: {
    detail: RunDetail;
    workflowId?: string;
  }) {
    const [selected, setSelected] = useState(false);
    return (
      <section data-testid="run-trace" aria-label="Historical run graph">
        <p>Authorized historical graph fixture</p>
        <p>{`${workflowId}:${detail.id}:${detail.status}:${detail.number}`}</p>
        <button type="button" onClick={() => setSelected(true)}>
          Inspect historical step
        </button>
        {selected && <p>Selected historical step</p>}
      </section>
    );
  },
}));

const workflowId = "07f14a03-284b-4e7e-a9fb-8653f605ef02";
const otherWorkflowId = "f69e5d42-204a-4ed5-a35d-151f7dddf180";
const runId = "ff6acd57-f33a-44b8-82fb-cd455ff79c58";
const otherRunId = "b7d1716e-2d88-4d65-ae7b-e43f5b450325";
const locales = [
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const;
type Locale = (typeof locales)[number]["locale"];
const clients: QueryClient[] = [];

function runKey(id = workflowId, selectedRunId = runId) {
  return ["workflows", "run", { id, runId: selectedRunId }] as const;
}

function detail(status: RunDetail["status"] = "succeeded", id = runId): RunDetail {
  return {
    id,
    number: 2,
    status,
    mode: "simulation",
    resumeAt: null,
    errorId: null,
    nextNodeId: null,
    createdAt: new Date("2026-11-05T09:00:00Z"),
    updatedAt: new Date("2026-11-05T09:01:00Z"),
    definition: initialDefinition({
      start: "Start",
      read: "Read",
      task: "Historical task",
      subject: "Historical subject",
    }),
    steps: [],
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Harness({
  locale,
  workflow,
  run,
  onClose,
  onCloseAutoFocus,
}: {
  locale: Locale;
  workflow: string;
  run: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [open, setOpen] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <LocaleProvider locale={locale}>
      <button type="button" ref={opener} onClick={() => setOpen(true)}>
        Open historical run
      </button>
      {open && (
        <RunDetailDialog
          workflowId={workflow}
          runId={run}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus(event);
            event.preventDefault();
            opener.current?.focus();
          }}
        />
      )}
    </LocaleProvider>
  );
}

function mount(locale: Locale = "en") {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        // A global previous-data policy must not carry another run into the inspector.
        placeholderData: keepPreviousData,
      },
    },
  });
  clients.push(client);
  const onClose = vi.fn();
  const onCloseAutoFocus = vi.fn<(event: Event) => void>();
  function tree(workflow = workflowId, run = runId) {
    return (
      <QueryClientProvider client={client}>
        <Harness
          locale={locale}
          workflow={workflow}
          run={run}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      </QueryClientProvider>
    );
  }
  return { ...render(tree()), client, tree, onClose, onCloseAutoFocus };
}

beforeEach(() => {
  reads.read.mockReset();
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

it.each(locales)(
  "keeps localized loading feedback, Escape, and caller focus restoration in $locale",
  async ({ locale, messages }) => {
    reads.read.mockReturnValue(deferred<RunDetail>().promise);
    const view = mount(locale);
    expect(screen.getByRole("status")).toHaveTextContent(messages.loading);
    expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(view.onCloseAutoFocus).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Open historical run" })).toHaveFocus();
  },
);

it.each(locales)(
  "hides retained authorized graph data after a denied background read in $locale",
  async ({ locale, messages }) => {
    const snapshot = detail();
    reads.read.mockResolvedValueOnce(snapshot).mockRejectedValue(new Error("private denied read"));
    const { client } = mount(locale);
    expect(await screen.findByTestId("run-trace")).toHaveTextContent(
      "Authorized historical graph fixture",
    );

    await act(async () => {
      await client.refetchQueries({ queryKey: runKey() });
    });
    await waitFor(() => expect(client.getQueryState(runKey())?.status).toBe("error"));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.loadError);
    // This is a display boundary. The previously authorized cache entry still exists.
    expect(client.getQueryData(runKey())).toEqual(snapshot);
    expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
    expect(screen.queryByText("Authorized historical graph fixture")).not.toBeInTheDocument();
    expect(screen.queryByText("private denied read")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.retry })).toBeEnabled();
    expect(reads.read).toHaveBeenCalledTimes(2);
  },
);

it.each(locales)(
  "retries the same read once, blocks duplicate clicks, and restores a confirmed graph in $locale",
  async ({ locale, messages }) => {
    const recovery = deferred<RunDetail>();
    reads.read
      .mockRejectedValueOnce(new Error("private initial read error"))
      .mockReturnValueOnce(recovery.promise);
    const { client } = mount(locale);
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.loadError);
    const user = userEvent.setup();
    const retry = screen.getByRole("button", { name: messages.retry });
    await user.click(retry);
    await waitFor(() => expect(reads.read).toHaveBeenCalledTimes(2));
    expect(retry).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(messages.loading);
    expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
    await user.click(retry);
    expect(reads.read).toHaveBeenCalledTimes(2);
    expect(reads.read).toHaveBeenNthCalledWith(2, { id: workflowId, runId });

    await act(async () => {
      recovery.resolve(detail());
      await recovery.promise;
    });
    expect(await screen.findByTestId("run-trace")).toHaveTextContent(`${workflowId}:${runId}`);
    expect(client.getQueryState(runKey())?.status).toBe("success");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.retry })).not.toBeInTheDocument();
    expect(reads.read).toHaveBeenCalledTimes(2);
  },
);

it("keeps a healthy running snapshot and selection during a background read, then shows progress", async () => {
  const refresh = deferred<RunDetail>();
  reads.read.mockResolvedValueOnce(detail("running")).mockReturnValueOnce(refresh.promise);
  const { client } = mount();
  const trace = await screen.findByTestId("run-trace");
  await userEvent.setup().click(screen.getByRole("button", { name: "Inspect historical step" }));
  let refreshDone!: Promise<void>;
  act(() => {
    refreshDone = client.refetchQueries({ queryKey: runKey() });
  });
  await waitFor(() => expect(client.getQueryState(runKey())?.fetchStatus).toBe("fetching"));
  expect(screen.getByTestId("run-trace")).toBe(trace);
  expect(trace).toHaveTextContent(`${runId}:running:2`);
  expect(screen.getByText("Selected historical step")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await act(async () => {
    refresh.resolve({ ...detail(), number: 3 });
    await refreshDone;
  });
  await waitFor(() => expect(trace).toHaveTextContent(`${runId}:succeeded:3`));
  expect(screen.getByText("Selected historical step")).toBeInTheDocument();
  expect(reads.read).toHaveBeenCalledTimes(2);
});

it("stops automatic polling after an active run read fails until the user retries", async () => {
  reads.read.mockResolvedValueOnce(detail("waiting")).mockRejectedValue(new Error("denied"));
  const { client } = mount();
  await screen.findByTestId("run-trace");
  await act(async () => {
    await client.refetchQueries({ queryKey: runKey() });
  });
  await screen.findByRole("alert");
  expect(reads.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2700));
  });
  expect(reads.read).toHaveBeenCalledTimes(2);
});

it("does not display another run as a placeholder when retargeted", async () => {
  const nextRead = deferred<RunDetail>();
  reads.read.mockResolvedValueOnce(detail()).mockReturnValueOnce(nextRead.promise);
  const view = mount();
  await screen.findByTestId("run-trace");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Inspect historical step" }));
  expect(screen.getByText("Selected historical step")).toBeInTheDocument();

  view.rerender(view.tree(workflowId, otherRunId));
  expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
  expect(screen.queryByText("Selected historical step")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(english.loading);
  await act(async () => {
    nextRead.resolve(detail("succeeded", otherRunId));
    await nextRead.promise;
  });
  expect(await screen.findByTestId("run-trace")).toHaveTextContent(`${workflowId}:${otherRunId}`);
  expect(screen.queryByText("Selected historical step")).not.toBeInTheDocument();
  expect(reads.read).toHaveBeenCalledTimes(2);
});

it("does not carry a same-run placeholder into another workflow context", async () => {
  const nextRead = deferred<RunDetail>();
  reads.read.mockResolvedValueOnce(detail()).mockReturnValueOnce(nextRead.promise);
  const view = mount();
  await screen.findByTestId("run-trace");
  view.rerender(view.tree(otherWorkflowId));
  expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(english.loading);
  await act(async () => {
    nextRead.resolve(detail());
    await nextRead.promise;
  });
  expect(await screen.findByTestId("run-trace")).toHaveTextContent(`${otherWorkflowId}:${runId}`);
  expect(reads.read).toHaveBeenNthCalledWith(2, { id: otherWorkflowId, runId });
});

it("resets the inspector selection when the workflow changes with the same cached run ID", async () => {
  reads.read.mockResolvedValueOnce(detail());
  const view = mount();
  await screen.findByTestId("run-trace");
  await userEvent.setup().click(screen.getByRole("button", { name: "Inspect historical step" }));
  expect(screen.getByText("Selected historical step")).toBeInTheDocument();
  view.client.setQueryData(runKey(otherWorkflowId), detail());

  view.rerender(view.tree(otherWorkflowId));
  expect(screen.getByTestId("run-trace")).toHaveTextContent(`${otherWorkflowId}:${runId}`);
  expect(screen.queryByText("Selected historical step")).not.toBeInTheDocument();
  expect(reads.read).toHaveBeenCalledTimes(1);
});

it("hides a retained response whose run identity does not match the requested run", async () => {
  reads.read.mockResolvedValue(detail("running", otherRunId));
  const { client } = mount();
  await waitFor(() => expect(client.getQueryState(runKey())?.status).toBe("success"));
  expect(screen.queryByTestId("run-trace")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(english.loadError);
  expect(screen.getByRole("button", { name: english.retry })).toBeEnabled();
  expect(reads.read).toHaveBeenCalledExactlyOnceWith({ id: workflowId, runId });
});
