import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useFormatters } from "@/lib/useFormatters";
import type {
  StageAgingLowerBounds,
  StageAgingQuantiles,
  StageAgingRow,
  StageAgingView,
} from "../history/stageAgingView";
import type { StatsMessages } from "../statsMessages";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";

type Formatters = ReturnType<typeof useFormatters>;
type StageAgingCopy = StatsMessages["stageAging"];
type Presentation = { copy: StageAgingCopy; format: Formatters };
type AvailableView = Extract<StageAgingView, { state: "available" }>;

// The projection validates the exact nanosecond text. Split with integer arithmetic
// so neither a large span nor a half-nanosecond median loses precision in the display.
function formatDuration(nanoseconds: string, format: Formatters): string {
  const [whole = "0", half = "0"] = nanoseconds.split(".");
  const value = BigInt(whole);
  const seconds = value / 1_000_000_000n;
  const fraction = ((value % 1_000_000_000n).toString().padStart(9, "0") + half).replace(/0+$/, "");
  const subminute = seconds % 60n;
  const parts = [
    { unit: "day", value: (seconds / 86_400n).toString() },
    { unit: "hour", value: ((seconds / 3_600n) % 24n).toString() },
    { unit: "minute", value: ((seconds / 60n) % 60n).toString() },
    { unit: "second", value: fraction === "" ? subminute.toString() : `${subminute}.${fraction}` },
  ];
  const visible =
    value === 0n && fraction === ""
      ? [{ unit: "second", value: "0" }]
      : parts.filter((part) => part.value !== "0");
  return visible
    .map(({ unit, value: quantity }) =>
      format.number(quantity, {
        style: "unit",
        unit,
        unitDisplay: "short",
        maximumFractionDigits: 10,
      }),
    )
    .join(" ");
}

function StatLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-baseline gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-end font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SampleCounts({
  sample,
  copy,
  format,
}: Presentation & { sample: Pick<StageAgingQuantiles, "sampleCount" | "distinctDeals"> }) {
  return (
    <>
      <StatLine label={copy.observations} value={<bdi>{format.number(sample.sampleCount)}</bdi>} />
      <StatLine
        label={copy.distinctDeals}
        value={<bdi>{format.number(sample.distinctDeals)}</bdi>}
      />
    </>
  );
}

function NoObservation({ copy }: { copy: StageAgingCopy }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{copy.noObservation}</span>
    </>
  );
}

function Duration({ value, copy, format }: Presentation & { value: string | null }) {
  return value === null ? (
    <NoObservation copy={copy} />
  ) : (
    <bdi>{formatDuration(value, format)}</bdi>
  );
}

function QuantileBlock({
  title,
  sample,
  copy,
  format,
}: Presentation & { title: string; sample: StageAgingQuantiles }) {
  return (
    <section className="min-w-0 rounded-lg border p-3 sm:p-4">
      <h4 className="mb-2 text-sm font-medium text-foreground">{title}</h4>
      <dl className="text-sm">
        <SampleCounts sample={sample} copy={copy} format={format} />
        <StatLine
          label={copy.median}
          value={<Duration value={sample.medianNanoseconds} copy={copy} format={format} />}
        />
        <StatLine
          label={copy.percentile(75)}
          value={<Duration value={sample.p75Nanoseconds} copy={copy} format={format} />}
        />
        <StatLine
          label={copy.percentile(90)}
          value={<Duration value={sample.p90Nanoseconds} copy={copy} format={format} />}
        />
      </dl>
    </section>
  );
}

function LowerBoundRange({
  sample,
  copy,
  format,
}: Presentation & { sample: StageAgingLowerBounds }) {
  const { minimumNanoseconds, maximumNanoseconds } = sample;
  if (minimumNanoseconds === null || maximumNanoseconds === null) {
    return <NoObservation copy={copy} />;
  }
  const minimum = formatDuration(minimumNanoseconds, format);
  if (minimumNanoseconds === maximumNanoseconds) return <bdi>{minimum}</bdi>;
  const maximum = formatDuration(maximumNanoseconds, format);
  return <bdi>{copy.durationRange(minimum, maximum)}</bdi>;
}

function LowerBoundBlock({
  title,
  sample,
  copy,
  format,
}: Presentation & { title: string; sample: StageAgingLowerBounds }) {
  return (
    <div>
      <h5 className="text-sm font-medium text-foreground">{title}</h5>
      <dl className="text-sm">
        <SampleCounts sample={sample} copy={copy} format={format} />
        <StatLine
          label={copy.lowerBoundRange}
          value={<LowerBoundRange sample={sample} copy={copy} format={format} />}
        />
      </dl>
    </div>
  );
}

