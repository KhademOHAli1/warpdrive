// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KpiActionResult,
  KpiDefinition,
  KpiGoalResult,
  KpiScheme,
  KpiWorkspace as WorkspaceData,
} from "@/features/goals/kpiModel";
import { KpiWorkspace } from "./KpiWorkspace";

const actions = vi.hoisted(() => ({
  readKpiWorkspaceAction: vi.fn<(on: string) => Promise<KpiActionResult<WorkspaceData>>>(),
  saveKpiSchemeAction:
    vi.fn<(input: unknown, csrf?: string | null) => Promise<KpiActionResult<unknown>>>(),
  applyKpiSchemeAction: vi.fn(),
  recordKpiMeasurementAction: vi.fn(),
  saveKpiDefinitionAction: vi.fn(),
  createKpiGoalAction: vi.fn(),
  assignKpiGoalAction: vi.fn(),
  previewKpiAction: vi.fn(),
  createKpiPackAction: vi.fn(),
}));
vi.mock("@/features/goals/kpiActions", () => actions);
vi.mock("@/features/goals/actions", () => ({
  createGoalAction: vi.fn(),
  updateGoalAction: vi.fn(),
  deleteGoalAction: vi.fn(),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
vi.mock("@/components/ui/DatePicker", () => ({
  DatePicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    ariaLabel: string;
  }) => (
    <input
      type="date"
      value={value ?? ""}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value || null)}
    />
  ),
}));
vi.mock("@/features/currencies/CurrencySelect", () => ({ CurrencySelect: () => <span>EUR</span> }));

const crm: KpiDefinition = {
  id: "10000000-0000-4000-8000-000000000001",
  familyId: "10000000-0000-4000-8000-000000000002",
  revision: 1,
  createdAt: "2026-11-01T10:00:00Z",
  name: "Won deal value",
  description: "Booked deal value in EUR.",
  source: "deals",
  calculation: "sum",
  valueField: "value",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  filters: { status: "won" },
};
const manual: KpiDefinition = {
  ...crm,
  id: "20000000-0000-4000-8000-000000000001",
  familyId: "20000000-0000-4000-8000-000000000002",
  name: "Revision rounds",
  description: "Approved delivery rework observations.",
  source: "manual",
  calculation: "average",
  unit: "custom",
  customUnit: "rounds",
  dateField: "measured",
  filters: {},
};
const scheme: KpiScheme = {
  id: "30000000-0000-4000-8000-000000000001",
  familyId: "30000000-0000-4000-8000-000000000002",
  revision: 2,
  createdAt: "2026-11-01T10:00:00Z",
  name: "Agency delivery",
  description: "Quality and guardrails.",
  entries: [
    {
      definitionId: manual.id,
      condition: { kind: "range", target: "1.2345", upperTarget: "2.2345" },
    },
  ],
};
const goal: KpiGoalResult = {
  definition: crm,
  goal: {
    id: "40000000-0000-4000-8000-000000000001",
    definitionId: crm.id,
    name: "Review this quarter",
    scope: "company",
    scopeId: null,
    condition: { kind: "at_least", target: "50000" },
    period: { kind: "calendar", interval: "quarterly", startsOn: "2026-10-01" },
    pacing: "none",
    createdAt: "2026-10-01T10:00:00Z",
  },
  measurement: {
    state: "available",
    value: "20000",
    recordCount: 2,
    excludedCount: 0,
    numerator: null,
    denominator: null,
    sampleSize: null,
    contributors: [],
    contributorsTruncated: false,
    evaluatedAt: "2026-11-05T10:00:00Z",
    period: { start: "2026-10-01", end: "2026-12-31" },
    issues: [],
  },
  assessment: { standing: "in_progress", attainment: 0.4, pace: null },
};
const workspace: WorkspaceData = { definitions: [crm, manual], schemes: [scheme], goals: [goal] };
function show() {
  return render(
    <KpiWorkspace
      goals={[]}
      users={[]}
      teams={[]}
      pipelines={[]}
      activityTypes={[]}
      baseCurrency="EUR"
      today="2026-11-05"
    />,
  );
}
function tab(name: string): void {
  const target = screen.getByRole("tab", { name });
  fireEvent.mouseDown(target, { button: 0, ctrlKey: false });
  fireEvent.click(target);
}
async function loaded(): Promise<void> {
  await screen.findByText("Reusable KPIs", { exact: true });
  await waitFor(() => expect(screen.queryByText("Loading KPIs…")).not.toBeInTheDocument());
}

