import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import type { ForecastGoalCoverage } from "../forecastGoalCoverage";
import { PERIOD_FORECAST_SCENARIOS } from "../periodForecast";
import { useStatsMessages } from "../useStatsMessages";

interface GoalScope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
  from: string;
  to: string;
}

function UnavailableSelection({ onClear, disabled }: { onClear: () => void; disabled: boolean }) {
  const { forecastGoal: copy } = useStatsMessages();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        {copy.selectionUnavailable}
      </p>
      <Button type="button" variant="outline" disabled={disabled} onClick={onClear}>
        {copy.clearGoal}
      </Button>
    </div>
  );
}

export function ForecastGoalPicker({
  scope,
  selected,
  onChange,
  disabled,
  enabled,
}: {
  scope: GoalScope;
  selected: string;
  onChange: (value: string) => void;
  disabled: boolean;
  enabled: boolean;
}) {
  const { forecastGoal: copy, loading, retry } = useStatsMessages();
  const query = trpc.stats.periodForecastGoals.useQuery(scope, {
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
    trpc: { abortOnUnmount: true },
  });
  if (!enabled) return <p className="text-sm text-muted-foreground">{copy.chooseDates}</p>;
  if (!query.isFetchedAfterMount || query.isFetching || query.isPaused || query.isPlaceholderData)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {loading}
      </p>
    );
  const result = query.isError ? undefined : query.data;
  const options = result?.state === "available" ? result.options : [];
  const selectionAvailable = selected === "" || options.some((option) => option.id === selected);
  if (!selectionAvailable)
    return <UnavailableSelection disabled={disabled} onClear={() => onChange("")} />;
  if (result?.state === "limit")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {copy.optionLimit}
      </p>
    );
  if (result?.state !== "available")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {copy.optionsUnavailable}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            void query.refetch();
          }}
        >
          {retry}
        </Button>
      </div>
    );
  if (options.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {copy.noOptions}
      </p>
    );
  return (
    <div className="space-y-2 ph-no-capture">
      <Select
        ariaLabel={copy.selectGoal}
        value={selected}
        onChange={onChange}
        options={[
          { value: "", label: copy.noGoal },
          ...options.map(({ id, label }) => ({ value: id, label })),
        ]}
        contentClassName="ph-no-capture"
        disabled={disabled}
      />
      {selected !== "" && <input type="hidden" name="forecastGoalId" value={selected} />}
    </div>
  );
}

const preciseAmount: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 22,
};

type Available = Extract<ForecastGoalCoverage, { state: "available" }>;
type Coverage = Extract<Available["coverage"], { state: "available" }>;

function NominalAmount({ value, currency }: { value: string; currency: string }) {
  const format = useFormatters();
  return (
    <bdi className="tabular-nums">
      {format.number(value, preciseAmount)} {currency}
    </bdi>
  );
}

function GoalScenarioCoverage({ coverage, currency }: { coverage: Coverage; currency: string }) {
  const { forecast, forecastGoal: copy } = useStatsMessages();
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {PERIOD_FORECAST_SCENARIOS.map((scenario) => {
        const value = coverage.scenarios[scenario];
        return (
          <div key={scenario} className="min-w-0 space-y-2 rounded-lg border p-3">
            <h4 className="text-sm font-semibold">{forecast[scenario]}</h4>
            {value.state === "unavailable" ? (
              <p className="text-sm text-muted-foreground">{copy.incompleteScenario}</p>
            ) : (
              <dl className="space-y-2 break-words text-sm">
                <div>
                  <dt className="text-muted-foreground">{copy.coverageFraction}</dt>
                  <dd className="font-semibold">
                    <NominalAmount value={value.numerator} currency={currency} />
                    {" / "}
                    <NominalAmount value={value.denominator} currency={currency} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy.afterScenario}</dt>
                  <dd className="font-semibold">
                    <NominalAmount value={value.remainingAfterScenario} currency={currency} />
                  </dd>
                </div>
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ForecastGoalCoverageResult({ report }: { report: ForecastGoalCoverage }) {
  const { forecastGoal: copy } = useStatsMessages();
  const reasons = {
    "target-unavailable": copy.targetUnavailable,
    "scope-mismatch": copy.scopeMismatch,
    "period-mismatch": copy.periodMismatch,
    "booked-unavailable": copy.bookedUnavailable,
  };
  const amounts = ["bookedNominalValue", "targetNominalValue", "remainingNominalValue"] as const;
  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{copy.coverageTitle}</h3>
      {report.state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">{reasons[report.reason]}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{copy.nominalBasis}</p>
          <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            {amounts.map((key) => (
              <div key={key}>
                <dt className="text-muted-foreground">{copy[key]}</dt>
                <dd className="font-semibold">
                  <NominalAmount value={report[key]} currency={report.currency} />
                </dd>
              </div>
            ))}
          </dl>
          {report.coverage.state === "unavailable" ? (
            <p className="text-sm text-muted-foreground">{copy.noPositiveGap}</p>
          ) : (
            <GoalScenarioCoverage coverage={report.coverage} currency={report.currency} />
          )}
        </>
      )}
    </div>
  );
}
