import { Button } from "@/components/ui/Button";
import { sourceChannelLabel } from "@/constants/sourceChannelLabels";
import { useLocale, useLocalePreferencePending } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import type { RecordedDealSourceReport } from "../recordedDealSourceReport";
import type { StatsMessages } from "../statsMessages";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";

type AvailableReport = Extract<RecordedDealSourceReport, { state: "available" }>;
type Row = AvailableReport["rows"][number];
type Formatters = ReturnType<typeof useFormatters>;
type Copy = StatsMessages["recordedSource"];

interface Scope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
  from: string;
  to: string;
  timeZoneIdentity: string;
}

const counts = ["added", "won", "lost"] as const;
const MICROSECONDS_PER_DAY = 86_400_000_000n;

function channelLabel(channel: Row["channel"], copy: Copy, locale: ReturnType<typeof useLocale>) {
  if (channel === "unrecorded") return copy.unrecorded;
  if (channel === "unrecognized") return copy.unrecognized;
  return sourceChannelLabel(channel, locale);
}

function averageCycle(row: Row, format: Formatters, S: StatsMessages): string {
  if (row.wonCycleMicroseconds === null || row.wonCycleCount === 0)
    return S.recordedSource.noSample;
  const total = BigInt(row.wonCycleMicroseconds);
  const denominator = BigInt(row.wonCycleCount) * MICROSECONDS_PER_DAY;
  if (total > 0n && total < denominator) return S.underADay;
  // Round the exact elapsed-microsecond total divided by its own eligible count.
  const tenths = (10n * total + denominator / 2n) / denominator;
  return format.number(`${tenths / 10n}.${tenths % 10n}`, {
    style: "unit",
    unit: "day",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
}

function SourceTotals({ rows }: { rows: AvailableReport["rows"] }) {
  const { recordedSource: copy } = useStatsMessages();
  const format = useFormatters();
  const totals = rows.reduce(
    (total, row) => ({
      added: total.added + row.added,
      won: total.won + row.won,
      lost: total.lost + row.lost,
    }),
    { added: 0, won: 0, lost: 0 },
  );
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:p-4">
      {counts.map((count) => (
        <div key={count} className="min-w-0">
          <dt className="text-muted-foreground">{copy[count]}</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            <bdi>{format.number(totals[count])}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SourceTable({ report }: { report: AvailableReport }) {
  const S = useStatsMessages();
  const copy = S.recordedSource;
  const locale = useLocale();
  const format = useFormatters();
  const columns = [copy.channel, copy.added, copy.won, copy.lost, copy.wonValue, copy.wonCycle];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-start text-sm">
        <caption className="sr-only">{copy.title}</caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {columns.map((label, index) => (
              <th
                key={label}
                scope="col"
                className={
                  index === 0
                    ? "min-w-36 px-4 py-3 text-start font-medium"
                    : "min-w-24 px-4 py-3 text-end font-medium"
                }
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {report.rows.map((row) => (
            <tr key={row.channel}>
              <th scope="row" className="px-4 py-3 text-start font-medium">
                <bdi>{channelLabel(row.channel, copy, locale)}</bdi>
              </th>
              {counts.map((count) => (
                <td key={count} className="px-4 py-3 text-end tabular-nums">
                  <bdi>{format.number(row[count])}</bdi>
                </td>
              ))}
              <td className="min-w-32 px-4 py-3 text-end tabular-nums">
                <bdi>
                  {row.wonValue === null
                    ? copy.noSample
                    : format.currency(row.wonValue, report.currency)}
                </bdi>
                <span className="block text-xs text-muted-foreground">
                  {S._extra.recordedSourceSamples(row.wonValueCount, row.won)}
                </span>
              </td>
              <td className="min-w-32 px-4 py-3 text-end tabular-nums">
                <bdi>{averageCycle(row, format, S)}</bdi>
                <span className="block text-xs text-muted-foreground">
                  {S._extra.recordedSourceSamples(row.wonCycleCount, row.won)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AvailableSourceReport({ report, scope }: { report: AvailableReport; scope: Scope }) {
  const S = useStatsMessages();
  const format = useFormatters();
  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{S.recordedSource.period}</dt>
          <dd>
            <bdi>{format.dateOnly(scope.from)}</bdi> {S.rangeSeparator}{" "}
            <bdi>{format.dateOnly(scope.to)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{S.recordsTimeZone}</dt>
          <dd>
            <bdi>{report.timeZone}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{S.currencyLabel}</dt>
          <dd>
            <bdi>{report.currency}</bdi>
          </dd>
        </div>
      </dl>
      {report.effectiveOwnerScope === "me" && scope.ownerScope.kind !== "me" && (
        <p className="text-sm text-muted-foreground">{S.cohort.ownDealsOnly}</p>
      )}
      {report.rows.length > 0 && (
        <>
          <SourceTotals rows={report.rows} />
          <SourceTable report={report} />
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">
            {S.recordedSource.sampleBasis}
          </p>
        </>
      )}
    </div>
  );
}

function SourceReportState({
  report,
  scope,
  onRetry,
}: {
  report: RecordedDealSourceReport | undefined;
  scope: Scope;
  onRetry: () => void;
}) {
  const S = useStatsMessages();
  if (report === undefined) return <p role="status">{S.loading}</p>;
  if (report.state === "available") return <AvailableSourceReport report={report} scope={scope} />;
  if (report.state === "permission") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {S.recordedSource.permission}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-muted-foreground">
        {S.recordedSource.unavailable}
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>
        {S.retry}
      </Button>
    </div>
  );
}

export function RecordedDealSourcePanel({ scope }: { scope: Scope }) {
  const { recordedSource: copy } = useStatsMessages();
  const pending = useLocalePreferencePending();
  const query = trpc.stats.recordedDealSource.useQuery(scope, {
    enabled: !pending,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
    trpc: { abortOnUnmount: true },
  });
  let report: RecordedDealSourceReport | undefined;
  if (
    !pending &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isPaused &&
    !query.isPlaceholderData
  ) {
    if (query.isError) {
      const code = query.error.data?.code;
      report =
        code === "FORBIDDEN" || code === "UNAUTHORIZED"
          ? { state: "permission" }
          : { state: "unavailable" };
    } else {
      report = query.data ?? { state: "unavailable" };
    }
  }
  const empty = report?.state === "available" && report.rows.length === 0;
  return (
    <Panel title={copy.title} isEmpty={empty} emptyText={copy.empty}>
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{copy.definition}</p>
        <SourceReportState
          report={report}
          scope={scope}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    </Panel>
  );
}