function StageAgingSection({ row, copy, format }: Presentation & { row: StageAgingRow }) {
  return (
    <article className="space-y-3 py-4">
      <header>
        <p className="break-words text-sm text-muted-foreground">
          <bdi>{row.pipelineName}</bdi>
        </p>
        <h3 className="break-words font-semibold text-foreground">
          <bdi>{row.stageName}</bdi>
        </h3>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <QuantileBlock title={copy.completed} sample={row.completed} copy={copy} format={format} />
        <QuantileBlock
          title={copy.currentOpen}
          sample={row.currentOpen}
          copy={copy}
          format={format}
        />
        <section className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3 sm:col-span-2 sm:p-4 xl:col-span-1">
          <h4 className="text-sm font-medium text-foreground">{copy.lowerBounds}</h4>
          <LowerBoundBlock
            title={copy.completedStays}
            sample={row.leftCensored.completed}
            copy={copy}
            format={format}
          />
          <LowerBoundBlock
            title={copy.openStays}
            sample={row.leftCensored.currentOpen}
            copy={copy}
            format={format}
          />
        </section>
      </div>
    </article>
  );
}

function CoverageItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ObservedTime({ value, format }: { value: string; format: Formatters }) {
  return (
    <time dateTime={value}>
      <bdi>
        {format.dateTime(value, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        })}
      </bdi>
    </time>
  );
}

function AgingCoverage({ view, copy, format }: Presentation & { view: AvailableView }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-pretty text-muted-foreground">{copy.coverage}</p>
      <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/30 p-3 sm:grid-cols-3 sm:p-4 xl:grid-cols-5">
        <CoverageItem label={copy.cohortDeals} value={<bdi>{format.number(view.dealCount)}</bdi>} />
        <CoverageItem
          label={copy.openDeals}
          value={<bdi>{format.number(view.currentOpenDealCount)}</bdi>}
        />
        <CoverageItem
          label={copy.captureStart}
          value={<ObservedTime value={view.activatedAt} format={format} />}
        />
        <CoverageItem
          label={copy.observationTime}
          value={<ObservedTime value={view.observedAt} format={format} />}
        />
        <CoverageItem label={copy.currency} value={<bdi>{view.currency}</bdi>} />
      </dl>
      <p className="text-pretty text-muted-foreground">
        {copy.currentLabels} {copy.censoring}
      </p>
    </div>
  );
}

function AgingContent({ view, copy, format }: Presentation & { view: AvailableView }) {
  const labelOccurrences = new Map<string, number>();
  return (
    <div className="space-y-4">
      <AgingCoverage view={view} copy={copy} format={format} />
      <div className="divide-y">
        {view.rows.map((row) => {
          const label = JSON.stringify([row.pipelineName, row.stageName]);
          const occurrence = (labelOccurrences.get(label) ?? 0) + 1;
          labelOccurrences.set(label, occurrence);
          return (
            <StageAgingSection
              key={`${label}:${occurrence}`}
              row={row}
              copy={copy}
              format={format}
            />
          );
        })}
      </div>
    </div>
  );
}

function AgingStatus({
  view,
  copy,
  onRetry,
}: {
  view: Exclude<StageAgingView, AvailableView>;
  copy: StageAgingCopy;
  onRetry: (() => void) | undefined;
}) {
  if (view.state === "loading" || view.state === "permission") {
    return (
      <p role="status" className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
        {copy[view.state]}
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-4">
      <p role="alert" className="text-sm text-muted-foreground">
        {copy[view.reason]}
      </p>
      {view.reason === "read" && onRetry !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {copy.retry}
        </Button>
      )}
    </div>
  );
}

// Mount beneath the dashboard's existing client boundary and pass only the projected view.
export function StageAgingPanel({
  view,
  ownOnly,
  onRetry,
}: {
  view: StageAgingView;
  ownOnly: boolean;
  onRetry?: () => void;
}) {
  const { stageAging: copy } = useStatsMessages();
  const format = useFormatters();
  const isEmpty = view.state === "available" && view.rows.length === 0;
  const emptyText =
    view.state === "available" && view.dealCount === 0 ? copy.noDeals : copy.noStays;
  return (
    <Panel title={copy.title} isEmpty={isEmpty} emptyText={emptyText}>
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{copy.cohortScope}</p>
        {ownOnly && <p className="text-sm text-muted-foreground">{copy.ownDealsOnly}</p>}
        {view.state === "available" ? (
          <AgingContent view={view} copy={copy} format={format} />
        ) : (
          <AgingStatus view={view} copy={copy} onRetry={onRetry} />
        )}
      </div>
    </Panel>
  );
}
