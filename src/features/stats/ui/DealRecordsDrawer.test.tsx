// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  savePreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
  loading: false,
  fetching: false,
  fetchedAfterMount: true,
  error: false,
  wonTrend: [] as Array<{ month: string; count: number; value: string }>,
  result: {
    currency: "USD",
    timeZone: "Europe/Berlin",
    effectiveOwnerScope: { kind: "me" } as const,
    metric: "won" as const,
    wonMonth: undefined as string | undefined,
    definitionVersion: "1",
    generatedAt: "2026-11-05T12:00:00.000Z",
    rows: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Acme service agreement",
        status: "won" as const,
        value: "0.00",
        currency: "USD",
        createdAt: "2026-10-01T08:00:00.000Z",
        closedAt: "2026-11-01T08:00:00.000Z",
      },
    ],
    totals: { count: 1, value: "0.00", valueCount: 1 },
    nextCursor: null as { createdAt: string; id: string } | null,
  },
}));

vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: fixture.savePreferences,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    stats: {
      dashboard: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: {
            currency: "USD",
            timeZone: "Europe/Berlin",
            dealPerformance: {
              added: { count: 1, value: "0.00" },
              won: { count: 1, value: "0.00" },
              lost: { count: 0, value: "0.00" },
              open: { count: 0, value: "0.00" },
            },
            wonDealStats: {
              avgValue: "0.00",
              medianValue: "0.00",
              avgCycleDays: 3,
              medianCycleDays: 3,
            },
            winRate: 1,
            activities: { completed: 0, added: 0, scheduled: 0, undated: 0 },
            activitiesByType: [],
            funnel: [],
            stageSums: [],
            lostReasons: [],
            wonTrend: fixture.wonTrend,
            effectiveOwnerScope: { kind: "me" },
          },
        }),
      },
      ownerOptions: { useQuery: () => ({ data: { users: [], teams: [] } }) },
      records: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.query(input, options);
          return {
            data: fixture.result,
            isLoading: fixture.loading,
            isFetching: fixture.fetching,
            isFetchedAfterMount: fixture.fetchedAfterMount,
            isError: fixture.error,
            refetch: fixture.refetch,
          };
        },
      },
    },
    pipeline: { list: { useQuery: () => ({ data: [] }) } },
    goals: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { Dashboard } from "./Dashboard";
import { DealRecordsDrawer } from "./DealRecordsDrawer";
import { Scoreboard } from "./Scoreboard";

const scope = {
  currency: "USD",
  pipelineId: null,
  ownerScope: { kind: "me" } as const,
  from: "2026-11-01",
  to: "2026-11-05",
};
const mount = (metric: "won" | "closed" | "wonValue" | "wonCycle" = "won") =>
  render(<DealRecordsDrawer metric={metric} scope={scope} onClose={vi.fn()} />);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.savePreferences.mockReset();
  fixture.savePreferences.mockResolvedValue({ ok: true });
  fixture.error = false;
  fixture.loading = false;
  fixture.fetching = false;
  fixture.fetchedAfterMount = true;
  fixture.wonTrend = [];
  fixture.result.wonMonth = undefined;
  fixture.result.timeZone = "Europe/Berlin";
  fixture.result.rows = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Acme service agreement",
      status: "won",
      value: "0.00",
      currency: "USD",
      createdAt: "2026-10-01T08:00:00.000Z",
      closedAt: "2026-11-01T08:00:00.000Z",
    },
  ];
  fixture.result.totals = { count: 1, value: "0.00", valueCount: 1 };
  fixture.result.nextCursor = null;
});

function ChangeReportTimeZone() {
  const choose = useSetLocalePreferences();
  return (
    <button
      type="button"
      data-testid="change-report-time-zone"
      onClick={() => {
        void choose({ timeZone: "Europe/Berlin" });
      }}
    >
      Change reporting time zone
    </button>
  );
}

