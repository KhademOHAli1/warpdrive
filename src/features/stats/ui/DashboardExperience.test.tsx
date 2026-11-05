// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { DealWinCohortView } from "../history/dealWinCohortView";

const fixture = vi.hoisted(() => ({
  refetch: vi.fn(),
  goalsRefetch: vi.fn(),
  cohortQuery: vi.fn(),
  cohortRefetch: vi.fn(),
  cohortFetching: false,
  cohortReport: vi.fn<() => DealWinCohortView>(),
  query: vi.fn(),
  savePreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
  error: false,
  goalsError: false,
  result: {
    currency: "USD",
    dealPerformance: {
      added: { count: 8, value: "60000" },
      won: { count: 2, value: "12000" },
      lost: { count: 1, value: "3000" },
      open: { count: 5, value: "45000" },
    },
    wonDealStats: { avgValue: "6000", medianValue: "6000", avgCycleDays: 9, medianCycleDays: 8 },
    winRate: 2 / 3,
    activities: { completed: 9, added: 12, scheduled: 4, undated: 2 },
    activitiesByType: [{ typeId: "call", key: "call", name: "Call", completed: 9 }],
    funnel: [
      {
        stageId: "qualified",
        name: "Qualified",
        order: 0,
        reached: 8,
        conversion: 1,
        medianDaysInStage: 3,
      },
    ],
    stageSums: [{ stageId: "proposal", name: "Proposal", order: 1, dealCount: 5, total: "45000" }],
    lostReasons: [{ reasonId: "timing", name: "Timing", count: 1, value: "3000" }],
    wonTrend: [{ month: "2026-11", count: 2, value: "12000" }],
    effectiveOwnerScope: { kind: "me" } as const,
  },
}));

vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: fixture.savePreferences,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    pipeline: { list: { useQuery: () => ({ data: [{ id: "p1", name: "Sales" }] }) } },
    stats: {
      dashboard: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.query(input, options);
          return {
            data: fixture.result,
            isError: fixture.error,
            isLoading: false,
            isFetching: false,
            refetch: fixture.refetch,
          };
        },
      },
      ownerOptions: { useQuery: () => ({ data: { users: [], teams: [] } }) },
      dealWinCohorts: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.cohortQuery(input, options);
          return {
            data: fixture.cohortReport(),
            isError: false,
            isLoading: false,
            isFetching: fixture.cohortFetching,
            refetch: fixture.cohortRefetch,
          };
        },
      },
    },
    goals: {
      list: {
        useQuery: () => ({
          data: undefined,
          isError: fixture.goalsError,
          isLoading: false,
          refetch: fixture.goalsRefetch,
        }),
      },
    },
  },
}));
vi.mock("@/components/ui/DatePicker", () => ({
  DatePicker: ({
    ariaLabel,
    value,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { Dashboard } from "./Dashboard";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.savePreferences.mockReset();
  fixture.savePreferences.mockResolvedValue({ ok: true });
  fixture.error = false;
  fixture.goalsError = false;
  fixture.cohortReport.mockReturnValue({ state: "coverage-not-started" });
  fixture.cohortFetching = false;
});
const mount = () =>
  render(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);

function ChangeReportTimeZone() {
  const choose = useSetLocalePreferences();
  return (
    <button
      type="button"
      onClick={() => {
        void choose({ timeZone: "Europe/Berlin" });
      }}
    >
      Change reporting time zone
    </button>
  );
}

describe("Performance report experience", () => {
  it("selects only the requested preset when month and quarter have identical bounds", async () => {
    render(<Dashboard today="2026-10-05" currency="USD" canViewOthers />);
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    expect(screen.getByRole("button", { name: "This quarter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.change(screen.getByLabelText("Range end"), { target: { value: "2026-10-04" } });
    expect(screen.getByRole("button", { name: "This quarter" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("changes to a real 30-day range while preserving owner, currency and pipeline", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(fixture.query).toHaveBeenLastCalledWith(
      {
        from: "2026-10-07",
        to: "2026-11-05",
        currency: "USD",
        timeZoneIdentity: "UTC",
        pipelineId: null,
        ownerScope: { kind: "me" },
      },
      { enabled: true },
    );
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("changes the report cache identity when viewer time zone changes without altering its scope", () => {
    const dashboard = <Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />;
    const view = render(<LocaleProvider timeZone="UTC">{dashboard}</LocaleProvider>);
    expect(fixture.query).toHaveBeenLastCalledWith(
      {
        timeZoneIdentity: "UTC",
        currency: "USD",
        pipelineId: null,
        ownerScope: { kind: "me" },
        from: "2026-01-01",
        to: "2026-11-05",
      },
      { enabled: true },
    );
    view.rerender(<LocaleProvider timeZone="Europe/Berlin">{dashboard}</LocaleProvider>);
    expect(fixture.query).toHaveBeenLastCalledWith(
      {
        timeZoneIdentity: "Europe/Berlin",
        currency: "USD",
        pipelineId: null,
        ownerScope: { kind: "me" },
        from: "2026-01-01",
        to: "2026-11-05",
      },
      { enabled: true },
    );
  });
  it("withholds headline results and disables the optimistic-zone query until its preference save settles", async () => {
    let finishSave: ((value: { ok: true }) => void) | undefined;
    const saved = new Promise<{ ok: true }>((resolve) => {
      finishSave = resolve;
    });
    fixture.savePreferences.mockReturnValueOnce(saved);
    render(
      <LocaleProvider timeZone="UTC">
        <ChangeReportTimeZone />
        <Dashboard today="2026-11-05" currency="USD" canViewOthers={false} />
      </LocaleProvider>,
    );
    expect(
      screen.getByRole("button", { name: "View contributing deals: Value won" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change reporting time zone" }));
    expect(fixture.savePreferences).toHaveBeenCalledOnce();
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZoneIdentity: "Europe/Berlin" }),
      { enabled: false },
    );
    expect(screen.queryAllByRole("definition")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "View contributing deals: Value won" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      if (finishSave === undefined) throw new Error("Preference save was not initialized");
      finishSave({ ok: true });
      await saved;
    });
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZoneIdentity: "Europe/Berlin" }),
      { enabled: true },
    );
    expect(
      screen.getByRole("button", { name: "View contributing deals: Value won" }),
    ).toBeInTheDocument();
  });
  it("opens pipeline and activity reports without losing the chosen date range", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    expect(screen.getByRole("tabpanel", { name: "Pipeline" })).toHaveTextContent("Proposal");
    expect(screen.getByRole("tabpanel", { name: "Pipeline" })).toHaveTextContent("Timing");
    expect(screen.getByRole("tabpanel", { name: "Pipeline" })).toHaveTextContent(
      "Deal history capture has not started",
    );
    expect(fixture.cohortQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "2026-10-01",
        to: "2026-11-05",
        currency: "USD",
        pipelineId: null,
        ownerScope: { kind: "me" },
        horizon: "30-days",
      }),
      { enabled: true, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    );
    expect(screen.queryByRole("heading", { name: "Won value over time" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Activities" }));
    expect(screen.getByRole("tabpanel", { name: "Activities" })).toHaveTextContent("Activity mix");
    expect(screen.getByRole("tabpanel", { name: "Activities" })).toHaveTextContent("No due date 2");
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2026-10-01", to: "2026-11-05" }),
      { enabled: true },
    );
  });
  it("shows clipped coverage and bounds the win rate using only mature outcomes", async () => {
    fixture.cohortReport.mockReturnValue({
      state: "available",
      definition: "observed-deal-entry-to-win-v1",
      population: "current-authorized-live-deals",
      effectiveOwnerScope: "me",
      calendar: "persian",
      timeZone: "Asia/Tehran",
      observationCutoff: "2026-11-05T16:00:00Z",
      horizonDays: 30,
      covered: {
        state: "partial",
        fromInclusive: "2026-10-03T00:00:00Z",
        to: "2026-11-05T16:00:00Z",
        upperBound: "inclusive",
      },
      rows: [
        {
          calendarMonthStart: "2026-09-23",
          entered: 8,
          mature: 6,
          immature: 2,
          confirmedWins: 1,
          unknownOutcomes: 1,
          rate: { state: "unavailable", reason: "mature-outcome-unknown" },
        },
      ],
    });
    const page = mount();
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    const panel = screen.getByRole("region", { name: "Deal cohorts by age" });
    expect(panel).toHaveTextContent("Only part of the selected range is covered");
    expect(panel).toHaveTextContent("Solar Hijri (Iranian)");
    expect(panel).toHaveTextContent("Asia/Tehran");
    const table = within(panel).getByRole("table", { name: "Deal cohorts by age" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
    const row = within(table).getByRole("row", { name: /Mehr/ });
    const rate = within(row).getAllByRole("cell").at(-1);
    expect(rate).toHaveTextContent(/^Range from missing outcomes\s*16\.6% to 33\.4%$/);
    expect(panel).toHaveTextContent("The range is rounded outward.");
    fixture.cohortFetching = true;
    page.rerender(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);
    expect(screen.queryByRole("table", { name: "Deal cohorts by age" })).not.toBeInTheDocument();
    fixture.cohortFetching = false;
    fixture.cohortReport.mockReturnValue({ state: "unavailable" });
    page.rerender(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixture.cohortRefetch).toHaveBeenCalledOnce();
  });
  it("supports keyboard movement and selection in the report tabs", async () => {
    mount();
    screen.getByRole("tab", { name: "Overview" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Pipeline" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Pipeline" })).toBeInTheDocument();
  });
  it("blocks reversed ranges and removes old figures instead of showing misleading data", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "2027-01-01" } });
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2027-01-01" }),
      { enabled: false },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an end date");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });
  it("retries the selected report and does not expose cached figures after a failed read", async () => {
    fixture.error = true;
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Your filters are still selected");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixture.refetch).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a failed goals read from having no goals and offers the correct retry", async () => {
    fixture.goalsError = true;
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Goals could not be loaded");
    expect(screen.queryByText("No goals apply to you yet.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixture.goalsRefetch).toHaveBeenCalledTimes(1);
    expect(fixture.refetch).not.toHaveBeenCalled();
  });
  it("makes the existing monthly figures visible on request without changing them", async () => {
    mount();
    const table = screen.getByRole("table", { name: "Won deals by month" });
    const button = screen.getByRole("button", { name: "Show monthly data" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Hide monthly data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(table).toHaveTextContent("$12,000");
    expect(table.parentElement).not.toHaveClass("sr-only");
  });
  it.each([
    ["de", "Überblick", "Letzte 30 Tage"],
    ["fa", "نمای کلی", "۳۰ روز گذشته"],
  ] as const)(
    "provides localized report navigation and presets in %s",
    (locale, overview, preset) => {
      render(
        <LocaleProvider locale={locale}>
          <Dashboard today="2026-11-05" currency="USD" canViewOthers={false} />
        </LocaleProvider>,
      );
      expect(screen.getByRole("tab", { name: overview })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: preset })).toBeInTheDocument();
    },
  );
});
