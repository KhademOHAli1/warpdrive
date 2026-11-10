// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import type {
  archiveWorkflowAction,
  cancelWorkflowAction,
  publishWorkflowAction,
  restoreWorkflowDraftAction,
} from "../actions";
import { initialBlankDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition } from "../schemas";
import type { WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowEditor } from "./WorkflowEditor";

type Version = RouterOutputs["workflows"]["version"];
type VersionSummary = RouterOutputs["workflows"]["versions"][number];
type Run = RouterOutputs["workflows"]["runs"][number];
const io = vi.hoisted(() => ({
  save: vi.fn(),
  publish: vi.fn(),
  pause: vi.fn(),
  archive: vi.fn<typeof archiveWorkflowAction>(),
  unarchive: vi.fn(),
  duplicate: vi.fn(),
  restore: vi.fn<typeof restoreWorkflowDraftAction>(),
  cancel: vi.fn<typeof cancelWorkflowAction>(),
  run: vi.fn(),
  retry: vi.fn(),
  push: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
  detailRefresh: vi.fn<() => Promise<void>>(),
  currentRead: vi.fn<() => Promise<WorkflowDetail>>(),
  listRefresh: vi.fn<() => Promise<void>>(),
  versionsRefresh: vi.fn<() => Promise<unknown>>(),
  runsRefresh: vi.fn<(input?: { id: string }) => Promise<unknown>>(),
  versions: [] as VersionSummary[],
  version: undefined as Version | undefined,
  versionsError: false,
  versionError: false,
  versionLoading: false,
  runs: [] as Run[],
  runsError: false,
  runDetail: undefined as RouterOutputs["workflows"]["run"] | undefined,
  versionsRequest: vi.fn<(input: unknown) => void>(),
  versionRequest: vi.fn<(input: unknown) => void>(),
}));
vi.mock("../actions", () => ({
  saveWorkflowAction: io.save,
  publishWorkflowAction: io.publish,
  pauseWorkflowAction: io.pause,
  archiveWorkflowAction: io.archive,
  unarchiveWorkflowAction: io.unarchive,
  duplicateWorkflowAction: io.duplicate,
  restoreWorkflowDraftAction: io.restore,
  cancelWorkflowAction: io.cancel,
  runWorkflowAction: io.run,
  retryWorkflowAction: io.retry,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        get: { invalidate: io.detailRefresh, fetch: io.currentRead },
        list: { invalidate: io.listRefresh },
        versions: { invalidate: io.versionsRefresh },
        runs: {
          invalidate: (input: { id: string }, filters?: { refetchType: string }) =>
            filters?.refetchType === "none" ? Promise.resolve() : io.runsRefresh(input),
        },
        runsPage: { invalidate: () => Promise.resolve() },
        version: {
          fetch: (input: unknown) => {
            io.versionRequest(input);
            return Promise.resolve(io.version);
          },
        },
      },
    }),
    workflows: {
      get: { useQuery: () => ({ refetch: io.detailRefresh, isError: false, isFetching: false }) },
      versions: {
        useQuery: (input: unknown) => {
          io.versionsRequest(input);
          return {
            data: io.versions,
            isLoading: false,
            isError: io.versionsError,
            isFetching: false,
            refetch: io.versionsRefresh,
          };
        },
      },
      version: {
        useQuery: (input: unknown) => {
          io.versionRequest(input);
          return {
            data: io.version,
            isLoading: io.versionLoading,
            isFetching: io.versionLoading,
            isError: io.versionError,
            refetch: io.versionsRefresh,
          };
        },
      },
      runsPage: {
        useQuery: () => ({
          data: { items: io.runs, nextCursor: null },
          isLoading: false,
          isError: io.runsError,
          isFetching: false,
          refetch: io.runsRefresh,
        }),
      },
      run: { useQuery: () => ({ data: io.runDetail, isLoading: false, isError: false }) },
    },
  },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "workflow-csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: io.push, refresh: io.refresh }) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-03", number: String }),
}));
vi.mock("./WorkflowCanvas", () => ({
  WorkflowCanvas: ({
    definition,
    onChange,
    editable,
  }: {
    definition: WorkflowDefinition;
    onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
    editable: boolean;
  }) => (
    <div>
      <fieldset aria-label="Graph fixture">
        <pre>{JSON.stringify(definition)}</pre>
      </fieldset>
      <button
        type="button"
        disabled={!editable}
        onClick={() =>
          onChange({
            ...definition,
            nodes: definition.nodes.map((node) => ({ ...node, name: "Local graph node" })),
            layout: { start: { x: (definition.layout?.start?.x ?? 0) + 42, y: 81 } },
          })
        }
      >
        Edit graph fixture
      </button>
    </div>
  ),
}));

