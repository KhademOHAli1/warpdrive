// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiActionResult, KpiDefinition, KpiMeasurement } from "@/features/goals/kpiModel";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { KpiBuilder, type KpiBuilderProps } from "./KpiBuilder";

const actions = vi.hoisted(() => ({
  assignKpiGoalAction: vi.fn<() => Promise<KpiActionResult<unknown>>>(),
  createKpiGoalAction: vi.fn<() => Promise<KpiActionResult<unknown>>>(),
  saveKpiDefinitionAction: vi.fn<() => Promise<KpiActionResult<unknown>>>(),
  previewKpiAction: vi.fn<() => Promise<KpiActionResult<KpiMeasurement>>>(),
}));
vi.mock("@/features/goals/kpiActions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
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

const definition: KpiDefinition = {
  id: "10000000-0000-4000-8000-000000000001",
  familyId: "10000000-0000-4000-8000-000000000002",
  revision: 2,
  createdAt: "2026-11-05T10:00:00Z",
  name: "Lost deals",
  description: "Keep losses within the agreed ceiling.",
  source: "deals",
  calculation: "count",
  unit: "count",
  dateField: "closed",
  filters: { status: "lost" },
};
const measurement: KpiMeasurement = {
  state: "available",
  value: "0",
  recordCount: 0,
  excludedCount: 0,
  numerator: null,
  denominator: null,
  sampleSize: null,
  contributors: [],
  contributorsTruncated: false,
  issues: ["viewer_visible_records"],
  evaluatedAt: "2026-11-05T10:00:00Z",
  period: { start: "2026-11-01", end: "2026-11-30" },
};
function show(patch: Partial<KpiBuilderProps> = {}) {
  const props: KpiBuilderProps = {
    users: [],
    teams: [],
    pipelines: [],
    activityTypes: [],
    initial: definition,
    initialCondition: { kind: "at_most", target: "0" },
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...patch,
  };
  return { ...render(<KpiBuilder {...props} />), props };
}
function advance(times: number) {
  for (let index = 0; index < times; index += 1)
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview result" }));
  await waitFor(() =>
    expect(screen.queryByText("Calculating your preview…")).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  actions.assignKpiGoalAction.mockResolvedValue({ ok: true, value: {} });
  actions.createKpiGoalAction.mockResolvedValue({ ok: true, value: {} });
  actions.saveKpiDefinitionAction.mockResolvedValue({ ok: true, value: definition });
  actions.previewKpiAction.mockResolvedValue({ ok: true, value: measurement });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("KPI builder", () => {
  it.each(["percentage", "ratio"])(
    "defaults an activity %s to due-date eligibility while keeping the basis editable",
    (calculation) => {
      show();
      advance(1);
      fireEvent.change(screen.getByRole("combobox", { name: "Data source" }), {
        target: { value: "activities" },
      });
      expect(screen.getByRole("combobox", { name: "Date that defines the period" })).toHaveValue(
        "completed",
      );
      fireEvent.change(screen.getByRole("combobox", { name: "Calculation" }), {
        target: { value: calculation },
      });
      expect(screen.getByRole("combobox", { name: "Date that defines the period" })).toHaveValue(
        "due",
      );
      const aside = screen.getByText("Your KPI, in plain language").closest("aside");
      expect(aside).toHaveTextContent(
        "Numerator: activities (completed). Denominator: activities (all eligible records). Uses due date.",
      );
      fireEvent.change(screen.getByRole("combobox", { name: "Date that defines the period" }), {
        target: { value: "created" },
      });
      expect(screen.getByRole("combobox", { name: "Date that defines the period" })).toHaveValue(
        "created",
      );
      expect(aside).toHaveTextContent("Uses creation date.");
    },
  );

  it("explains a lost-deal ceiling with its status and date basis in plain language", () => {
    show();
    const aside = screen.getByText("Your KPI, in plain language").closest("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveTextContent("should be at most 0 during the monthly period");
    expect(aside).not.toHaveTextContent("0 Number");
    expect(
      within(aside as HTMLElement).getByText("Count records of deals (lost), using closure date."),
    ).toBeVisible();
  });

  it("makes both parts of a percentage calculation visible in the plain-language explanation", () => {
    show({
      initial: {
        ...definition,
        name: "Win rate",
        calculation: "percentage",
        unit: "percent",
        filters: { status: "all" },
        numeratorStatus: "won",
        denominatorStatus: "closed",
      },
      initialCondition: { kind: "at_least", target: "65" },
    });
    const aside = screen.getByText("Your KPI, in plain language").closest("aside");
    expect(aside).toHaveTextContent("at least 65%");
    expect(aside).toHaveTextContent(
      "Numerator: deals (won). Denominator: deals (closed). Uses closure date.",
    );
  });

  it("requires a preview and saves zero ceilings atomically without duplicate submits", async () => {
    let finish: (value: KpiActionResult<unknown>) => void = vi.fn();
    actions.createKpiGoalAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onBusyChange = vi.fn();
    const { props } = show({ onBusyChange });
    advance(3);
    expect(screen.getByRole("button", { name: "Create goal" })).toBeDisabled();
    await preview();
    const create = screen.getByRole("button", { name: "Create goal" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(actions.createKpiGoalAction).toHaveBeenCalledTimes(1);
    expect(actions.createKpiGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment: expect.objectContaining({
          condition: { kind: "at_most", target: "0" },
          pacing: "none",
        }),
      }),
      "csrf",
    );
    expect(actions.saveKpiDefinitionAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => {
      finish({ ok: true, value: {} });
      await Promise.resolve();
    });
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("retains the authored target after a failed save and allows retry", async () => {
    actions.createKpiGoalAction.mockResolvedValueOnce({ ok: false, error: { id: "E_KPI_FAILED" } });
    const { props } = show();
    advance(2);
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "5" } });
    advance(1);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is still here");
    expect(props.onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Target")).toHaveValue("5");
    advance(1);
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    expect(actions.createKpiGoalAction).toHaveBeenCalledTimes(2);
  });

  it("invalidates an earlier preview when its target changes", async () => {
    show();
    advance(3);
    await preview();
    expect(screen.getByRole("button", { name: "Create goal" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "2" } });
    advance(1);
    expect(screen.getByRole("button", { name: "Create goal" })).toBeDisabled();
    expect(
      screen.getByText("The definition or target changed. Refresh the preview before saving."),
    ).toBeVisible();
    expect(actions.createKpiGoalAction).not.toHaveBeenCalled();
  });

  it("assigns an existing revision without creating another definition", async () => {
    const { props } = show({ definition });
    advance(1);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    expect(actions.assignKpiGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: definition.id,
        condition: { kind: "at_most", target: "0" },
      }),
      "csrf",
    );
    expect(actions.createKpiGoalAction).not.toHaveBeenCalled();
    expect(actions.saveKpiDefinitionAction).not.toHaveBeenCalled();
  });

  it("publishes an immutable definition revision without changing assignments", async () => {
    const { props } = show({ revision: definition });
    fireEvent.change(screen.getByLabelText("KPI name"), {
      target: { value: "Lost deals, revised" },
    });
    advance(3);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Save KPI definition" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    expect(actions.saveKpiDefinitionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Lost deals, revised",
        familyId: definition.familyId,
        expectedRevision: 2,
      }),
      "csrf",
    );
    expect(actions.assignKpiGoalAction).not.toHaveBeenCalled();
    expect(actions.createKpiGoalAction).not.toHaveBeenCalled();
  });

  it("keeps an unavailable denominator visible instead of presenting a zero result", async () => {
    actions.previewKpiAction.mockResolvedValueOnce({
      ok: true,
      value: {
        ...measurement,
        value: null,
        state: "unavailable",
        numerator: 0,
        denominator: 0,
        issues: ["zero_denominator"],
      },
    });
    show({
      initial: {
        ...definition,
        calculation: "percentage",
        unit: "percent",
        filters: { status: "all" },
        numeratorStatus: "won",
        denominatorStatus: "closed",
      },
    });
    advance(3);
    await preview();
    expect(screen.getByText("Unavailable", { exact: true })).toBeVisible();
    expect(
      screen.getByText(
        "There are no eligible records for this ratio. A missing denominator is not zero performance.",
      ),
    ).toBeVisible();
    expect(screen.getByText("—", { exact: true })).toBeVisible();
  });

  it("preserves canonical precision when displaying and submitting a German target", async () => {
    const onDone = vi.fn();
    render(
      <LocaleProvider locale="de">
        <KpiBuilder
          users={[]}
          teams={[]}
          pipelines={[]}
          activityTypes={[]}
          definition={definition}
          initialCondition={{ kind: "at_most", target: "1.234" }}
          onDone={onDone}
          onCancel={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Zielwert")).toHaveValue("1,234");
    fireEvent.change(screen.getByLabelText("Zielwert"), { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(screen.getByRole("button", { name: "Ergebnis prüfen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ziel erstellen" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ziel erstellen" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(actions.assignKpiGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({ condition: { kind: "at_most", target: "1.5" } }),
      "csrf",
    );
  });
});
