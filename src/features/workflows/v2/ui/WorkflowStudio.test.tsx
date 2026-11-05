// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowV2Document, WorkflowV2Studio } from "@/features/blocks/contracts";
import { WorkflowStudio } from "./WorkflowStudio";
import type * as CanvasModule from "./WorkflowStudioCanvas";

const actions = vi.hoisted(() => ({
  readWorkflowV2StudioAction: vi.fn(),
  saveWorkflowV2Action: vi.fn(),
  publishWorkflowV2Action: vi.fn(),
  pauseWorkflowV2Action: vi.fn(),
  archiveWorkflowV2Action: vi.fn(),
  unarchiveWorkflowV2Action: vi.fn(),
  startWorkflowV2Action: vi.fn(),
  testWorkflowV2DraftAction: vi.fn(),
  rotateWorkflowV2WebhookAction: vi.fn(),
  lookupWorkflowV2RecordsAction: vi.fn(),
  listWorkflowV2RunsAction: vi.fn(),
  readWorkflowV2RunAction: vi.fn(),
  resumeWorkflowV2FormAction: vi.fn(),
  cancelWorkflowV2RunAction: vi.fn(),
}));
vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./WorkflowStudioCanvas", async (importOriginal) => ({
  ...(await importOriginal<typeof CanvasModule>()),
  WorkflowStudioCanvas: () => <div>Canvas</div>,
}));
vi.mock("@/components/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    options,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const id = "10000000-0000-4000-8000-000000000001";
const studio: WorkflowV2Studio = {
  objects: [],
  members: [],
  accounts: [],
  models: [],
  functions: [],
  readiness: {},
};
const initial: WorkflowV2Document = {
  id,
  engineVersion: 2,
  ownerId: id,
  name: "Follow-up",
  revision: 2,
  active: false,
  archivedAt: null,
  publishedNumber: null,
  updatedAt: "2026-11-05T18:00:00Z",
  capabilities: { edit: true, publish: true, run: true, archive: true },
  draft: {
    schemaVersion: 2,
    trigger: { type: "manual", config: {} },
    nodes: [
      {
        id: "delay",
        type: "DELAY",
        version: 1,
        name: "Delay",
        config: { mode: "duration", seconds: 60 },
      },
    ],
    edges: [],
    entryNodeIds: ["delay"],
  },
};
beforeEach(() => {
  actions.readWorkflowV2StudioAction.mockResolvedValue({ ok: true, value: studio });
  actions.listWorkflowV2RunsAction.mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("workflow studio persistence and authority", () => {
  it("saves disconnected work in progress while refusing to test it as executable", async () => {
    const draft = { ...initial.draft, entryNodeIds: [] };
    actions.saveWorkflowV2Action.mockResolvedValueOnce({
      ok: true,
      value: { ...initial, draft, name: "Draft edit", revision: 3 },
    });
    render(<WorkflowStudio initial={{ ...initial, draft }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "Draft edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(actions.saveWorkflowV2Action).toHaveBeenCalledWith(
        { id, expectedRevision: 2, name: "Draft edit", definition: draft },
        "csrf",
      ),
    );
    await screen.findByText("Draft saved");
    fireEvent.click(screen.getByRole("button", { name: "Safe test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connect every step to the trigger");
    expect(actions.testWorkflowV2DraftAction).not.toHaveBeenCalled();
  });
  it("keeps edit, publish, archive, and run privileges separate", async () => {
    render(
      <WorkflowStudio
        initial={{
          ...initial,
          capabilities: { edit: false, publish: false, run: true, archive: false },
        }}
      />,
    );
    await screen.findByRole("combobox", { name: "Change trigger" });
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Safe test" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run live" })).toBeDisabled();
  });
  it("preserves the draft when an optimistic revision conflicts", async () => {
    actions.saveWorkflowV2Action.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_WORKFLOW_V2_CONFLICT" },
    });
    render(<WorkflowStudio initial={initial} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "Preserved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toHaveValue("Preserved");
    expect(actions.publishWorkflowV2Action).not.toHaveBeenCalled();
  });
});

describe("published manual launch", () => {
  const active: WorkflowV2Document = { ...initial, active: true, publishedNumber: 4 };

  it("runs the published global trigger without saving a different dirty draft", async () => {
    const draft: WorkflowV2Document["draft"] = {
      ...initial.draft,
      trigger: { type: "schedule", config: { mode: "interval", intervalMinutes: 30 } },
    };
    actions.testWorkflowV2DraftAction.mockResolvedValue({
      ok: true,
      value: { mode: "test", status: "completed", steps: [] },
    });
    actions.startWorkflowV2Action.mockResolvedValue({ ok: true, value: { id } });
    render(
      <WorkflowStudio
        initial={{ ...active, draft, publishedManualLaunch: { availability: "global" } }}
      />,
    );
    await screen.findByRole("combobox", { name: "Change trigger" });
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "Unsaved schedule draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Safe test" }));
    await waitFor(() =>
      expect(actions.testWorkflowV2DraftAction).toHaveBeenCalledWith(
        { definition: draft, trigger: {} },
        "csrf",
      ),
    );
    const run = screen.getByRole("button", { name: "Run live" });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    const dialog = screen.getByRole("dialog", { name: "Run live" });
    expect(within(dialog).getByText("Version 4")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "Search records" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start live run" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(actions.startWorkflowV2Action).toHaveBeenCalledWith(
      { id, requestKey: expect.any(String), mode: "live", trigger: {}, expectedPublishedNumber: 4 },
      "csrf",
    );
    expect(actions.saveWorkflowV2Action).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toHaveValue(
      "Unsaved schedule draft",
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it.each(["single", "bulk"] as const)(
    "launches with %s records of the published entity and no draft variables",
    async (availability) => {
      const first = "10000000-0000-4000-8000-000000000002";
      const second = "10000000-0000-4000-8000-000000000003";
      actions.lookupWorkflowV2RecordsAction.mockResolvedValue({
        ok: true,
        value: [
          { id: first, label: "First deal" },
          { id: second, label: "Second deal" },
        ],
      });
      actions.startWorkflowV2Action.mockResolvedValue({ ok: true, value: { id } });
      render(
        <WorkflowStudio
          initial={{
            ...active,
            publishedManualLaunch: { availability, objectName: "deal" },
            draft: {
              ...initial.draft,
              trigger: { type: "manual", config: { availability: "single", objectName: "person" } },
            },
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Run live" }));
      const dialog = screen.getByRole("dialog", { name: "Run live" });
      const confirm = within(dialog).getByRole("button", { name: "Start live run" });
      expect(confirm).toBeDisabled();
      expect(within(dialog).queryByRole("button", { name: /choose a variable/i })).toBeNull();
      fireEvent.click(await within(dialog).findByRole("button", { name: "First deal" }));
      if (availability === "bulk") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Second deal" }));
      }
      expect(actions.lookupWorkflowV2RecordsAction).toHaveBeenCalledExactlyOnceWith({
        objectName: "deal",
        search: "",
      });
      fireEvent.click(confirm);
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(actions.startWorkflowV2Action).toHaveBeenCalledWith(
        {
          id,
          requestKey: expect.any(String),
          mode: "live",
          expectedPublishedNumber: 4,
          trigger: availability === "bulk" ? { recordIds: [first, second] } : { recordId: first },
        },
        "csrf",
      );
    },
  );

  it.each<[string, Partial<WorkflowV2Document>]>([
    ["nonmanual publication", {}],
    ["unpublished manual draft", { publishedNumber: null }],
    ["paused workflow", { active: false, publishedManualLaunch: { availability: "global" } }],
    [
      "read-only workflow",
      { capabilities: { edit: false, publish: false, run: false, archive: false } },
    ],
  ])("disables live launch for a %s", async (_label, overrides) => {
    render(<WorkflowStudio initial={{ ...active, ...overrides }} />);
    await screen.findByRole("combobox", { name: "Change trigger" });
    const run = screen.getByRole("button", { name: "Run live" });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.startWorkflowV2Action).not.toHaveBeenCalled();
  });
});
