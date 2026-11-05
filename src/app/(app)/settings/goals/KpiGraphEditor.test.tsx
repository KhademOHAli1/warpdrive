// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiActionResult, KpiDefinition, KpiMeasurement } from "@/features/goals/kpiModel";
import type { KpiGraphCanvasProps } from "./KpiGraphCanvas";
import { KpiGraphEditor, type KpiGraphEditorProps } from "./KpiGraphEditor";

const actions = vi.hoisted(() => ({
  previewKpiAction: vi.fn<(...args: unknown[]) => Promise<KpiActionResult<KpiMeasurement>>>(),
  saveKpiDefinitionAction: vi.fn<(...args: unknown[]) => Promise<KpiActionResult<KpiDefinition>>>(),
}));
const canvas = vi.hoisted(() => ({ current: undefined as KpiGraphCanvasProps | undefined }));
vi.mock("@/features/goals/kpiActions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./KpiGraphCanvas", () => ({
  KpiGraphCanvas: (props: KpiGraphCanvasProps) => {
    canvas.current = props;
    return <div data-testid="graph-canvas">{props.graph.nodes.length} nodes</div>;
  },
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
vi.mock("@/features/currencies/CurrencySelect", () => ({ CurrencySelect: () => <span>EUR</span> }));

const definition: KpiDefinition = {
  id: "10000000-0000-4000-8000-000000000001",
  familyId: "10000000-0000-4000-8000-000000000002",
  revision: 2,
  createdAt: "2026-11-05T10:00:00Z",
  name: "Won value",
  description: "Booked deal value.",
  source: "deals",
  calculation: "sum",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  valueField: "value",
  filters: { status: "won" },
};
const measurement: KpiMeasurement = {
  state: "available",
  value: "12000",
  recordCount: 1,
  excludedCount: 0,
  numerator: null,
  denominator: null,
  sampleSize: 1,
  contributors: [],
  contributorsTruncated: false,
  issues: [],
  period: { start: "2026-11-01", end: "2026-11-30" },
  evaluatedAt: "2026-11-05T10:00:00Z",
  nodeResults: [
    { nodeId: "data", type: "number", value: "12000", state: "available", issues: [] },
    { nodeId: "result", type: "number", value: "12000", state: "available", issues: [] },
  ],
};
function show(patch: Partial<KpiGraphEditorProps> = {}) {
  const props: KpiGraphEditorProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    baseCurrency: "EUR",
    ...patch,
  };
  return { ...render(<KpiGraphEditor {...props} />), props };
}
function previewAction() {
  return within(screen.getByRole("banner")).getByRole("button", { name: /^Preview$/ });
}
async function preview() {
  fireEvent.click(previewAction());
  await waitFor(() => expect(actions.previewKpiAction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(previewAction()).toBeEnabled());
}

beforeEach(() => {
  actions.previewKpiAction.mockResolvedValue({ ok: true, value: measurement });
  actions.saveKpiDefinitionAction.mockResolvedValue({ ok: true, value: definition });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  canvas.current = undefined;
});

describe("KPI graph editor", () => {
  it("requires a current preview and submits a real graph once while save is pending", async () => {
    let finish: (value: KpiActionResult<KpiDefinition>) => void = vi.fn();
    actions.saveKpiDefinitionAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { props } = show();
    fireEvent.change(screen.getByLabelText("KPI name"), { target: { value: "Won value custom" } });
    expect(screen.getByRole("button", { name: "Save KPI" })).toBeDisabled();
    await preview();
    const save = screen.getByRole("button", { name: "Save KPI" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(actions.saveKpiDefinitionAction).toHaveBeenCalledTimes(1);
    expect(actions.saveKpiDefinitionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Won value custom",
        graph: expect.objectContaining({
          outputNodeId: "result",
          edges: [
            expect.objectContaining({ source: "data", target: "result", targetHandle: "value" }),
          ],
        }),
      }),
      "csrf",
    );
    await act(async () => {
      finish({ ok: true, value: definition });
      await Promise.resolve();
    });
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("invalidates a successful preview when a source filter changes", async () => {
    show({ initialDefinition: definition });
    await preview();
    expect(screen.getByRole("button", { name: "Publish revision" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Matching records" }), {
      target: { value: "lost" },
    });
    expect(screen.getByRole("button", { name: "Publish revision" })).toBeDisabled();
    expect(canvas.current?.graph.nodes.find((node) => node.type === "metric")).toMatchObject({
      metric: { filters: { status: "lost" } },
    });
    expect(actions.saveKpiDefinitionAction).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "publishes with the correct revision identity when duplicate is %s",
    async (duplicate) => {
      const { props } = show({ initialDefinition: definition, duplicate });
      await preview();
      fireEvent.click(
        screen.getByRole("button", { name: duplicate ? "Save KPI" : "Publish revision" }),
      );
      await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
      const input = actions.saveKpiDefinitionAction.mock.calls[0]?.[0];
      if (duplicate) {
        expect(input).not.toHaveProperty("familyId");
        expect(input).not.toHaveProperty("expectedRevision");
      } else
        expect(input).toEqual(
          expect.objectContaining({ familyId: definition.familyId, expectedRevision: 2 }),
        );
    },
  );
  it("preserves the graph and reports a revision conflict without claiming a save", async () => {
    actions.saveKpiDefinitionAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_KPI_CONFLICT" },
    });
    const { props } = show({ initialDefinition: definition });
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Publish revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A newer revision was published");
    expect(screen.getByLabelText("KPI name")).toHaveValue(definition.name);
    expect(canvas.current?.graph.nodes).toHaveLength(2);
    expect(props.onSaved).not.toHaveBeenCalled();
  });
  it("supports adding and connecting a value through keyboard-accessible input pickers", async () => {
    show();
    fireEvent.change(screen.getByLabelText("KPI name"), { target: { value: "Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    fireEvent.click(screen.getByRole("button", { name: "Number" }));
    const constant = canvas.current?.graph.nodes.find((node) => node.type === "constant");
    expect(constant).toBeDefined();
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Select a node" }), {
      target: { value: "result" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Input values: Result value" }), {
      target: { value: constant?.id },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Select a node" }), {
      target: { value: "data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    expect(canvas.current?.graph.edges).toEqual([
      expect.objectContaining({ source: constant?.id, target: "result", targetHandle: "value" }),
    ]);
    expect(canvas.current?.graph.nodes.some((node) => node.id === "data")).toBe(false);
    await preview();
    expect(actions.previewKpiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ type: "constant", value: "2" }),
          ]),
        }),
      }),
      { scope: "company", scopeId: null },
      expect.anything(),
      "csrf",
    );
  });
  it("ignores a preview response belonging to an editor session that has been replaced", async () => {
    let finish: (value: KpiActionResult<KpiMeasurement>) => void = vi.fn();
    actions.previewKpiAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { props, rerender } = show({ initialDefinition: definition });
    fireEvent.click(previewAction());
    rerender(
      <KpiGraphEditor
        {...props}
        initialDefinition={{ ...definition, id: "different", name: "Another KPI" }}
      />,
    );
    await act(async () => {
      finish({ ok: true, value: measurement });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("KPI name")).toHaveValue("Another KPI");
    expect(screen.getByRole("button", { name: "Publish revision" })).toBeDisabled();
  });
  it("keeps a dirty draft on Escape until the user explicitly discards it", () => {
    const { props } = show({ initialDefinition: definition });
    fireEvent.change(screen.getByLabelText("KPI name"), { target: { value: "Preserved draft" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("Discard this draft?");
    expect(props.onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("KPI name")).toHaveValue("Preserved draft");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard changes" }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(actions.saveKpiDefinitionAction).not.toHaveBeenCalled();
  });
});