const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const ownerId = "ebecb692-dca5-49f4-96d7-4cf95bd623d9";
const versionId = "617c04ad-c7b6-4a6e-9ca2-146499bf4b38";
const runId = "a1b9eca6-a6a3-45d5-bc85-fc151d4f5a18";
const copyId = "25ad47e2-63bb-4c59-8d25-4067b9075af9";
const locales = [
  {
    locale: "en",
    messages: english,
    versions: "Versions",
    unarchive: "Unarchive workflow",
    restore: "Restore as draft",
  },
  {
    locale: "de",
    messages: german,
    versions: "Versionen",
    unarchive: "Archivierung aufheben",
    restore: "Als Entwurf wiederherstellen",
  },
  {
    locale: "fa",
    messages: persian,
    versions: "نسخه‌ها",
    unarchive: "خروج از بایگانی",
    restore: "بازیابی به‌عنوان پیش‌نویس",
  },
] as const;
function stored(archived = false): Omit<WorkflowDetail, "capabilities"> {
  return {
    id: workflowId,
    ownerId,
    name: "Saved workflow",
    revision: 7,
    draft: initialBlankDefinition("Start"),
    active: !archived,
    publishedNumber: 2,
    archivedAt: archived ? new Date("2026-11-02T00:00:00Z") : null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-03T00:00:00Z"),
  };
}
function fixture(archived = false): WorkflowDetail {
  return {
    ...stored(archived),
    capabilities: {
      edit: !archived,
      publish: !archived,
      run: !archived,
      cancel: true,
      unarchive: archived,
      duplicate: true,
      restore: !archived,
    },
  };
}
function view(initial = fixture(), locale: "en" | "de" | "fa" = "en") {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowEditor initial={initial} />
    </LocaleProvider>
  );
}
function graph() {
  const current = screen.getAllByLabelText("Graph fixture")[0];
  if (current === undefined) throw new Error("Current graph fixture missing");
  return current.textContent;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
async function dirty(user: ReturnType<typeof userEvent.setup>) {
  const name = screen.getByRole("textbox", { name: english.name });
  await user.clear(name);
  await user.type(name, "Unsaved local name");
  await user.click(screen.getByRole("button", { name: "Edit graph fixture" }));
  expect(graph()).toContain("Local graph node");
  return { name, graph: graph() };
}
async function openOptions(
  user: ReturnType<typeof userEvent.setup>,
  label = english.workflowOptions,
) {
  const opener = screen.getByLabelText(label, { selector: "button" });
  if (screen.queryByRole("menu") === null) await user.click(opener);
  return opener;
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: string) {
  const opener = await openOptions(user);
  await user.click(screen.getByRole("menuitem", { name: label }));
  return opener;
}

async function versionReview(user: ReturnType<typeof userEvent.setup>, label = "Versions") {
  await chooseOption(user, label);
  const dialog = await screen.findByRole("dialog");
  await selectVersion(user, dialog);
  return dialog;
}
async function selectVersion(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const selector = within(dialog).queryByRole("combobox");
  if (selector !== null) {
    await user.click(selector);
    await user.click(await screen.findByRole("option", { name: /Earlier saved name/ }));
  } else await user.click(within(dialog).getByRole("button", { name: /Earlier saved name/ }));
  await waitFor(() =>
    expect(io.versionRequest).toHaveBeenCalledWith({ id: workflowId, versionNumber: 1 }),
  );
}
async function beginRestore(user: ReturnType<typeof userEvent.setup>) {
  const review = await versionReview(user);
  await user.click(within(review).getByRole("button", { name: "Restore as draft" }));
  return screen.findByRole("alertdialog");
}
beforeEach(() => {
  vi.clearAllMocks();
  io.save
    .mockReset()
    .mockImplementation(
      (input: { name: string; definition: WorkflowDefinition; revision: number }) =>
        Promise.resolve({
          ok: true,
          value: {
            ...stored(),
            name: input.name,
            draft: input.definition,
            revision: input.revision + 1,
          },
        }),
    );
  io.archive.mockReset().mockResolvedValue({ ok: true, value: { ...stored(true), revision: 8 } });
  io.unarchive
    .mockReset()
    .mockResolvedValue({ ok: true, value: { ...stored(), active: false, revision: 8 } });
  io.duplicate.mockReset().mockResolvedValue({
    ok: true,
    value: { ...stored(), id: copyId, active: false, publishedNumber: null, revision: 1 },
  });
  io.restore.mockReset().mockResolvedValue({
    ok: true,
    value: {
      ...stored(),
      name: "Earlier saved name",
      draft: initialBlankDefinition("Earlier trigger"),
      revision: 8,
    },
  });
  io.cancel.mockReset().mockResolvedValue({ ok: true, value: "cancelled" });
  io.publish.mockReset();
  io.pause.mockReset();
  io.run.mockReset();
  io.retry.mockReset();
  io.push.mockReset();
  io.refresh.mockReset();
  io.detailRefresh.mockReset().mockResolvedValue(undefined);
  io.currentRead.mockReset().mockResolvedValue(fixture());
  io.listRefresh.mockReset().mockResolvedValue(undefined);
  io.versionsRefresh
    .mockReset()
    .mockImplementation(() => Promise.resolve({ data: io.versions, isError: false }));
  io.runsRefresh
    .mockReset()
    .mockImplementation(() => Promise.resolve({ data: io.runs, isError: false }));
  io.versionsError = false;
  io.versionError = false;
  io.versionLoading = false;
  io.runsError = false;
  io.versions = [
    {
      id: versionId,
      number: 1,
      name: "Earlier saved name",
      createdAt: new Date("2026-11-01T00:00:00Z"),
    },
  ];
  io.version = { ...io.versions[0]!, definition: initialBlankDefinition("Earlier trigger") };
  io.runs = [
    {
      id: runId,
      mode: "live",
      status: "waiting",
      resumeAt: new Date("2026-11-04T00:00:00Z"),
      versionId,
      errorId: null,
      createdAt: new Date("2026-11-03T00:00:00Z"),
      updatedAt: new Date("2026-11-03T00:00:00Z"),
      steps: [],
    },
  ];
  io.runDetail = undefined;
});
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

afterEach(cleanup);

describe("archived editor and version history", () => {
  it.each(locales)(
    "keeps archived authoring read-only with independent history/unarchive rights in $locale",
    async ({ locale, messages, versions, unarchive, restore }) => {
      const user = userEvent.setup();
      render(view(fixture(true), locale));
      expect(screen.getByRole("textbox", { name: messages.name })).toBeDisabled();
      expect(screen.queryByRole("button", { name: messages.save })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: messages.publish })).not.toBeInTheDocument();
      const opener = screen.getByRole("button", { name: messages.workflowOptions });
      opener.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("menuitem", { name: messages.live })).toBeDisabled();
      expect(screen.getByRole("menuitem", { name: unarchive })).toBeEnabled();
      screen.getByRole("menuitem", { name: versions }).focus();
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(io.versionsRequest).toHaveBeenCalledWith({ id: workflowId });
      await selectVersion(user, dialog);
      expect(screen.queryByRole("button", { name: restore })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(opener).toHaveFocus());
      expect(io.restore).not.toHaveBeenCalled();
    },
  );

  it("keeps failed version reads recoverable without a false empty/history claim or mutation", async () => {
    io.versions = [];
    io.versionsError = true;
    const user = userEvent.setup();
    render(view());
    await chooseOption(user, "Versions");
    expect(await screen.findByRole("alert")).toHaveTextContent(english.loadError);
    expect(screen.queryByText(english.historyEmpty)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.retry }));
    expect(io.versionsRefresh).toHaveBeenCalledTimes(1);
    expect(io.restore).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });

  it("uses a same-workflow version number, preserving the local draft during historical review", async () => {
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    await versionReview(user);
    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(io.restore).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.versionRequest).not.toHaveBeenCalledWith({
      id: workflowId,
      versionNumber: versionId,
    });
  });
});

