// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { CurrentLeadHandoffReport } from "../currentLeadHandoffReport";
import type { DealWinCohortView } from "../history/dealWinCohortView";
import type { StageAgingView } from "../history/stageAgingView";
import type { RecordedDealSourceReport } from "../recordedDealSourceReport";

const fixture = vi.hoisted(() => ({
  refetch: vi.fn(),
  goalsRefetch: vi.fn(),
  cohortQuery: vi.fn(),
  cohortRefetch: vi.fn(),
  cohortFetching: false,
  cohortReport: vi.fn<() => DealWinCohortView>(),
  agingQuery: vi.fn(),
  agingReport: vi.fn<() => StageAgingView>(),
  agingFetched: true,
  agingFetching: false,
  agingPlaceholder: false,
  agingError: false,
  recordedSourceQuery: vi.fn(),
  recordedSourceRefetch: vi.fn(),
  recordedSourceReport: vi.fn<() => RecordedDealSourceReport>(),
  recordedSourceFresh: true,
  recordedSourceFetching: false,
  handoffQuery: vi.fn(),
  handoffReport: vi.fn<() => CurrentLeadHandoffReport>(),
  handoffFetching: false,
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
      recordedDealSource: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.recordedSourceQuery(input, options);
          return {
            data: fixture.recordedSourceReport(),
            isError: false,
            isFetchedAfterMount: fixture.recordedSourceFresh,
            isFetching: fixture.recordedSourceFetching,
            isPaused: false,
            isPlaceholderData: false,
            refetch: fixture.recordedSourceRefetch,
          };
        },
      },
      currentLeadHandoff: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.handoffQuery(input, options);
          return {
            data: fixture.handoffReport(),
            isError: false,
            isFetchedAfterMount: true,
            isFetching: fixture.handoffFetching,
            isPaused: false,
            isPlaceholderData: false,
            refetch: vi.fn(),
          };
        },
      },
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
      currentAttention: {
        useQuery: () => ({
          data: {
            state: "available",
            definition: "current-deal-next-action-queue-v1",
            timeZone: "Europe/Berlin",
            observedAt: "2026-11-05T07:00:00.123456Z",
            counts: { overdueActivities: 4, dealsWithoutNextStep: 2 },
          },
          isFetchedAfterMount: true,
          isFetching: false,
          isPaused: false,
          isPlaceholderData: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      stageAging: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.agingQuery(input, options);
          return {
            data: fixture.agingReport(),
            isFetchedAfterMount: fixture.agingFetched,
            isFetching: fixture.agingFetching,
            isPaused: false,
            isPlaceholderData: fixture.agingPlaceholder,
            isError: fixture.agingError,
            error: fixture.agingError ? { data: { code: "FORBIDDEN" } } : null,
            refetch: vi.fn(),
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
  fixture.agingReport.mockReturnValue({ state: "unavailable", reason: "capture" });
  fixture.agingFetched = true;
  fixture.agingFetching = false;
  fixture.agingPlaceholder = false;
  fixture.agingError = false;
  fixture.recordedSourceReport.mockReturnValue({ state: "unavailable" });
  fixture.recordedSourceFresh = true;
  fixture.recordedSourceFetching = false;
  fixture.handoffFetching = false;
  fixture.handoffReport.mockReturnValue({ state: "permission" });
});
const mount = () =>
  render(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);

const noQuantiles = {
  sampleCount: 0,
  distinctDeals: 0,
  medianNanoseconds: null,
  p75Nanoseconds: null,
  p90Nanoseconds: null,
};
const noLowerBounds = {
  sampleCount: 0,
  distinctDeals: 0,
  minimumNanoseconds: null,
  maximumNanoseconds: null,
};
const availableAging: StageAgingView = {
  state: "available",
  currency: "USD",
  effectiveOwnerScope: "me",
  dealCount: 1,
  currentOpenDealCount: 1,
  activatedAt: "2026-11-01T12:00:00.000000Z",
  observedAt: "2026-11-05T16:00:00.000000Z",
  rows: [
    {
      pipelineName: "Sales",
      stageName: "Aging fixture stage",
      completed: noQuantiles,
      currentOpen: {
        sampleCount: 1,
        distinctDeals: 1,
        medianNanoseconds: "3600000000000",
        p75Nanoseconds: "3600000000000",
        p90Nanoseconds: "3600000000000",
      },
      leftCensored: { completed: noLowerBounds, currentOpen: noLowerBounds },
    },
  ],
};

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
  it("loads a scoped Acquisition read and keeps its outcome samples and refresh states separate", async () => {
    fixture.recordedSourceFresh = false;
    fixture.recordedSourceReport.mockReturnValue({
      state: "available",
      definition: "recorded-deal-source-current-v1",
      currency: "USD",
      timeZone: "Europe/Berlin",
      effectiveOwnerScope: "me",
      rows: [
        {
          channel: "campaign",
          added: 3,
          won: 2,
          lost: 0,
          wonValueCount: 1,
          wonValue: "0",
          wonCycleCount: 2,
          wonCycleMicroseconds: "259200000000",
        },
        {
          channel: "unrecognized",
          added: 1,
          won: 1,
          lost: 0,
          wonValueCount: 0,
          wonValue: null,
          wonCycleCount: 1,
          wonCycleMicroseconds: "0",
        },
        {
          channel: "unrecorded",
          added: 0,
          won: 0,
          lost: 2,
          wonValueCount: 0,
          wonValue: null,
          wonCycleCount: 0,
          wonCycleMicroseconds: null,
        },
      ],
    });
    const page = mount();
    const rerender = () =>
      page.rerender(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);
    expect(fixture.recordedSourceQuery).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Pipeline" }));
    await userEvent.click(screen.getByRole("option", { name: "Sales" }));
    await userEvent.click(screen.getByRole("tab", { name: "Acquisition" }));
    expect(fixture.recordedSourceQuery).toHaveBeenLastCalledWith(
      {
        currency: "USD",
        pipelineId: "p1",
        ownerScope: { kind: "me" },
        from: "2026-10-07",
        to: "2026-11-05",
        timeZoneIdentity: "UTC",
      },
      expect.objectContaining({ gcTime: 0, refetchOnMount: "always" }),
    );
    const findTable = () => screen.queryByRole("table", { name: "Recorded deal sources" });
    expect(findTable()).not.toBeInTheDocument();
    fixture.recordedSourceFresh = true;
    rerender();

    const panel = screen.getByRole("region", { name: "Recorded deal sources" });
    expect(panel).toHaveTextContent("Europe/Berlin");
    expect(
      within(panel)
        .getAllByRole("definition")
        .slice(-3)
        .map((item) => item.textContent),
    ).toEqual(["4", "3", "2"]);
    const campaign = within(panel).getByRole("row", { name: /Marketing campaign/ });
    const value = within(campaign).getAllByRole("cell").at(-2);
    const cycle = within(campaign).getAllByRole("cell").at(-1);
    expect(value).toHaveTextContent("$0");
    expect(value).toHaveTextContent("1 of 2 wins");
    expect(cycle).toHaveTextContent("1.5");
    expect(cycle).toHaveTextContent("2 of 2 wins");
    expect(within(panel).getByRole("row", { name: /Unrecognized channel/ })).toHaveTextContent(
      "No eligible sample",
    );
    expect(within(panel).getByRole("row", { name: /Channel unrecorded/ })).toBeInTheDocument();

    fixture.recordedSourceFetching = true;
    rerender();
    expect(findTable()).not.toBeInTheDocument();
    fixture.recordedSourceFetching = false;
    fixture.recordedSourceReport.mockReturnValue({ state: "unavailable" });
    rerender();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixture.recordedSourceRefetch).toHaveBeenCalledOnce();
    expect(findTable()).not.toBeInTheDocument();
  });

  it("shows current lead linkage only on a fresh all-pipelines read", async () => {
    fixture.handoffReport.mockReturnValue({
      state: "available",
      definition: "current-lead-deal-link-v1",
      population: "current-visible-leads-created-in-period",
      destination: "current-visible-live-linked-deal",
      handoffHistory: "unqualified",
      firstResponseHistory: "unqualified",
      currency: "USD",
      timeZone: "Europe/Berlin",
      effectiveOwnerScope: "me",
      counts: {
        eligibleLeads: 9,
        linkedLeads: 4,
        distinctLinkedDeals: 3,
        pendingUnlinkedLeads: 2,
        archivedUnlinkedLeads: 1,
        unavailableLinkedLeads: 2,
      },
    });
    const page = mount();
    await userEvent.click(screen.getByRole("tab", { name: "Acquisition" }));
    const panel = within(screen.getByRole("region", { name: "Lead-to-deal links" }));
    expect(panel.getByText("Lead creation period")).toBeVisible();
    expect(
      panel
        .getAllByRole("definition")
        .slice(-6)
        .map((cell) => cell.textContent),
    ).toEqual(["9", "4", "3", "2", "1", "2"]);
    expect(fixture.handoffQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ pipelineId: null, currency: "USD" }),
      expect.objectContaining({ enabled: true, gcTime: 0 }),
    );
    fixture.handoffFetching = true;
    page.rerender(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);
    expect(panel.queryByText("Leads with a visible deal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Pipeline" }));
    await userEvent.click(screen.getByRole("option", { name: "Sales" }));
    const scopedPanel = within(screen.getByRole("region", { name: "Lead-to-deal links" }));
    expect(scopedPanel.getByText(/Choose All pipelines/)).toBeVisible();
    expect(fixture.handoffQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ pipelineId: "p1" }),
      expect.objectContaining({ enabled: false }),
    );
  });

  it("keeps the deal attention counts separate and displays the queue's account zone", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    const panel = within(screen.getByRole("region", { name: "Deal next actions" }));
    expect(panel.getByText("(Europe/Berlin)")).toBeVisible();
    expect(panel.getByText("Overdue deal activities")).toBeVisible();
    expect(panel.getByText("Open deals without a next step")).toBeVisible();
    expect(panel.getAllByRole("definition").map((cell) => cell.textContent)).toEqual(["4", "2"]);
  });

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
  it("loads stage aging only on the Pipeline tab and keeps it independent of the date range", async () => {
    fixture.agingReport.mockReturnValue(availableAging);
    mount();
    expect(fixture.agingQuery).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    expect(fixture.agingQuery).toHaveBeenLastCalledWith(
      { pipelineId: null, currency: "USD", ownerScope: { kind: "me" } },
      expect.objectContaining({ gcTime: 0, refetchOnMount: "always" }),
    );
    const aging = screen.getByRole("region", { name: "Stage aging" });
    expect(aging).toHaveTextContent("Dashboard dates apply to the period-based reports");
    expect(aging).toHaveTextContent("As of");
    expect(aging.querySelector('time[datetime="2026-11-05T16:00:00.000000Z"]')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "2027-01-01" } });
    expect(screen.queryByRole("region", { name: "Deal cohorts by age" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aging fixture stage" })).toBeInTheDocument();
    expect(fixture.agingQuery).toHaveBeenLastCalledWith(
      { pipelineId: null, currency: "USD", ownerScope: { kind: "me" } },
      expect.anything(),
    );
  });
  it("withholds cached stage rows on mount, refetch, scope change and permission failure", async () => {
    fixture.agingReport.mockReturnValue(availableAging);
    fixture.agingFetched = false;
    const page = mount();
    const rerender = () =>
      page.rerender(<Dashboard today="2026-11-05" currency="USD" canViewOthers canManageGoals />);
    const stage = () => screen.queryByRole("heading", { name: "Aging fixture stage" });
    await userEvent.click(screen.getByRole("tab", { name: "Pipeline" }));
    expect(stage()).not.toBeInTheDocument();
    expect(screen.getByText("Loading stage aging…")).toBeInTheDocument();

    fixture.agingFetched = true;
    rerender();
    expect(stage()).toBeInTheDocument();
    fixture.agingFetching = true;
    rerender();
    expect(stage()).not.toBeInTheDocument();
    fixture.agingFetching = false;
    fixture.agingPlaceholder = true;
    rerender();
    expect(stage()).not.toBeInTheDocument();
    fixture.agingPlaceholder = false;

    fixture.agingFetched = false;
    await userEvent.click(screen.getByLabelText("Owner"));
    await userEvent.click(screen.getByRole("option", { name: "Everyone" }));
    expect(fixture.agingQuery).toHaveBeenLastCalledWith(
      { pipelineId: null, currency: "USD", ownerScope: { kind: "all" } },
      expect.anything(),
    );
    expect(stage()).not.toBeInTheDocument();
    fixture.agingFetched = true;
    rerender();
    expect(stage()).toBeInTheDocument();
    expect(screen.getByText("This report covers your own deals.")).toBeInTheDocument();

    fixture.agingError = true;
    rerender();
    expect(stage()).not.toBeInTheDocument();
    expect(
      screen.getByText("Your current permissions do not allow you to view this report."),
    ).toBeInTheDocument();
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
