import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { addDaysUtc } from "@/features/activities/monthGrid";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime, localeTagForFormatting } from "@/lib/localeFormatting";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { NativePeriodForecast, NativePeriodForecastRequest } from "../nativePeriodForecast";
import { PERIOD_FORECAST_SCENARIOS } from "../periodForecast";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";
import { readForecastFactor } from "./periodForecastForm";

interface Scope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
}
type Scenario = (typeof PERIOD_FORECAST_SCENARIOS)[number];
type Assumptions = NativePeriodForecastRequest["scenarios"][Scenario];
type AvailableReport = Extract<NativePeriodForecast, { state: "available" }>;

function readScenario(
  form: FormData,
  name: Scenario,
  locale: ReturnType<typeof localeTagForFormatting>,
): Assumptions | undefined {
  function factor(key: "win" | "timing" | "size") {
    const value = form.get(`${name}.${key}`);
    if (value !== null && typeof value !== "string") return undefined;
    return readForecastFactor(value ?? "", locale, key === "size" ? "size" : "probability");
  }
  const win = factor("win");
  const timing = factor("timing");
  const size = factor("size");
  if (win === undefined || timing === undefined || size === undefined) return undefined;
  return {
    pWin: win,
    pCloseInPeriodGivenWin: timing,
    ...(size === null ? {} : { sizeMultiplier: size }),
  };
}

function ScenarioFields({ scenario }: { scenario: Scenario }) {
  const { forecast: S } = useStatsMessages();
  const id = useId();
  const fields = [
    { key: "win", label: S.winProbability },
    { key: "timing", label: S.timingProbability },
    { key: "size", label: S.sizeMultiplier },
  ];
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">{S[scenario]}</legend>
      {fields.map(({ key, label }) => (
        <label key={key} htmlFor={`${id}-${key}`} className="block space-y-1 text-sm">
          <span className="block">{label}</span>
          <Input
            id={`${id}-${key}`}
            name={`${scenario}.${key}`}
            type="text"
            inputMode="decimal"
            maxLength={16}
            className="min-h-10 tabular-nums"
          />
        </label>
      ))}
    </fieldset>
  );
}

