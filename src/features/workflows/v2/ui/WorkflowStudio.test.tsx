// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
