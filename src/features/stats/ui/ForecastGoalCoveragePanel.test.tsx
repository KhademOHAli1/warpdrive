// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ForecastGoalOptions } from "../forecastGoalCoverage";
import { ForecastGoalCoverageResult } from "./ForecastGoalCoveragePanel";
import { PeriodForecastPanel } from "./PeriodForecastPanel";

const fixture = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  refetch: vi.fn(),
  read: vi.fn(),
  options: undefined as ForecastGoalOptions | undefined,
  fetching: false,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    stats: {
      periodForecast: {
        useMutation: () => ({
          mutate: fixture.mutate,
          reset: fixture.reset,
          isPending: false,
          isError: false,
        }),
      },
      periodForecastGoals: {
        useQuery: (scope: unknown, options: unknown) => {
          fixture.read(scope, options);
          return {
            data: fixture.options,
            isFetchedAfterMount: true,
            isFetching: fixture.fetching,
            isPaused: false,
            isPlaceholderData: false,
            isError: false,
            refetch: fixture.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "forecast-csrf" }));
vi.mock("@/components/ui/Select", () => ({
  Select: ({
    ariaLabel,
    onChange,
    options,
    value,
    disabled,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    value: string;
    disabled: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const scope = { currency: "EUR", pipelineId: null, ownerScope: { kind: "me" } } as const;
const goalId = "01000000-0000-4000-8000-000000000001";
const view = () => (
  <LocaleProvider locale="en" country="GB" calendar="gregory" timeZone="Europe/Berlin">
    <PeriodForecastPanel today="2026-11-05" scope={scope} />
  </LocaleProvider>
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.options = { state: "available", options: [{ id: goalId, label: "November bookings" }] };
  fixture.fetching = false;
});

test("selects one current KPI goal for the exact Forecast scope and posts only its ID", async () => {
  const user = userEvent.setup();
  const page = render(view());
  expect(fixture.read).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Choose a KPI target" }));
  expect(fixture.read).toHaveBeenCalledWith(
    { ...scope, from: "2026-11-06", to: "2026-12-05" },
    expect.objectContaining({ refetchOnMount: "always", refetchOnWindowFocus: "always" }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "KPI target for the forecast" }),
    goalId,
  );
  await user.click(screen.getByRole("button", { name: "Run scenarios" }));
  expect(fixture.mutate).toHaveBeenLastCalledWith({
    csrfToken: "forecast-csrf",
    scenario: {
      ...scope,
      policyVersion: 1,
      from: "2026-11-06",
      to: "2026-12-05",
      goalId,
      scenarios: {
        conservative: { pWin: null, pCloseInPeriodGivenWin: null },
        base: { pWin: null, pCloseInPeriodGivenWin: null },
        upside: { pWin: null, pCloseInPeriodGivenWin: null },
      },
    },
  });

  fixture.options = { state: "available", options: [] };
  page.rerender(view());
  expect(screen.getByText(/selected KPI target is unavailable/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Run scenarios" }));
  const last = fixture.mutate.mock.lastCall?.[0] as { scenario: Record<string, unknown> };
  expect(last.scenario).not.toHaveProperty("goalId");
});

test("shows exact nominal gap, a known zero and an incomplete scenario separately", () => {
  const gap = "59.9999432109876543210988";
  const scenario = {
    state: "available",
    numerator: "40.1234567890123456789012",
    denominator: "100.1234",
    remainingAfterScenario: gap,
  } as const;
  render(
    <LocaleProvider locale="en" country="GB">
      <ForecastGoalCoverageResult
        report={{
          state: "available",
          source: "current-pinned-won-value-kpi-v1",
          currency: "EUR",
          bookedNominalValue: "0.00",
          targetNominalValue: "100.1234",
          remainingNominalValue: "100.1234",
          coverage: {
            state: "available",
            scenarios: {
              conservative: scenario,
              base: scenario,
              upside: { state: "unavailable", reason: "incomplete-forecast" },
            },
          },
        }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("0.00 EUR")).toBeInTheDocument();
  expect(screen.getAllByText(`${gap} EUR`)).toHaveLength(2);
  expect(screen.getByText(/unknown contributions/)).toBeInTheDocument();
});

test.each([
  ["en", "KPI target coverage"],
  ["de", "Abdeckung des KPI-Ziels"],
  ["fa", "پوشش هدف شاخص عملکرد"],
] as const)("labels unavailable target coverage in %s", (locale, title) => {
  render(
    <LocaleProvider locale={locale}>
      <ForecastGoalCoverageResult report={{ state: "unavailable", reason: "period-mismatch" }} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.queryByText("0.00 EUR")).not.toBeInTheDocument();
});
