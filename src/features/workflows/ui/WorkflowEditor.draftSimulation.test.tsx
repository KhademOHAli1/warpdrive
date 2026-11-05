// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { branchPort, newIfElseBranch, newIfElseConfig } from "../ifElse";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../schemas";
import { captureDraftTestSnapshot, DraftTestDialog } from "./DraftTestDialog";
import type { WorkflowConfigurationRead } from "./useWorkflowConfiguration";
import type { WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowEditor } from "./WorkflowEditor";

type DraftInput = { workflowId: string; definition: WorkflowDefinition; recordId?: string };
type DraftStep = {
  nodeId: string;
  nodeType: WorkflowNode["type"];
  status: "succeeded" | "failed";
  errorId?: string;
  port?: WorkflowEdge["port"];
  waitResumeAt?: string;
};
type DraftReceipt = {
  source: "draft";
  mode: "simulation";
  workflowId: string;
  definitionDigest: string;
  testedAt: string;
  outcome: "completed" | "failed";
  steps: DraftStep[];
};
type DraftReply = { ok: true; value: DraftReceipt } | { ok: false; error: string };
type SaveInput = { id: string; name: string; definition: WorkflowDefinition; revision: number };
type SaveReply = { ok: true; value: WorkflowDetail } | { ok: false; error: string };

const io = vi.hoisted(() => ({
  simulate: vi.fn<(input: DraftInput, token: string | null) => Promise<DraftReply>>(),
  save: vi.fn<(input: SaveInput, token: string | null) => Promise<SaveReply>>(),
  publish: vi.fn(),
  pause: vi.fn(),
  run: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  duplicate: vi.fn(),
  restore: vi.fn(),
  invalidateRuns: vi.fn<() => Promise<void>>(),
  invalidateDetail: vi.fn<() => Promise<void>>(),
  invalidateList: vi.fn<() => Promise<void>>(),
  invalidateVersions: vi.fn<() => Promise<void>>(),
  push: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock("../actions", () => ({
  simulateWorkflowDraftAction: io.simulate,
  saveWorkflowAction: io.save,
  publishWorkflowAction: io.publish,
  pauseWorkflowAction: io.pause,
  runWorkflowAction: io.run,
  archiveWorkflowAction: io.archive,
  unarchiveWorkflowAction: io.unarchive,
  duplicateWorkflowAction: io.duplicate,
  restoreWorkflowDraftAction: io.restore,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        get: { invalidate: io.invalidateDetail, fetch: () => Promise.resolve(fixture()) },
        list: { invalidate: io.invalidateList },
        versions: { invalidate: io.invalidateVersions },
        runs: { invalidate: io.invalidateRuns },
        runsPage: { invalidate: () => Promise.resolve() },
      },
    }),
    workflows: {
      get: {
        useQuery: () => ({
          data: fixture(),
          isFetching: false,
          isError: false,
          isPlaceholderData: false,
          refetch: () => Promise.resolve(),
        }),
      },
      version: {
        useQuery: () => ({
          data: {
            id: publishedVersionId,
            number: 2,
            name: fixture().name,
            definition: definition(),
          },
          isFetching: false,
          isError: false,
          isPlaceholderData: false,
          refetch: () => Promise.resolve(),
        }),
      },
    },
    search: {
      query: {
        useQuery: (_input: { q: string }, options: { enabled: boolean }) => ({
          data: { deals: options.enabled ? [{ id: recordId, primary: recordName }] : [] },
          isFetching: false,
          isError: false,
        }),
      },
    },
  },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "draft-test-csrf" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: io.push, refresh: io.refresh }),
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/draft-simulation-fixture",
}));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-05", number: String }),
}));
vi.mock("./WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas rendering fixture</div>,
}));
vi.mock("./RunHistory", () => ({
  RunHistory: () => <div>Persisted run history fixture</div>,
}));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: (): WorkflowConfigurationRead => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