function ForecastResults({ report }: { report: AvailableReport }) {
  const S = useStatsMessages();
  const copy = S.forecast;
  const format = useFormatters();
  const preferences = useLocalePreferences();
  const measures = [
    { key: "expectedWonCount", label: copy.expectedCount },
    { key: "expectedWonValue", label: copy.expectedValue },
  ] as const;
  return (
    <div className="space-y-4 border-t pt-4" aria-live="polite">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{copy.results}</h3>
        <p className="text-sm text-muted-foreground">
          <bdi>{format.dateOnly(report.targetDates.from)}</bdi> {S.rangeSeparator}{" "}
          <bdi>{format.dateOnly(report.targetDates.to)}</bdi> · <bdi>{report.target.timeZone}</bdi>
        </p>
        <p className="text-sm text-muted-foreground">
          {copy.observedAt}{" "}
          <bdi>
            {formatDateTime(report.cutoffObservedAt, {
              ...preferences,
              timeZone: report.target.timeZone,
            })}
          </bdi>
        </p>
      </div>
      <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
        <div>
          <dt>{copy.eligibleDeals}</dt>
          <dd className="font-semibold tabular-nums">
            <bdi>{format.number(report.openDealCount)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.recordedValue}</dt>
          <dd className="font-semibold tabular-nums">
            <bdi>
              {report.recordedOpenValue.knownTotal === null
                ? copy.unknown
                : format.currency(report.recordedOpenValue.knownTotal, report.currency)}
            </bdi>
          </dd>
          <dd className="text-xs text-muted-foreground">
            {S._extra.forecastCoverage(
              report.recordedOpenValue.knownDealCount,
              report.openDealCount,
            )}
          </dd>
        </div>
      </dl>
      <div className="grid gap-3 lg:grid-cols-3">
        {PERIOD_FORECAST_SCENARIOS.map((key) => (
          <div key={key} className="min-w-0 space-y-2 rounded-lg border p-4">
            <h4 className="text-sm font-semibold">{copy[key]}</h4>
            <dl className="space-y-2 text-sm">
              {measures.map(({ key: measureKey, label }) => {
                const { knownTotal, knownDealCount } = report.scenarios[key][measureKey];
                let value = copy.unknown;
                if (knownTotal !== null) {
                  value =
                    measureKey === "expectedWonCount"
                      ? format.number(knownTotal, { maximumFractionDigits: 6 })
                      : format.currency(knownTotal, report.currency);
                }
                return (
                  <div key={measureKey}>
                    <dt>{label}</dt>
                    <dd className="font-semibold tabular-nums">
                      <bdi>{value}</bdi>
                    </dd>
                    <dd className="text-xs text-muted-foreground">
                      {S._extra.forecastCoverage(knownDealCount, report.openDealCount)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function targetDates(today: string) {
  const day = new Date(`${today}T00:00:00Z`);
  return {
    from: addDaysUtc(day, 1).toISOString().slice(0, 10),
    to: addDaysUtc(day, 30).toISOString().slice(0, 10),
  };
}

export function PeriodForecastPanel({ scope, today }: { scope: Scope; today: string }) {
  const { forecast: S } = useStatsMessages();
  const preferences = useLocalePreferences();
  const changingPreferences = useLocalePreferencePending();
  const forecast = trpc.stats.periodForecast.useMutation();
  const [target, setTarget] = useState(() => targetDates(today));
  const [invalid, setInvalid] = useState(false);
  const disabled = forecast.isPending || changingPreferences;
  const report = changingPreferences ? undefined : forecast.data;

  function clearResult() {
    setInvalid(false);
    forecast.reset();
  }

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = new FormData(event.currentTarget);
    const locale = localeTagForFormatting(preferences);
    const conservative = readScenario(form, "conservative", locale);
    const base = readScenario(form, "base", locale);
    const upside = readScenario(form, "upside", locale);
    clearResult();
    const days =
      (Date.parse(`${target.to}T00:00:00Z`) - Date.parse(`${target.from}T00:00:00Z`)) / 86_400_000;
    if (!conservative || !base || !upside || target.from <= today || !(days >= 0 && days < 366)) {
      setInvalid(true);
      return;
    }
    forecast.mutate({
      scenario: {
        ...scope,
        ...target,
        policyVersion: 1,
        scenarios: { conservative, base, upside },
      },
      csrfToken: readCsrfToken(),
    });
  }

  return (
    <Panel title={S.title} isEmpty={false} emptyText="">
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{S.definition}</p>
        <form onSubmit={run} onChange={clearResult}>
          <fieldset disabled={disabled} className="space-y-4">
            <legend className="sr-only">{S.inputs}</legend>
            <div className="flex flex-wrap items-center gap-3">
              <DatePicker
                ariaLabel={S.targetFrom}
                value={target.from}
                onChange={(value) => {
                  if (value === null || disabled) return;
                  setTarget({ ...target, from: value });
                  clearResult();
                }}
              />
              <DatePicker
                ariaLabel={S.targetTo}
                value={target.to}
                onChange={(value) => {
                  if (value === null || disabled) return;
                  setTarget({ ...target, to: value });
                  clearResult();
                }}
              />
              <span className="text-sm text-muted-foreground">
                {S.scopeCurrency} <bdi>{scope.currency}</bdi>
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{S.assumptionsHelp}</p>
            <div className="grid gap-3 lg:grid-cols-3">
              {PERIOD_FORECAST_SCENARIOS.map((scenario) => (
                <ScenarioFields key={scenario} scenario={scenario} />
              ))}
            </div>
            <Button type="submit" disabled={disabled}>
              {forecast.isPending ? S.running : S.run}
            </Button>
          </fieldset>
        </form>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {S.invalid}
          </p>
        )}
        {forecast.isError && !changingPreferences && (
          <p role="alert" className="text-sm text-destructive">
            {S.unavailable}
          </p>
        )}
        {report?.state === "unavailable" && (
          <p role="alert" className="text-sm text-destructive">
            {report.reason === "target-not-future" ||
            report.reason === "target-unavailable" ||
            report.reason === "invalid-input"
              ? S.invalid
              : report.reason === "capture-not-installed"
                ? S.captureUnavailable
                : S.unavailable}
          </p>
        )}
        {report?.state === "available" && <ForecastResults report={report} />}
      </div>
    </Panel>
  );
}
