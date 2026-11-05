// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kpiPacks } from "@/features/goals/kpiCatalog";
import type { KpiActionResult, KpiDefinition, KpiScheme } from "@/features/goals/kpiModel";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { KpiPackForm, KpiSchemeAssignForm, KpiSchemeForm } from "./KpiSchemeForm";

const actions = vi.hoisted(() => ({
  saveKpiSchemeAction:
    vi.fn<(input: unknown, csrf?: string | null) => Promise<KpiActionResult<unknown>>>(),
  applyKpiSchemeAction:
    vi.fn<(input: unknown, csrf?: string | null) => Promise<KpiActionResult<unknown>>>(),
  createKpiPackAction:
    vi.fn<(input: unknown, csrf?: string | null) => Promise<KpiActionResult<unknown>>>(),
  recordKpiMeasurementAction: vi.fn(),
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

const definition: KpiDefinition = {
  id: "10000000-0000-4000-8000-000000000001",
  familyId: "10000000-0000-4000-8000-000000000002",
  revision: 1,
  createdAt: "2026-11-01T10:00:00Z",
  name: "Rework",
  description: "Revision rounds.",
  source: "manual",
  calculation: "average",
  unit: "count",
  dateField: "measured",
  filters: {},
};
const scheme: KpiScheme = {
  id: "20000000-0000-4000-8000-000000000001",
  familyId: "20000000-0000-4000-8000-000000000002",
  revision: 3,
  createdAt: "2026-11-01T10:00:00Z",
  name: "Delivery",
  description: "Quality guardrail.",
  entries: [
    {
      definitionId: definition.id,
      condition: { kind: "range", target: "1.2345", upperTarget: "2.2345" },
    },
  ],
};
const lifecycle = () => ({ onDone: vi.fn(), onCancel: vi.fn(), onBusyChange: vi.fn() });

beforeEach(() => {
  actions.saveKpiSchemeAction.mockResolvedValue({ ok: true, value: scheme });
  actions.applyKpiSchemeAction.mockResolvedValue({ ok: true, value: [] });
  actions.createKpiPackAction.mockResolvedValue({ ok: true, value: scheme });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("KPI scorecard forms", () => {
  it("disables saving a scorecard without selected KPIs", () => {
    render(<KpiSchemeForm definitions={[definition]} {...lifecycle()} />);
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(actions.saveKpiSchemeAction).not.toHaveBeenCalled();
  });

  it("preserves authored decimal locale and unchanged precision across a language change", async () => {
    const callbacks = lifecycle();
    const tree = (locale: Locale) => (
      <LocaleProvider locale={locale}>
        <KpiSchemeForm definitions={[definition]} initial={scheme} {...callbacks} />
      </LocaleProvider>
    );
    const view = render(tree("de"));
    expect(screen.getByLabelText("Rework: Zielwert")).toHaveValue("1,2345");
    fireEvent.change(screen.getByLabelText("Rework: Zielwert"), { target: { value: "1,5678" } });
    view.rerender(tree("en"));
    expect(screen.getByLabelText("Rework: Target value")).toHaveValue("1,5678");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(callbacks.onDone).toHaveBeenCalledTimes(1));
    expect(actions.saveKpiSchemeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: scheme.familyId,
        expectedRevision: 3,
        entries: [
          {
            definitionId: definition.id,
            condition: { kind: "range", target: "1.5678", upperTarget: "2.2345" },
          },
        ],
      }),
      "csrf",
    );
  });

  it("assigns deadline entries with a one-off period and an explicit end date", async () => {
    const callbacks = lifecycle();
    render(
      <KpiSchemeAssignForm
        scheme={{
          ...scheme,
          entries: [{ definitionId: definition.id, condition: { kind: "deadline", target: "1" } }],
        }}
        users={[]}
        teams={[]}
        today="2026-11-05"
        {...callbacks}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Period" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ends on"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(callbacks.onDone).toHaveBeenCalledTimes(1));
    expect(actions.applyKpiSchemeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        period: {
          kind: "one_off",
          interval: "monthly",
          startsOn: "2026-11-05",
          endsOn: "2026-12-31",
        },
        pacing: "none",
      }),
      "csrf",
    );
  });

  it("can assign a reusable scorecard to a rolling window", async () => {
    render(
      <KpiSchemeAssignForm
        scheme={scheme}
        users={[]}
        teams={[]}
        today="2026-11-05"
        {...lifecycle()}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
      target: { value: "rolling90" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.applyKpiSchemeAction).toHaveBeenCalledTimes(1));
    expect(actions.applyKpiSchemeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        period: expect.objectContaining({ kind: "rolling", rollingDays: 90 }),
      }),
      "csrf",
    );
  });

  it("shows every pack source requirement and preserves the edited pack after a failed atomic save", async () => {
    actions.createKpiPackAction.mockResolvedValueOnce({ ok: false, error: { id: "E_KPI_FAILED" } });
    const pack = kpiPacks("en", "EUR").find((candidate) => candidate.id === "agency");
    expect(pack).toBeDefined();
    const callbacks = lifecycle();
    render(<KpiPackForm pack={pack!} {...callbacks} />);
    for (const template of pack!.templates)
      expect(screen.getByText(template.requiredData, { exact: true })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Consulting delivery" } });
    fireEvent.click(screen.getByRole("button", { name: /Create.*scorecard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is still here");
    expect(screen.getByLabelText("Name")).toHaveValue("Consulting delivery");
    fireEvent.click(screen.getByRole("button", { name: /Create.*scorecard/i }));
    await waitFor(() => expect(callbacks.onDone).toHaveBeenCalledTimes(1));
    expect(actions.createKpiPackAction).toHaveBeenLastCalledWith(
      {
        name: "Consulting delivery",
        description: pack!.description,
        entries: pack!.templates.map((template) => ({
          definition: template.definition,
          condition: template.condition,
        })),
      },
      "csrf",
    );
  });
});
