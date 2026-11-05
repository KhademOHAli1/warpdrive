// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KpiGoalResult } from "@/features/goals/kpiModel";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { KpiResults } from "./KpiResults";

afterEach(cleanup);

function result(): KpiGoalResult {
  return {
    definition: {
      id: "definition",
      familyId: "family",
      revision: 2,
      createdAt: "2026-11-01T10:00:00Z",
      name: "Delivery rate",
      description: "Completed milestones divided by all eligible milestones.",
      source: "manual",
      calculation: "average",
      unit: "percent",
      dateField: "measured",
      filters: {},
    },
    goal: {
      id: "goal",
      definitionId: "definition",
      scope: "team",
      scopeId: "team",
      condition: { kind: "at_least", target: "95" },
      period: { kind: "calendar", interval: "monthly", startsOn: "2026-11-01" },
      pacing: "none",
      createdAt: "2026-11-01T10:00:00Z",
    },
    measurement: {
      state: "available",
      value: "98",
      recordCount: 1,
      excludedCount: 0,
      numerator: null,
      denominator: null,
      sampleSize: 42,
      evaluatedAt: "2026-11-05T12:00:00Z",
      period: { start: "2026-11-01", end: "2026-11-30" },
      contributors: [],
      contributorsTruncated: false,
      issues: [],
    },
    assessment: { standing: "met", attainment: 98 / 95, pace: null },
  };
}

describe("KPI results", () => {
  it.each(["incomplete", "unavailable", "stale"] as const)(
    "does not mark %s data as a met target or draw a progress meter",
    (state) => {
      const row = result();
      row.measurement.state = state;
      render(<KpiResults rows={[row]} names={{ team: "Consulting" }} />);
      expect(screen.queryByText("Target met", { exact: true })).not.toBeInTheDocument();
      expect(screen.queryByRole("meter")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          state === "incomplete" ? "Incomplete" : state === "stale" ? "Stale" : "Unavailable",
          { exact: true },
        ),
      ).toBeVisible();
      expect(screen.getByText(/Consulting/)).toBeVisible();
    },
  );

  it("shows a reliable zero ceiling as a valid result without cumulative quota progress", () => {
    const row = result();
    row.definition.unit = "count";
    row.measurement.value = "0";
    row.goal.condition = { kind: "at_most", target: "0" };
    row.assessment.attainment = 1;
    render(<KpiResults rows={[row]} />);
    expect(screen.getByText("Target met", { exact: true })).toBeVisible();
    expect(screen.getByText("0", { exact: true })).toBeVisible();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows sample size, exclusions and their reasons in the evidence view", () => {
    const row = result();
    row.measurement.excludedCount = 1;
    row.measurement.contributors = [
      {
        id: "observation",
        label: "Approved survey",
        href: null,
        value: "98",
        included: true,
        reason: null,
      },
      {
        id: "excluded",
        label: "Missing survey",
        href: null,
        value: null,
        included: false,
        reason: "missing_value",
      },
    ];
    render(<KpiResults rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: /^View records:/ }));
    expect(screen.getByText("42", { exact: true })).toBeVisible();
    const excludedRow = screen.getByText("Missing survey").closest("tr");
    expect(excludedRow).not.toBeNull();
    expect(excludedRow).toHaveTextContent(/missing.*(measurement|value)/i);
    expect(excludedRow).toHaveTextContent("Excluded");
  });

  it("keeps contributor counts unitless for a percentage KPI", () => {
    const row = result();
    row.definition.source = "deals";
    row.definition.calculation = "percentage";
    row.measurement.contributors = [
      {
        id: "deal",
        label: "Won deal",
        href: "/deals/deal",
        value: "1",
        included: true,
        reason: null,
      },
    ];
    render(<KpiResults rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: /^View records:/ }));
    const recordRow = screen.getByText("Won deal").closest("tr");
    expect(recordRow).not.toBeNull();
    const cells = within(recordRow as HTMLTableRowElement).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent(/^1$/);
    expect(cells[1]).not.toHaveTextContent("%");
  });

  it("identifies the responsible team in Performance without a separate name lookup prop", () => {
    const row = result();
    row.scopeName = "Consulting";
    render(<KpiResults rows={[row]} />);
    expect(screen.getByText(/Consulting/)).toBeVisible();
  });

  it("shows the source activity date and status inline without a misleading detail link", () => {
    const row = result();
    row.definition.source = "activities";
    row.definition.calculation = "count";
    row.definition.unit = "count";
    row.measurement.contributors = [
      {
        id: "activity",
        label: "Client follow-up",
        href: null,
        value: "1",
        included: true,
        reason: null,
        observedOn: "2026-11-04",
        statuses: ["open", "overdue"],
      },
    ];
    render(<KpiResults rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: /^View records:/ }));
    const record = screen.getByText("Client follow-up").closest("tr");
    expect(record).toHaveTextContent("Nov 4, 2026");
    expect(record).toHaveTextContent("Open");
    expect(record).toHaveTextContent("Overdue");
    expect(screen.getByText("Client follow-up").closest("a")).toBeNull();
  });

  it("provides an explicit manual measurement action for the selected goal", () => {
    const row = result();
    const onMeasure = vi.fn();
    render(<KpiResults rows={[row]} onMeasure={onMeasure} />);
    fireEvent.click(screen.getByRole("button", { name: /^Record measurement:/ }));
    expect(onMeasure).toHaveBeenCalledWith(row);
  });

  it("localizes statuses and dates in the Persian interface", () => {
    const row = result();
    row.measurement.state = "unavailable";
    row.measurement.value = null;
    render(
      <LocaleProvider locale="fa">
        <KpiResults rows={[row]} />
      </LocaleProvider>,
    );
    expect(screen.getByText("ناموجود", { exact: true })).toBeVisible();
    expect(screen.queryByText("Target met", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("—", { exact: true })).toBeVisible();
  });
});