const workflowId = "161679f3-46c4-4f53-8ad0-31e7604f8bd0";
const otherWorkflowId = "f51ad946-ab7e-4300-a700-98b6a76f34ee";
const recordId = "635fc45b-e31c-4887-9b86-bde5f6b604da";
const persistedRunId = "7dd7142d-b3f8-4bd1-af16-4a74f13290d6";
const publishedVersionId = "7cb3b1aa-97d4-472e-a673-c397219a4975";
const recordName = "Acme — authorized existing deal";
const dirtyName = "Unsaved draft for review";
const dirtyStep = "Unsaved manual trigger";
const subjectLiteral = "PRIVATE_TASK_SUBJECT_NOT_FOR_TEST_RECEIPT";
const rawDiagnostic = "RAW_TRANSPORT_DIAGNOSTIC_NOT_FOR_UI";
const locales = [
  {
    locale: "en",
    messages: english,
    entry: "Simulate draft",
    results: "Draft simulation results",
    completed: "Draft simulation completed",
  },
  {
    locale: "de",
    messages: german,
    entry: "Entwurf simulieren",
    results: "Ergebnisse der Entwurfssimulation",
    completed: "Entwurfssimulation abgeschlossen",
  },
  {
    locale: "fa",
    messages: persian,
    entry: "شبیه‌سازی پیش‌نویس",
    results: "نتیجه‌های شبیه‌سازی پیش‌نویس",
    completed: "شبیه‌سازی پیش‌نویس تکمیل شد",
  },
] as const;
const genericError = "The draft simulation could not be completed. Your draft is unchanged.";
type Messages = (typeof locales)[number]["messages"];