beforeEach(() => {
  actions.readKpiWorkspaceAction.mockResolvedValue({ ok: true, value: workspace });
  actions.saveKpiSchemeAction.mockResolvedValue({ ok: true, value: scheme });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("KPI workspace", () => {
  it("does not present missing schema as an empty library and can retry the read", async () => {
    actions.readKpiWorkspaceAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_KPI_NOT_READY" },
    });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("awaiting its database upgrade");
    tab("KPI library");
    expect(screen.queryByText("Your definition of success starts here")).not.toBeInTheDocument();
    expect(screen.queryByText("Reusable KPIs", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await loaded();
    expect(screen.getByRole("heading", { name: crm.name })).toBeVisible();
  });

  it("combines library search with source filtering", async () => {
    show();
    await loaded();
    tab("KPI library");
    expect(screen.getByRole("heading", { name: crm.name })).toBeVisible();
    expect(screen.getByRole("heading", { name: manual.name })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search KPIs"), { target: { value: "revision" } });
    expect(screen.queryByRole("heading", { name: crm.name })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "deals" },
    });
    expect(screen.getByText("No KPIs match your search.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search KPIs"), { target: { value: "" } });
    expect(screen.getByRole("heading", { name: crm.name })).toBeVisible();
    expect(screen.queryByRole("heading", { name: manual.name })).not.toBeInTheDocument();
  });

  it("makes the manual source requirement visible when starting an agency template", async () => {
    show();
    await loaded();
    tab("Starting packs");
    fireEvent.click(screen.getByRole("button", { name: /^Consulting & agencies/ }));
    const heading = screen.getByRole("heading", { name: "On-time acceptance" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("Source records required")).toBeVisible();
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Use template" }));
    const dialog = screen.getByRole("dialog", { name: "Create KPI" });
    expect(within(dialog).getByText("Required data", { exact: true })).toBeVisible();
    expect(within(dialog).getByText(/Milestone due dates, acceptance records/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByRole("combobox", { name: "Data source" })).toHaveValue("manual");
    expect(within(dialog).getByText(/Manual measurements need a source note/)).toBeVisible();
  });

  it("duplicates a scorecard with exact target precision and no revision identity", async () => {
    show();
    await loaded();
    tab("Scorecards");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate: Agency delivery" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Revision rounds: Target value")).toHaveValue("1.2345");
    expect(within(dialog).getByLabelText("Revision rounds: Upper limit")).toHaveValue("2.2345");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.saveKpiSchemeAction).toHaveBeenCalledTimes(1));
    const input = actions.saveKpiSchemeAction.mock.calls[0]?.[0];
    expect(input).toEqual(
      expect.objectContaining({
        name: "Agency delivery · Duplicate",
        entries: [
          {
            definitionId: manual.id,
            condition: { kind: "range", target: "1.2345", upperTarget: "2.2345" },
          },
        ],
      }),
    );
    expect(input).not.toHaveProperty("familyId");
    expect(input).not.toHaveProperty("expectedRevision");
  });

  it("hides results from the previous date while a new evaluation is loading", async () => {
    let finish: (value: KpiActionResult<WorkspaceData>) => void = vi.fn();
    show();
    await loaded();
    expect(screen.getByRole("heading", { name: "Review this quarter" })).toBeVisible();
    actions.readKpiWorkspaceAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2026-10-05" } });
    expect(await screen.findByText("Loading KPIs…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Review this quarter" })).not.toBeInTheDocument();
    await act(async () => {
      finish({ ok: true, value: { ...workspace, goals: [] } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Give your KPIs a destination")).toBeVisible();
  });
});