describe("contributing-deal inspection", () => {
  it("requests the selected scope and metric and shows a real recorded zero", () => {
    mount("wonValue");
    expect(fixture.query).toHaveBeenLastCalledWith(
      { ...scope, timeZoneIdentity: "UTC", metric: "wonValue", cursor: undefined, limit: 25 },
      { enabled: true, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    );
    expect(screen.getByRole("table", { name: "Eligible deals in this report" })).toHaveTextContent(
      "$0",
    );
    expect(screen.getByText("1 eligible deal")).toBeInTheDocument();
    expect(screen.getByText(/Only these values enter the average/)).toBeInTheDocument();
    expect(screen.getByText(/Europe\/Berlin/)).toBeInTheDocument();
  });

  it("opens the record in a clearly labelled new tab and preserves the report", () => {
    mount();
    const link = screen.getByRole("link", { name: /Acme service agreement/ });
    expect(link).toHaveAttribute("href", "/deals/00000000-0000-4000-8000-000000000001");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/this report stays open/);
  });

  it("links a fresh complete population to the permission-checked export", () => {
    const drawer = () => (
      <DealRecordsDrawer metric="won" scope={scope} onClose={vi.fn()} canExport />
    );
    const page = render(drawer());
    const link = screen.getByRole("link", { name: "Download CSV" });
    const params = new URL(link.getAttribute("href") ?? "", "https://example.invalid").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      from: scope.from,
      to: scope.to,
      currency: "USD",
      pipelineId: "all",
      ownerScope: "me",
      metric: "won",
      timeZone: "Europe/Berlin",
    });
    fixture.fetching = true;
    page.rerender(drawer());
    expect(screen.queryByRole("link", { name: "Download CSV" })).not.toBeInTheDocument();
    fixture.fetching = false;
    fixture.result.totals.count = 101;
    page.rerender(drawer());
    expect(screen.getByText(/Narrow the report to download up to 100 deals/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download CSV" })).not.toBeInTheDocument();
  });

  it("explains the win-rate numerator and denominator rather than using only wins", () => {
    mount("closed");
    expect(screen.getByText(/all listed deals form its denominator/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Win rate" })).toBeInTheDocument();
  });

  it("states the nonnegative duration eligibility for the median cycle", () => {
    mount("wonCycle");
    expect(screen.getByText(/win date is on or after creation/)).toBeInTheDocument();
    expect(screen.getByText(/Created:/)).toBeInTheDocument();
  });

  it("does not display cached records while a fresh permission-checked read is pending", () => {
    fixture.fetching = true;
    mount();
    expect(screen.getByRole("status", { name: "Loading..." })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Acme/ })).not.toBeInTheDocument();
  });

  it("hides drawer records and disables reads while the optimistic time-zone preference is being saved", async () => {
    let finishSave: ((value: { ok: true }) => void) | undefined;
    const saved = new Promise<{ ok: true }>((resolve) => {
      finishSave = resolve;
    });
    fixture.savePreferences.mockReturnValueOnce(saved);
    render(
      <LocaleProvider timeZone="UTC">
        <ChangeReportTimeZone />
        <DealRecordsDrawer metric="won" scope={scope} onClose={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: /Acme service agreement/ })).toBeInTheDocument();
    // An account preference update can arrive while a modal report remains mounted.
    // Dispatch the settings control directly, without bypassing the Sheet's focus trap.
    fireEvent.click(screen.getByTestId("change-report-time-zone"));
    await waitFor(() => expect(fixture.savePreferences).toHaveBeenCalledOnce());
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZoneIdentity: "Europe/Berlin" }),
      { enabled: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    );
    expect(screen.queryByRole("link", { name: /Acme service agreement/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading..." })).toBeInTheDocument();

    await act(async () => {
      if (finishSave === undefined) throw new Error("Preference save was not initialized");
      finishSave({ ok: true });
      await saved;
    });
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZoneIdentity: "Europe/Berlin" }),
      { enabled: true, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    );
    expect(screen.getByRole("link", { name: /Acme service agreement/ })).toBeInTheDocument();
  });

  it("hides cached records after an error and retries the same report", async () => {
    fixture.error = true;
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByRole("link", { name: /Acme/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixture.refetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an empty eligible population and gives one return action", async () => {
    fixture.result.rows = [];
    fixture.result.totals = { count: 0, value: "0.00", valueCount: 0 };
    const close = vi.fn();
    render(<DealRecordsDrawer metric="won" scope={scope} onClose={close} />);
    expect(screen.getByText("0 eligible deals")).toBeInTheDocument();
    expect(screen.getByText(/No visible deals meet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Return to report" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("pages with the server cursor and can return to the first page", async () => {
    const next = {
      createdAt: "2026-10-01T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    };
    fixture.result.nextCursor = next;
    mount();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: next, metric: "won" }),
      expect.anything(),
    );
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined, metric: "won" }),
      expect.anything(),
    );
  });

  it.each([
    ["de", "Zugehörige Deals", "Berücksichtigte Deals in diesem Bericht", "ltr"],
    ["fa", "معامله‌های مبنای محاسبه", "معامله‌های واجد شرایط این گزارش", "rtl"],
  ] as const)("localizes the table and sheet direction in %s", (locale, label, caption, dir) => {
    render(
      <LocaleProvider locale={locale}>
        <DealRecordsDrawer metric="won" scope={scope} onClose={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: caption })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("dir", dir);
  });
});