function definition(): WorkflowDefinition {
  return initialDefinition({ start: "Start", read: "Read", task: "Task", subject: subjectLiteral });
}
function editedDefinition(): WorkflowDefinition {
  const draft = definition();
  return {
    ...draft,
    nodes: draft.nodes.map(
      (node): WorkflowNode =>
        node.id === "start" ? { ...node, name: dirtyStep, nameMode: "custom" } : node,
    ),
  };
}
function fixedInstantDefinition(): WorkflowDefinition {
  const base = definition();
  const [start, read, task] = base.nodes;
  if (start === undefined || read === undefined || task === undefined)
    throw new Error("fixed-instant fixture requires the canonical three-node graph");
  return {
    ...base,
    nodes: [
      start,
      read,
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Fixed instant wait",
        nameMode: "automatic",
        config: {
          until: {
            kind: "value",
            literalType: "instant",
            value: "2030-03-20T12:34:56.123Z",
          },
        },
      },
      task,
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "wait", port: "next" },
      { from: "wait", to: "task", port: "next" },
    ],
  };
}
function fixture(overrides: Partial<WorkflowDetail> = {}): WorkflowDetail {
  return {
    id: workflowId,
    ownerId: "8cafc691-8e9e-4b74-bc3b-5a80bc38978a",
    name: "Saved customer workflow",
    revision: 7,
    draft: definition(),
    active: true,
    publishedNumber: 2,
    archivedAt: null,
    createdAt: new Date("2026-11-01T12:00:00Z"),
    updatedAt: new Date("2026-11-04T12:00:00Z"),
    capabilities: {
      edit: true,
      publish: true,
      run: true,
      cancel: true,
      unarchive: false,
      duplicate: true,
      restore: true,
    },
    ...overrides,
  };
}
function receipt(id = workflowId, draft = editedDefinition()): DraftReceipt {
  return {
    source: "draft",
    mode: "simulation",
    workflowId: id,
    definitionDigest: createHash("sha256").update(JSON.stringify(draft), "utf8").digest("hex"),
    testedAt: "2026-11-05T05:00:00.000Z",
    outcome: "completed",
    steps: draft.nodes.map(
      (node): DraftStep => ({
        nodeId: node.id,
        nodeType: node.type,
        status: "succeeded",
        port: "next",
      }),
    ),
  };
}
function view(initial = fixture(), locale: "en" | "de" | "fa" = "en") {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowEditor initial={initial} />
    </LocaleProvider>
  );
}
async function editUnsavedDraft(
  user: ReturnType<typeof userEvent.setup>,
  messages: Messages = english,
) {
  const name = screen.getByRole("textbox", { name: messages.name });
  const trigger = within(screen.getByRole("navigation", { name: messages.steps })).getAllByRole(
    "button",
  )[0];
  if (trigger === undefined) throw new Error("Draft fixture is missing its trigger step");
  await user.click(trigger);
  const step = screen.getByRole("textbox", { name: messages.stepName });
  await user.clear(name);
  await user.type(name, dirtyName);
  await user.clear(step);
  await user.type(step, dirtyStep);
  return { name, step };
}
async function chooseRecord(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  messages: Messages = english,
) {
  await user.type(within(dialog).getByRole("textbox", { name: messages.search }), "Acme");
  await user.click(within(dialog).getByRole("combobox", { name: messages.deal }));
  await user.click(screen.getByRole("option", { name: recordName }));
}
async function openOptions(user: ReturnType<typeof userEvent.setup>, messages: Messages = english) {
  const opener = screen.getByLabelText(messages.workflowOptions, { selector: "button" });
  if (screen.queryByRole("menu") === null) await user.click(opener);
  return opener;
}
async function openDraft(
  user: ReturnType<typeof userEvent.setup>,
  copy: (typeof locales)[number] = locales[0],
) {
  const opener = await openOptions(user, copy.messages);
  await user.click(screen.getByRole("menuitem", { name: copy.entry }));
  const dialog = screen.getByRole("dialog", { name: copy.entry });
  return { dialog, opener };
}
function draftConfirm(dialog: HTMLElement, messages: Messages = english) {
  return within(dialog).getByRole("button", {
    name: (name) => name === messages.confirmSimulation || name === messages.retry,
  });
}
function expectNoPersistentCommand() {
  expect(io.save).not.toHaveBeenCalled();
  expect(io.publish).not.toHaveBeenCalled();
  expect(io.pause).not.toHaveBeenCalled();
  expect(io.run).not.toHaveBeenCalled();
  expect(io.invalidateRuns).not.toHaveBeenCalled();
  expect(io.invalidateDetail).not.toHaveBeenCalled();
  expect(io.invalidateList).not.toHaveBeenCalled();
  expect(io.invalidateVersions).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  io.simulate
    .mockReset()
    .mockImplementation(
      (input): Promise<DraftReply> =>
        Promise.resolve({ ok: true, value: receipt(input.workflowId, input.definition) }),
    );
  io.save.mockReset().mockImplementation(
    (input): Promise<SaveReply> =>
      Promise.resolve({
        ok: true,
        value: fixture({ name: input.name, draft: input.definition, revision: input.revision + 1 }),
      }),
  );
  io.run.mockReset().mockResolvedValue({ ok: true, value: { id: persistedRunId } });
  io.invalidateRuns.mockReset().mockResolvedValue(undefined);
  io.invalidateDetail.mockReset().mockResolvedValue(undefined);
  io.invalidateList.mockReset().mockResolvedValue(undefined);
  io.invalidateVersions.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("unsaved draft simulation on the actual editor", () => {
  it("keeps ordinary local editing unsaved without issuing any command", async () => {
    const user = userEvent.setup();
    render(view());
    const fields = await editUnsavedDraft(user);

    expect(fields.name).toHaveValue(dirtyName);
    expect(fields.step).toHaveValue(dirtyStep);
    expect(screen.getByText(english.unsaved)).toBeVisible();
    expect(screen.getByRole("button", { name: english.save })).toBeEnabled();
    await openOptions(user);
    expect(screen.getByRole("menuitem", { name: english.simulation })).toBeEnabled();
    expect(io.simulate).not.toHaveBeenCalled();
    expectNoPersistentCommand();
  });

  it("preserves an explicit Save draft as a separate command", async () => {
    const user = userEvent.setup();
    render(view());
    await editUnsavedDraft(user);
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));

    expect(io.save).toHaveBeenCalledWith(
      { id: workflowId, name: dirtyName, definition: editedDefinition(), revision: 7 },
      "draft-test-csrf",
    );
    expect(io.simulate).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.run).not.toHaveBeenCalled();
  });

  it("preserves the existing published simulation and durable-run acknowledgement path", async () => {
    const user = userEvent.setup();
    render(view());
    await openOptions(user);
    await user.click(screen.getByRole("menuitem", { name: english.simulation }));
    const dialog = screen.getByRole("dialog", { name: english.runTitle });
    await chooseRecord(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: english.confirmSimulation }));

    expect(io.run).toHaveBeenCalledExactlyOnceWith(
      {
        workflowId,
        requestKey: expect.any(String),
        recordId,
        mode: "simulation",
        reviewedVersionId: publishedVersionId,
      },
      "draft-test-csrf",
    );
    await waitFor(() => expect(io.invalidateRuns).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("tab", { name: english.runs })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(english.runStarted)).toBeVisible();
    expect(io.simulate).not.toHaveBeenCalled();
  });

  it("simulates a captured Global draft with no deal search or persistent command", async () => {
    const draft = definition();
    draft.nodes = draft.nodes.map((node) =>
      node.type === "trigger.manual" ? { ...node, config: { scope: "global" } } : node,
    );
    render(
      <LocaleProvider locale="en">
        <DraftTestDialog
          snapshot={captureDraftTestSnapshot(workflowId, "Global draft", draft)}
          onClose={vi.fn()}
          onCloseAutoFocus={vi.fn()}
        />
      </LocaleProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: english.draftSimulation });
    expect(within(dialog).queryByRole("combobox", { name: english.deal })).not.toBeInTheDocument();
    expect(draftConfirm(dialog)).toBeEnabled();
    await userEvent.setup().click(draftConfirm(dialog));
    expect(io.simulate).toHaveBeenCalledExactlyOnceWith(
      { workflowId, definition: draft },
      "draft-test-csrf",
    );
    expect(
      within(dialog).getByRole("region", { name: english.draftSimulationResults }),
    ).toHaveTextContent(english.manualGlobalRunHint);
    expectNoPersistentCommand();
  });

  it.each(locales)(
    "simulates the exact dirty name and authored graph without saving in $locale",
    async (copy) => {
      const user = userEvent.setup();
      render(view(fixture(), copy.locale));
      await editUnsavedDraft(user, copy.messages);
      const { dialog } = await openDraft(user, copy);
      expect(dialog).toHaveTextContent(dirtyName);
      expect(draftConfirm(dialog, copy.messages)).toBeDisabled();
      await chooseRecord(user, dialog, copy.messages);
      await user.click(draftConfirm(dialog, copy.messages));

      expect(io.simulate).toHaveBeenCalledExactlyOnceWith(
        { workflowId, definition: editedDefinition(), recordId },
        "draft-test-csrf",
      );
      const results = within(dialog).getByRole("region", { name: copy.results });
      expect(results).toHaveTextContent(copy.completed);
      expect(results).toHaveTextContent(dirtyName);
      expect(results.textContent).not.toContain(subjectLiteral);
      expect(results.textContent).not.toContain(recordId);
      expect(results.textContent).not.toContain(persistedRunId);
      expectNoPersistentCommand();
      await user.click(within(dialog).getByRole("button", { name: copy.messages.cancel }));
      expect(screen.getByRole("textbox", { name: copy.messages.name })).toHaveValue(dirtyName);
      expect(screen.getByRole("textbox", { name: copy.messages.stepName })).toHaveValue(dirtyStep);
      expect(screen.getByText(copy.messages.unsaved)).toBeVisible();
    },
  );

  it("allows an authorized valid unpublished inactive draft without enabling published runs", async () => {
    const user = userEvent.setup();
    render(view(fixture({ active: false, publishedNumber: null })));
    await openOptions(user);
    const entry = screen.getByRole("menuitem", { name: locales[0].entry });
    expect(entry).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: english.simulation })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: english.live })).toBeDisabled();
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));

    expect(io.simulate).toHaveBeenCalledExactlyOnceWith(
      { workflowId, definition: definition(), recordId },
      "draft-test-csrf",
    );
    expectNoPersistentCommand();
  });

  it.each(["edit denied", "run denied", "archived"] as const)(
    "disables draft simulation when %s",
    async (reason) => {
      const user = userEvent.setup();
      const initial = fixture();
      if (reason === "edit denied") initial.capabilities.edit = false;
      else if (reason === "run denied") initial.capabilities.run = false;
      else initial.archivedAt = new Date("2026-11-04T12:00:00Z");
      render(view(initial));

      await openOptions(user);
      expect(screen.getByRole("menuitem", { name: locales[0].entry })).toBeDisabled();
      expect(io.simulate).not.toHaveBeenCalled();
      expectNoPersistentCommand();
    },
  );

  it("withholds simulation for a locally invalid graph while retaining publication validation", async () => {
    const user = userEvent.setup();
    const initial = fixture();
    initial.draft.edges = [{ from: "start", to: "missing", port: "next" }];
    render(view(initial));

    expect(screen.getByRole("button", { name: english.publish })).toBeDisabled();
    await openOptions(user);
    expect(screen.getByRole("menuitem", { name: locales[0].entry })).toBeDisabled();
    expect(io.simulate).not.toHaveBeenCalled();
    expectNoPersistentCommand();
  });

  it("keeps fixed-instant waits publishable while withholding the duration-only draft action", async () => {
    const user = userEvent.setup();
    render(view(fixture({ draft: fixedInstantDefinition() })));

    await openOptions(user);
    expect(screen.getByRole("menuitem", { name: english.draftSimulation })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: english.simulation })).toBeEnabled();
  });

  it("cancels with Escape and restores Workflow options without commands", async () => {
    const user = userEvent.setup();
    render(view());
    await editUnsavedDraft(user);
    const { dialog, opener } = await openDraft(user);
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement))
      throw new Error("Draft dialog did not focus an HTML control");
    expect(dialog).toContainElement(focused);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: locales[0].entry })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole("textbox", { name: english.name })).toHaveValue(dirtyName);
    expect(screen.getByRole("textbox", { name: english.stepName })).toHaveValue(dirtyStep);
    expect(io.simulate).not.toHaveBeenCalled();
    expectNoPersistentCommand();
  });

  it("holds one pending simulation and shows transient per-step results after its reply", async () => {
    let finish!: (reply: DraftReply) => void;
    io.simulate.mockReturnValueOnce(
      new Promise<DraftReply>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(view());
    await editUnsavedDraft(user);
    const configureTab = screen.getByRole("tab", { name: english.configure });
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    const confirm = draftConfirm(dialog);
    await user.click(confirm);

    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: english.search })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: english.deal })).toBeDisabled();
    await user.click(confirm);
    expect(io.simulate).toHaveBeenCalledTimes(1);
    expectNoPersistentCommand();
    await act(async () => {
      finish({ ok: true, value: receipt() });
      await Promise.resolve();
    });

    expect(within(dialog).getByRole("region", { name: locales[0].results })).toHaveTextContent(
      locales[0].completed,
    );
    expect(within(dialog).getAllByText(english.status.succeeded)).toHaveLength(3);
    expect(configureTab).toBeInTheDocument();
    expect(configureTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(english.runStarted)).not.toBeInTheDocument();
    expectNoPersistentCommand();
  });

  it("labels a late result with its captured draft while preserving later local edits", async () => {
    let finish!: (reply: DraftReply) => void;
    io.simulate.mockReturnValueOnce(
      new Promise<DraftReply>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(view());
    const fields = await editUnsavedDraft(user);
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));
    fireEvent.change(fields.name, { target: { value: "Later local draft" } });
    fireEvent.change(fields.step, { target: { value: "Later local trigger" } });
    await act(async () => {
      finish({ ok: true, value: receipt() });
      await Promise.resolve();
    });

    const results = within(dialog).getByRole("region", { name: locales[0].results });
    expect(results).toHaveTextContent(dirtyName);
    expect(results).not.toHaveTextContent("Later local draft");
    expect(io.simulate).toHaveBeenCalledExactlyOnceWith(
      { workflowId, definition: editedDefinition(), recordId },
      "draft-test-csrf",
    );
    await user.click(within(dialog).getByRole("button", { name: english.cancel }));
    expect(screen.getByRole("textbox", { name: english.name })).toHaveValue("Later local draft");
    expect(screen.getByRole("textbox", { name: english.stepName })).toHaveValue(
      "Later local trigger",
    );
    expectNoPersistentCommand();
  });

  it("does not adopt an old pending receipt after workflow retargeting", async () => {
    let finish!: (reply: DraftReply) => void;
    io.simulate.mockReturnValueOnce(
      new Promise<DraftReply>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    const mounted = render(view());
    await editUnsavedDraft(user);
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));
    mounted.rerender(view(fixture({ id: otherWorkflowId, name: "Other workflow" })));
    await act(async () => {
      finish({ ok: true, value: receipt() });
      await Promise.resolve();
    });

    expect(screen.queryByRole("region", { name: locales[0].results })).not.toBeInTheDocument();
    expect(screen.queryByText(locales[0].completed)).not.toBeInTheDocument();
    expect(io.simulate).toHaveBeenCalledTimes(1);
    expectNoPersistentCommand();
  });

  it.each(["refused", "rejected"] as const)(
    "shows a bounded error for a %s simulation without claiming a durable run",
    async (failure) => {
      if (failure === "refused")
        io.simulate.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_DENIED });
      else io.simulate.mockRejectedValueOnce(new Error(rawDiagnostic));
      const user = userEvent.setup();
      render(view());
      const { dialog } = await openDraft(user);
      await chooseRecord(user, dialog);
      await user.click(draftConfirm(dialog));

      expect(within(dialog).getByRole("alert")).toHaveTextContent(genericError);
      expect(dialog).not.toHaveTextContent(rawDiagnostic);
      expect(
        within(dialog).queryByRole("region", { name: locales[0].results }),
      ).not.toBeInTheDocument();
      expect(draftConfirm(dialog)).toBeEnabled();
      expect(screen.queryByText(english.runStarted)).not.toBeInTheDocument();
      expectNoPersistentCommand();
    },
  );

  it("shows a contained failed-step receipt without treating it as a persisted run", async () => {
    const failed = receipt(workflowId, definition());
    failed.outcome = "failed";
    failed.steps = failed.steps.map(
      (step): DraftStep =>
        step.nodeId === "task"
          ? { ...step, status: "failed", errorId: ERROR_IDS.WORKFLOW_INVALID }
          : step,
    );
    io.simulate.mockResolvedValueOnce({ ok: true, value: failed });
    const user = userEvent.setup();
    render(view());
    const configureTab = screen.getByRole("tab", { name: english.configure });
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));

    const results = within(dialog).getByRole("region", { name: locales[0].results });
    expect(results).toHaveTextContent(english.status.failed);
    expect(results.textContent).not.toContain(subjectLiteral);
    expect(screen.queryByText(english.runStarted)).not.toBeInTheDocument();
    expect(configureTab).toBeInTheDocument();
    expect(configureTab).toHaveAttribute("aria-selected", "true");
    expectNoPersistentCommand();
  });

  it("rejects a receipt for a different workflow", async () => {
    io.simulate.mockResolvedValueOnce({ ok: true, value: receipt(otherWorkflowId, definition()) });
    const user = userEvent.setup();
    render(view());
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(genericError);
    expect(
      within(dialog).queryByRole("region", { name: locales[0].results }),
    ).not.toBeInTheDocument();
    expectNoPersistentCommand();
  });

  it.each(["unknown step", "mismatched step type"] as const)(
    "rejects a receipt with an %s against the captured graph",
    async (problem) => {
      const inconsistent = receipt(workflowId, definition());
      inconsistent.steps = inconsistent.steps.map(
        (step): DraftStep =>
          step.nodeId === "task"
            ? problem === "unknown step"
              ? { ...step, nodeId: "not_in_submitted_draft" }
              : { ...step, nodeType: "notification" }
            : step,
      );
      io.simulate.mockResolvedValueOnce({ ok: true, value: inconsistent });
      const user = userEvent.setup();
      render(view());
      const { dialog } = await openDraft(user);
      await chooseRecord(user, dialog);
      await user.click(draftConfirm(dialog));

      expect(within(dialog).getByRole("alert")).toHaveTextContent(genericError);
      expect(
        within(dialog).queryByRole("region", { name: locales[0].results }),
      ).not.toBeInTheDocument();
      expectNoPersistentCommand();
    },
  );

  it.each([
    { routeId: "PRIVATE_CONFIGURED_ROUTE", accepted: true },
    { routeId: "PRIVATE_UNRELATED_ROUTE", accepted: false },
  ])(
    "validates the submitted If/Else branch membership before rendering a receipt ($accepted)",
    async ({ routeId, accepted }) => {
      const draft = definition();
      const config = newIfElseConfig();
      config.branches.push(newIfElseBranch("PRIVATE_CONFIGURED_ROUTE"));
      draft.nodes.splice(2, 0, {
        id: "switch",
        type: "ifElse",
        version: 1,
        name: "Choose route",
        config,
      });
      draft.edges.splice(
        1,
        1,
        { from: "read", to: "switch", port: "next" },
        { from: "switch", to: "wait", port: branchPort("PRIVATE_CONFIGURED_ROUTE") },
      );
      const reply = receipt(workflowId, draft);
      reply.steps = reply.steps.map((step) =>
        step.nodeId === "switch" ? { ...step, port: branchPort(routeId) } : step,
      );
      io.simulate.mockResolvedValueOnce({ ok: true, value: reply });
      render(
        <LocaleProvider locale="en">
          <DraftTestDialog
            snapshot={captureDraftTestSnapshot(workflowId, "Branch test", draft)}
            onClose={vi.fn()}
            onCloseAutoFocus={vi.fn()}
          />
        </LocaleProvider>,
      );
      const dialog = screen.getByRole("dialog", { name: locales[0].entry });
      const user = userEvent.setup();
      await chooseRecord(user, dialog);
      await user.click(draftConfirm(dialog));
      if (accepted) {
        const results = within(dialog).getByRole("region", { name: locales[0].results });
        expect(results).toHaveTextContent(
          english.ifElseSelectedRoute.replace("{route}", "Else if 1"),
        );
      } else {
        expect(within(dialog).getByRole("alert")).toHaveTextContent(genericError);
        expect(
          within(dialog).queryByRole("region", { name: locales[0].results }),
        ).not.toBeInTheDocument();
      }
      expect(dialog).not.toHaveTextContent(routeId);
      expectNoPersistentCommand();
    },
  );

  it("rejects a malformed definition receipt digest", async () => {
    const malformed = receipt(workflowId, definition());
    malformed.definitionDigest = "not-a-definition-digest";
    io.simulate.mockResolvedValueOnce({ ok: true, value: malformed });
    const user = userEvent.setup();
    render(view());
    const { dialog } = await openDraft(user);
    await chooseRecord(user, dialog);
    await user.click(draftConfirm(dialog));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(genericError);
    expect(
      within(dialog).queryByRole("region", { name: locales[0].results }),
    ).not.toBeInTheDocument();
    expectNoPersistentCommand();
  });
});