describe("restore-as-draft review and acknowledged state", () => {
  it("warns before replacing dirty state; cancel preserves name/graph and makes no write", async () => {
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    const confirmation = await beginRestore(user);
    expect(confirmation).toHaveTextContent("Restore version 1 as draft?");
    expect(confirmation).toHaveTextContent("Your unsaved changes will be replaced");
    expect(confirmation).toHaveTextContent("Replaces only the draft");
    expect(confirmation).toHaveTextContent("7");
    await user.click(within(confirmation).getByRole("button", { name: english.cancel }));
    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(io.restore).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });

  it("retains dirty state on conflict and never runs restore through implicit save", async () => {
    io.restore.mockResolvedValue({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    const confirmation = await beginRestore(user);
    await user.click(within(confirmation).getByRole("button", { name: "Restore as draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(english.conflict);
    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(io.restore).toHaveBeenCalledWith(
      { id: workflowId, revision: 7, versionNumber: 1 },
      "workflow-csrf",
    );
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("holds a single pending restore, then adopts only the acknowledged draft/revision", async () => {
    const held = deferred<Awaited<ReturnType<typeof restoreWorkflowDraftAction>>>();
    io.restore.mockReturnValueOnce(held.promise);
    const result = {
      ok: true as const,
      value: {
        ...stored(),
        name: "Earlier saved name",
        draft: initialBlankDefinition("Earlier trigger"),
        revision: 8,
      },
    };
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    const confirmation = await beginRestore(user);
    try {
      const submit = within(confirmation).getByRole("button", { name: "Restore as draft" });
      await user.click(submit);
      await waitFor(() => expect(io.restore).toHaveBeenCalledTimes(1));
      expect(!submit.isConnected || submit.matches(":disabled")).toBe(true);
      if (submit.isConnected) await user.click(submit);
      else {
        const reviewSubmit = screen.queryByRole("button", { name: "Restore as draft" });
        if (reviewSubmit !== null) await user.click(reviewSubmit);
      }
      expect(io.restore).toHaveBeenCalledTimes(1);
      expect(local.name).toHaveValue("Unsaved local name");
      expect(graph()).toBe(local.graph);
      await act(async () => {
        held.resolve(result);
        await held.promise;
      });
      await waitFor(() => expect(local.name).toHaveValue("Earlier saved name"));
      expect(graph()).toBe(JSON.stringify(result.value.draft));
      expect(screen.getByRole("button", { name: english.save })).toBeDisabled();
      expect(screen.getByText(english.active)).toBeVisible();
      expect(screen.getByText("Published version 2")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent("Version restored as draft");
      expect(io.publish).not.toHaveBeenCalled();
      expect(io.save).not.toHaveBeenCalled();
      await user.clear(local.name);
      await user.type(local.name, "After restore");
      await user.click(screen.getByRole("button", { name: english.save }));
      expect(io.save).toHaveBeenCalledWith(
        { id: workflowId, revision: 8, name: "After restore", definition: result.value.draft },
        "workflow-csrf",
      );
    } finally {
      await act(async () => {
        held.resolve(result);
        await held.promise;
      });
    }
  });

  it("keeps restore ACK truthful after refresh failure and retries only the read", async () => {
    io.detailRefresh.mockRejectedValueOnce(new Error("refresh failed"));
    const user = userEvent.setup();
    render(view());
    const confirmation = await beginRestore(user);
    await user.click(within(confirmation).getByRole("button", { name: "Restore as draft" }));
    await waitFor(() => expect(io.detailRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Version restored as draft");
    expect(screen.getByRole("textbox", { name: english.name })).toHaveValue("Earlier saved name");
    expect(screen.queryByText(english.error)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(io.detailRefresh).toHaveBeenCalledTimes(2));
    expect(io.restore).toHaveBeenCalledTimes(1);
    expect(io.save).not.toHaveBeenCalled();
  });
});

describe("independent lifecycle writes and lost follow-up work", () => {
  it("archives with current revision while retaining dirty name/graph and a known ACK despite failed refresh", async () => {
    const user = userEvent.setup();
    render(view());
    let local = await dirty(user);
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));
    await user.clear(local.name);
    await user.type(local.name, "Newer unsaved name");
    await user.click(screen.getByRole("button", { name: "Edit graph fixture" }));
    local = { name: local.name, graph: graph() };
    io.detailRefresh.mockRejectedValueOnce(new Error("read failed"));
    io.archive.mockResolvedValueOnce({ ok: true, value: { ...stored(true), revision: 9 } });
    await chooseOption(user, "Archive workflow");
    const confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Archive workflow" }));
    await waitFor(() => expect(io.archive).toHaveBeenCalledTimes(1));
    expect(io.archive).toHaveBeenCalledWith({ id: workflowId, revision: 8 }, "workflow-csrf");
    expect(io.save).toHaveBeenCalledTimes(1);
    expect(local.name).toHaveValue("Newer unsaved name");
    expect(graph()).toBe(local.graph);
    expect(screen.getByRole("status")).toHaveTextContent("Workflow archived");
    expect(screen.queryByText(english.error)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    expect(io.archive).toHaveBeenCalledTimes(1);
  });

  it("unarchives inactive without implicit save/publish and retains its new revision through refresh failure", async () => {
    io.detailRefresh.mockRejectedValueOnce(new Error("refresh failed"));
    const user = userEvent.setup();
    render(view(fixture(true)));
    await chooseOption(user, "Unarchive workflow");
    const confirmation = await screen.findByRole("alertdialog");
    expect(confirmation).toHaveTextContent("returns inactive");
    await user.click(within(confirmation).getByRole("button", { name: "Unarchive workflow" }));
    await waitFor(() => expect(io.unarchive).toHaveBeenCalledTimes(1));
    expect(io.unarchive).toHaveBeenCalledWith({ id: workflowId, revision: 7 }, "workflow-csrf");
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Workflow unarchived");
    const name = screen.getByRole("textbox", { name: english.name });
    await user.clear(name);
    await user.type(name, "After unarchive");
    await user.click(screen.getByRole("button", { name: english.save }));
    expect(io.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 8, name: "After unarchive" }),
      "workflow-csrf",
    );
    expect(io.unarchive).toHaveBeenCalledTimes(1);
  });

  it("reviews dirty duplicate departure and preserves unsaved graph/name when staying", async () => {
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    await chooseOption(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Copies the saved draft");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    const leaving = await screen.findByRole("alertdialog");
    expect(leaving).toHaveTextContent(english.leaveUnsaved);
    expect(io.push).not.toHaveBeenCalled();
    const writesBeforeStaying = io.duplicate.mock.calls.length;
    await user.click(within(leaving).getByRole("button", { name: english.leaveCancel }));
    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(io.duplicate).toHaveBeenCalledTimes(writesBeforeStaying);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.push).not.toHaveBeenCalled();
  });

  it("retains a duplicate ACK/new ID when navigation fails, and Open copy never writes again", async () => {
    io.push.mockImplementationOnce(() => {
      throw new Error("navigation failed");
    });
    const user = userEvent.setup();
    render(view());
    await chooseOption(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Name for copied workflow" });
    await user.clear(name);
    await user.type(name, "Saved-state copy");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    await waitFor(() => expect(io.push).toHaveBeenCalledTimes(1));
    expect(io.duplicate).toHaveBeenCalledWith(
      { id: workflowId, revision: 7, name: "Saved-state copy" },
      "workflow-csrf",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Workflow copied");
    expect(screen.queryByText(english.error)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open copy" }));
    expect(io.push).toHaveBeenLastCalledWith(`/workflows/${copyId}`);
    expect(io.duplicate).toHaveBeenCalledTimes(1);
    expect(io.save).not.toHaveBeenCalled();
  });

  it("keeps archived cancellation independent and never replays its ACK after history refresh fails", async () => {
    io.runsRefresh.mockRejectedValueOnce(new Error("history unavailable"));
    const user = userEvent.setup();
    render(view(fixture(true)));
    await user.click(screen.getByRole("tab", { name: english.runs }));
    await user.click(screen.getByRole("button", { name: english.cancelRun }));
    await waitFor(() => expect(io.cancel).toHaveBeenCalledTimes(1));
    expect(io.cancel).toHaveBeenCalledWith(runId, "workflow-csrf");
    expect(screen.getByRole("status")).toHaveTextContent("Run cancelled");
    expect(screen.queryByText(english.error)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    expect(io.cancel).toHaveBeenCalledTimes(1);
    expect(io.run).not.toHaveBeenCalled();
  });
});

describe("current authority and explicit reconciliation regressions", () => {
  it("publishes a clean saved workflow with publish permission alone and never saves first", async () => {
    const initial = fixture();
    initial.capabilities.edit = false;
    initial.capabilities.restore = false;
    const publication = {
      ok: true,
      value: {
        id: versionId,
        workflowId,
        number: 3,
        name: initial.name,
        definition: initial.draft,
        publishedBy: ownerId,
        createdAt: new Date("2026-11-04T00:00:00Z"),
      },
    } satisfies Awaited<ReturnType<typeof publishWorkflowAction>>;
    io.publish.mockResolvedValueOnce(publication);
    const user = userEvent.setup();
    render(view(initial));

    expect(screen.getByRole("textbox", { name: english.name })).toBeDisabled();
    expect(screen.queryByRole("button", { name: english.save })).not.toBeInTheDocument();
    const publish = screen.getByRole("button", { name: english.publish });
    expect(publish).toBeEnabled();
    await user.click(publish);
    const review = screen.getByRole("alertdialog", { name: english.publicationTitle });
    await user.click(within(review).getByRole("button", { name: english.publicationConfirm }));
    await waitFor(() =>
      expect(io.publish).toHaveBeenCalledExactlyOnceWith(workflowId, 7, "workflow-csrf"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(english.published);
    expect(screen.getByText("Published version 3")).toBeVisible();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.archive).not.toHaveBeenCalled();
    expect(io.run).not.toHaveBeenCalled();
  });

  it("uses fresh authority after archive and unarchive instead of restoring cached authoring rights", async () => {
    const archived = { ...fixture(true), revision: 8 };
    const revoked: WorkflowDetail = {
      ...fixture(),
      revision: 9,
      active: false,
      capabilities: {
        edit: false,
        publish: false,
        run: false,
        cancel: false,
        unarchive: false,
        duplicate: false,
        restore: false,
      },
    };
    io.currentRead.mockResolvedValueOnce(archived).mockResolvedValueOnce(revoked);
    io.unarchive.mockResolvedValueOnce({
      ok: true,
      value: { ...stored(), active: false, revision: 9 },
    });
    const user = userEvent.setup();
    render(view());

    await chooseOption(user, "Archive workflow");
    let confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Archive workflow" }));
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await chooseOption(user, "Unarchive workflow");
    confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Unarchive workflow" }));
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(io.archive).toHaveBeenCalledWith({ id: workflowId, revision: 7 }, "workflow-csrf");
    expect(io.unarchive).toHaveBeenCalledWith({ id: workflowId, revision: 8 }, "workflow-csrf");
    expect(io.currentRead).toHaveBeenLastCalledWith({ id: workflowId });
    expect(screen.getByRole("textbox", { name: english.name })).toBeDisabled();
    expect(screen.queryByRole("button", { name: english.save })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: english.publish })).not.toBeInTheDocument();
    await openOptions(user);
    expect(screen.queryByRole("menuitem", { name: "Duplicate workflow" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: english.live })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: english.runs }));
    expect(screen.queryByRole("button", { name: english.cancelRun })).not.toBeInTheDocument();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("adopts a whole fresh baseline and clears old undo history when a clean editor reconciles", async () => {
    const fresh: WorkflowDetail = {
      ...fixture(),
      name: "Server reconciled name",
      draft: initialBlankDefinition("Server reconciled trigger"),
      revision: 11,
    };
    io.archive.mockRejectedValueOnce(new Error("archive response lost"));
    io.currentRead.mockResolvedValueOnce(fresh);
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: "Edit graph fixture" }));
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: english.save })).toBeDisabled());
    expect(screen.getByRole("button", { name: english.undo })).toBeEnabled();
    await chooseOption(user, "Archive workflow");
    const confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Archive workflow" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(english.writeUnknown);
    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledExactlyOnceWith({ id: workflowId }));

    const name = screen.getByRole("textbox", { name: english.name });
    await waitFor(() => expect(name).toHaveValue(fresh.name));
    expect(graph()).toBe(JSON.stringify(fresh.draft));
    expect(screen.getByRole("button", { name: english.save })).toBeDisabled();
    expect(screen.getByRole("button", { name: english.undo })).toBeDisabled();
    expect(screen.queryByText(english.unsaved)).not.toBeInTheDocument();
    expect(io.archive).toHaveBeenCalledTimes(1);
    expect(io.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: english.allowRetry }));
    expect(io.archive).toHaveBeenCalledTimes(1);
    await user.clear(name);
    await user.type(name, "Name after reconciliation");
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(2));
    expect(io.save).toHaveBeenLastCalledWith(
      { id: workflowId, revision: 11, name: "Name after reconciliation", definition: fresh.draft },
      "workflow-csrf",
    );
  });

  it("retains a dirty graph and its original base revision after a newer current read", async () => {
    const fresh: WorkflowDetail = {
      ...fixture(),
      name: "Other writer name",
      draft: initialBlankDefinition("Other writer trigger"),
      revision: 11,
    };
    io.archive.mockRejectedValueOnce(new Error("archive response lost"));
    io.currentRead.mockResolvedValueOnce(fresh);
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    await chooseOption(user, "Archive workflow");
    const confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Archive workflow" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(english.writeUnknown);
    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledTimes(1));

    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(screen.getByText(english.unsaved)).toBeVisible();
    expect(screen.getByRole("button", { name: english.save })).toBeEnabled();
    expect(io.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: english.allowRetry }));
    expect(io.archive).toHaveBeenCalledTimes(1);
    io.save.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));
    expect(io.save).toHaveBeenCalledWith(
      {
        id: workflowId,
        revision: 7,
        name: "Unsaved local name",
        definition: JSON.parse(local.graph ?? "null"),
      },
      "workflow-csrf",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(english.conflict);
    expect(local.name).toHaveValue("Unsaved local name");
    expect(graph()).toBe(local.graph);
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("reports a completed run accurately when cancellation loses a race and never cancels it again", async () => {
    io.cancel.mockResolvedValueOnce({ ok: true, value: "succeeded" });
    io.runsRefresh.mockImplementationOnce(() => {
      io.runs = io.runs.map((run): Run => ({ ...run, status: "succeeded" }));
      return Promise.resolve({ data: io.runs, isError: false });
    });
    const user = userEvent.setup();
    render(view(fixture(true)));
    await user.click(screen.getByRole("tab", { name: english.runs }));
    await user.click(screen.getByRole("button", { name: english.cancelRun }));
    await waitFor(() => expect(io.cancel).toHaveBeenCalledExactlyOnceWith(runId, "workflow-csrf"));
    await waitFor(() => expect(io.runsRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(english.runCancelled)).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(english.status.succeeded);
    expect(screen.queryByRole("button", { name: english.cancelRun })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    expect(io.cancel).toHaveBeenCalledTimes(1);
    expect(io.run).not.toHaveBeenCalled();
  });

  it("requires a successful run read and explicit permission before retrying a lost cancellation response", async () => {
    io.cancel.mockRejectedValueOnce(new Error("cancellation response lost"));
    io.runsRefresh.mockRejectedValueOnce(new Error("first reconciliation read failed"));
    const user = userEvent.setup();
    render(view(fixture(true)));
    await user.click(screen.getByRole("tab", { name: english.runs }));
    const cancel = screen.getByRole("button", { name: english.cancelRun });
    await user.click(cancel);
    await waitFor(() => expect(io.cancel).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(english.cancelUnknown);
    const allow = screen.getByRole("button", { name: english.allowCancelRetry });
    expect(cancel).toBeDisabled();
    expect(allow).toBeDisabled();
    expect(io.runsRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText(english.runCancelled)).not.toBeInTheDocument();
    await user.click(cancel);
    expect(io.cancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(io.runsRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(english.loadError)).toBeVisible();
    expect(screen.queryByText(english.refreshAfterAck)).not.toBeInTheDocument();
    expect(allow).toBeDisabled();
    expect(cancel).toBeDisabled();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(allow).toBeEnabled());
    expect(io.runsRefresh).toHaveBeenCalledTimes(2);
    expect(cancel).toBeDisabled();
    expect(io.cancel).toHaveBeenCalledTimes(1);
    await user.click(allow);
    expect(cancel).toBeEnabled();
    expect(io.cancel).toHaveBeenCalledTimes(1);
    await user.click(cancel);
    await waitFor(() => expect(io.cancel).toHaveBeenCalledTimes(2));
    expect(io.cancel).toHaveBeenLastCalledWith(runId, "workflow-csrf");
    expect(await screen.findByRole("status")).toHaveTextContent(english.runCancelled);
    expect(io.run).not.toHaveBeenCalled();
  });

  it("retains a cancellation ACK while a failed history query reports a read error and never replays the write", async () => {
    io.runsRefresh
      .mockImplementationOnce(() => {
        io.runsError = true;
        return Promise.resolve({ data: io.runs, isError: true });
      })
      .mockImplementationOnce(() => {
        io.runsError = false;
        return Promise.resolve({ data: io.runs, isError: false });
      });
    const user = userEvent.setup();
    render(view(fixture(true)));
    await user.click(screen.getByRole("tab", { name: english.runs }));
    await user.click(screen.getByRole("button", { name: english.cancelRun }));
    await waitFor(() => expect(io.cancel).toHaveBeenCalledExactlyOnceWith(runId, "workflow-csrf"));
    await waitFor(() => expect(io.runsRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent(english.runCancelled);
    expect(await screen.findByRole("alert")).toHaveTextContent(english.loadError);
    expect(screen.getByText(english.refreshAfterAck)).toBeVisible();
    expect(screen.queryByText(english.error)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: english.cancelRun })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(english.runCancelled);
    expect(io.runsRefresh).toHaveBeenCalledTimes(2);
    expect(io.cancel).toHaveBeenCalledTimes(1);
    expect(io.run).not.toHaveBeenCalled();
  });

  it("keeps unknown duplicate reconciliation controls keyboard-accessible inside the real dialog without a replay", async () => {
    io.duplicate.mockRejectedValueOnce(new Error("copy response lost"));
    const user = userEvent.setup();
    render(view());
    await chooseOption(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Name for copied workflow" });
    await user.clear(name);
    await user.type(name, "Review this saved-state copy");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    await waitFor(() => expect(io.duplicate).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(english.writeUnknown);
    expect(name).toHaveValue("Review this saved-state copy");
    expect(name).toBeDisabled();
    const review = within(dialog).getByRole("link", { name: english.reviewLibrary });
    const refresh = within(dialog).getByRole("button", { name: english.refresh });
    expect(within(dialog).getByRole("button", { name: english.allowRetry })).toBeVisible();
    review.focus();
    expect(review).toHaveFocus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(refresh);
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledExactlyOnceWith({ id: workflowId }));
    expect(name).toHaveValue("Review this saved-state copy");
    expect(io.duplicate).toHaveBeenCalledExactlyOnceWith(
      { id: workflowId, revision: 7, name: "Review this saved-state copy" },
      "workflow-csrf",
    );
    expect(io.save).not.toHaveBeenCalled();
    expect(io.push).not.toHaveBeenCalled();
  });

  it("preserves the chosen copy name through unknown-response close and explicit reopen without writing", async () => {
    io.duplicate.mockRejectedValueOnce(new Error("copy response lost"));
    const user = userEvent.setup();
    render(view());
    await chooseOption(user, "Duplicate workflow");
    let dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Name for copied workflow" });
    await user.clear(name);
    await user.type(name, "Keep my reviewed copy name");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    await waitFor(() => expect(io.duplicate).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(english.writeUnknown);
    await user.click(within(dialog).getByRole("button", { name: english.refresh }));
    await waitFor(() => expect(io.currentRead).toHaveBeenCalledTimes(1));
    await user.click(within(dialog).getByRole("button", { name: english.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await openOptions(user);
    expect(screen.getByRole("menuitem", { name: "Duplicate workflow" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: english.allowRetry }));
    expect(io.duplicate).toHaveBeenCalledTimes(1);
    await chooseOption(user, "Duplicate workflow");
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Name for copied workflow" })).toHaveValue(
      "Keep my reviewed copy name",
    );
    expect(io.duplicate).toHaveBeenCalledTimes(1);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.push).not.toHaveBeenCalled();
  });

  it("returns focus to the editor heading when route-opened version history has no opener", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider locale="en">
        <WorkflowEditor initial={fixture()} initialHistory />
      </LocaleProvider>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Versions" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "Saved workflow" })).toHaveFocus();
    });
    expect(io.restore).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.archive).not.toHaveBeenCalled();
  });

  it("returns focus to Workflow options after a held archive conflict and retains the dirty draft", async () => {
    const held = deferred<Awaited<ReturnType<typeof archiveWorkflowAction>>>();
    const conflict = { ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT } as const;
    io.archive.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    render(view());
    const local = await dirty(user);
    const opener = await chooseOption(user, "Archive workflow");
    const confirmation = await screen.findByRole("alertdialog");
    try {
      const submit = within(confirmation).getByRole("button", { name: "Archive workflow" });
      await user.click(submit);
      await waitFor(() => expect(io.archive).toHaveBeenCalledTimes(1));
      expect(submit).toBeDisabled();
      expect(local.name).toHaveValue("Unsaved local name");
      expect(graph()).toBe(local.graph);
      await act(async () => {
        held.resolve(conflict);
        await held.promise;
      });
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(opener).toBeEnabled();
        expect(opener).toHaveFocus();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(english.conflict);
      expect(local.name).toHaveValue("Unsaved local name");
      expect(graph()).toBe(local.graph);
      expect(io.archive).toHaveBeenCalledTimes(1);
      expect(io.save).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        held.resolve(conflict);
        await held.promise;
      });
    }
  });
});