describe("scoreboard record populations", () => {
  it("opens one exact trend month for records and CSV while keeping the original report open", async () => {
    fixture.wonTrend = [
      { month: "2026-10", count: 0, value: "0.00" },
      { month: "2026-11", count: 1, value: "0.00" },
    ];
    fixture.result.wonMonth = "2026-11";
    fixture.fetchedAfterMount = false;
    const dashboard = () => (
      <Dashboard today="2026-11-05" currency="USD" canViewOthers={false} canExport />
    );
    const page = render(dashboard());
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    expect(
      screen.queryByRole("button", { name: /View won deals for Nov/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show monthly data" }));
    expect(
      screen.queryByRole("button", { name: /View won deals for Oct/ }),
    ).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /View won deals for Nov/ });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: /Won deals in Nov/ })).toBeInTheDocument();
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "2026-10-01",
        to: "2026-11-05",
        currency: "USD",
        ownerScope: { kind: "me" },
        metric: "won",
        wonMonth: "2026-11",
      }),
      expect.objectContaining({ refetchOnWindowFocus: "always" }),
    );
    expect(screen.queryByRole("link", { name: /Acme service agreement/ })).not.toBeInTheDocument();
    fixture.fetchedAfterMount = true;
    page.rerender(dashboard());
    const deal = screen.getByRole("link", { name: /Acme service agreement/ });
    expect(deal).toHaveAttribute("target", "_blank");
    expect(deal).toHaveAccessibleName(/this report stays open/);
    const download = screen.getByRole("link", { name: "Download CSV" });
    const params = new URL(download.getAttribute("href") ?? "", "https://example.invalid")
      .searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      from: "2026-10-01",
      to: "2026-11-05",
      metric: "won",
      wonMonth: "2026-11",
      timeZone: "Europe/Berlin",
    });

    fixture.result.timeZone = "UTC";
    page.rerender(dashboard());
    expect(screen.getByRole("alert")).toHaveTextContent("The original chart scope is unavailable.");
    expect(screen.queryByRole("link", { name: /Acme service agreement/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download CSV" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole("button", { name: "This quarter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exposes exactly the four eligible deal populations", async () => {
    const inspect = vi.fn();
    render(
      <Scoreboard
        currency="USD"
        deals={{
          won: { count: 1, value: "0.00" },
          lost: { count: 1, value: "0.00" },
          added: { count: 2, value: "0.00" },
          open: { count: 0, value: "0.00" },
        }}
        won={{ avgValue: "0.00", medianValue: "0.00", avgCycleDays: 3, medianCycleDays: 3 }}
        activities={{ completed: 1, added: 2, scheduled: 0, undated: 0 }}
        winRate={0.5}
        onInspect={inspect}
      />,
    );
    expect(fixture.query).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: /View contributing deals:/ });
    expect(buttons).toHaveLength(4);
    for (const [index, metric] of ["won", "closed", "wonValue", "wonCycle"].entries()) {
      await userEvent.click(buttons[index]!);
      expect(inspect).toHaveBeenLastCalledWith(metric, buttons[index]);
    }
  });

  it("loads records only when requested, carries the chosen period and restores keyboard focus", async () => {
    render(<Dashboard today="2026-11-05" currency="USD" canViewOthers={false} />);
    expect(fixture.query).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    const trigger = screen.getByRole("button", {
      name: "View contributing deals: Average won deal",
    });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currency: "USD",
        pipelineId: null,
        ownerScope: { kind: "me" },
        from: "2026-10-01",
        to: "2026-11-05",
        metric: "wonValue",
      }),
      expect.anything(),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("uses a new time-zone cache identity and resets an open drawer's cursor after a preference change", async () => {
    const next = {
      createdAt: "2026-10-01T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    };
    fixture.result.nextCursor = next;
    const dashboard = <Dashboard today="2026-11-05" currency="USD" canViewOthers={false} />;
    const view = render(<LocaleProvider timeZone="UTC">{dashboard}</LocaleProvider>);
    await userEvent.click(
      screen.getByRole("button", { name: "View contributing deals: Average won deal" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(fixture.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZoneIdentity: "UTC", cursor: next, metric: "wonValue" }),
      expect.anything(),
    );
    expect(screen.getByText("Page 2")).toBeInTheDocument();

    view.rerender(<LocaleProvider timeZone="Europe/Berlin">{dashboard}</LocaleProvider>);
    await waitFor(() => {
      expect(fixture.query).toHaveBeenLastCalledWith(
        expect.objectContaining({
          timeZoneIdentity: "Europe/Berlin",
          cursor: undefined,
          metric: "wonValue",
          currency: "USD",
          pipelineId: null,
          ownerScope: { kind: "me" },
          from: "2026-01-01",
          to: "2026-11-05",
        }),
        expect.anything(),
      );
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });
});