it("retains an archive ACK but removes stale controls after a confirmed current-read denial", async () => {
  io.currentRead.mockRejectedValueOnce({
    message: ERROR_IDS.WORKFLOW_DENIED,
    data: { code: "NOT_FOUND" },
  });
  const user = userEvent.setup();
  render(view());
  await chooseOption(user, english.archive);
  const confirmation = await screen.findByRole("alertdialog");
  await user.click(within(confirmation).getByRole("button", { name: english.archive }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(await screen.findByRole("alert")).toHaveTextContent(english.denied);
  expect(screen.getByRole("status")).toHaveTextContent(english.archivedSaved);
  expect(screen.getByRole("textbox", { name: english.name })).toBeDisabled();
  expect(screen.getByRole("tab", { name: english.runs })).toBeDisabled();
  await openOptions(user);
  expect(screen.queryByRole("menuitem", { name: english.versions })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: english.unarchive })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: english.duplicate })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  const authorized = { ...fixture(true), revision: 8 };
  io.currentRead.mockResolvedValueOnce(authorized);
  await user.click(screen.getByRole("button", { name: english.refresh }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("status")).toHaveTextContent(english.archivedSaved);
  await openOptions(user);
  expect(screen.getByRole("menuitem", { name: english.versions })).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: english.unarchive })).toBeEnabled();
  expect(io.archive).toHaveBeenCalledTimes(1);
  expect(io.save).not.toHaveBeenCalled();
});
