import { useLocalePreferencePending } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import type { CurrentAccountConcentrationReport } from "../currentAccountConcentrationReport";
import { useStatsMessages } from "../useStatsMessages";
import { ReportPanel } from "./Panel";

type AvailableReport = Extract<CurrentAccountConcentrationReport, { state: "available" }>;
type AvailableConcentration = Extract<AvailableReport["concentration"], { state: "available" }>;

interface Scope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
  from: string;
  to: string;
  timeZoneIdentity: string;
}

const metrics = [
  "eligibleWonDeals",
  "linkedWonDeals",
  "unresolvedWonDeals",
  "linkedOrganizations",
  "multiWonLinkedOrganizations",
  "linkedWonDealsWithoutValue",
] as const;
const percentOptions: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 1 };

function moneyUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(4, "0"));
}

// Available concentration supplies only positive exact decimals. Convert to number
// after rounding the fraction to tenths of a percentage point.
function roundedShare(numerator: string, denominator: string): number {
  const total = moneyUnits(denominator);
  const rounded = (moneyUnits(numerator) * 1_000n + total / 2n) / total;
  return Number(rounded) / 1_000;
}

function ConcentrationShares({
  concentration,
  currency,
}: {
  concentration: AvailableConcentration;
  currency: string;
}) {
  const { currentAccount: copy } = useStatsMessages();
  const format = useFormatters();
  const denominator = concentration.positiveNetDenominator;
  const numerators = ["largestNetNumerator", "topFiveNetNumerator"] as const;
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border bg-muted/30 p-3">
        <dt className="text-sm text-muted-foreground">{copy.positiveNetDenominator}</dt>
        <dd className="mt-1 font-semibold tabular-nums">
          <bdi>{format.currency(denominator, currency)}</bdi>
        </dd>
      </div>
      {numerators.map((metric) => (
        <div key={metric} className="rounded-lg border bg-muted/30 p-3">
          <dt className="text-sm text-muted-foreground">{copy[metric]}</dt>
          <dd className="mt-1">
            <bdi className="block font-semibold tabular-nums">
              {format.number(roundedShare(concentration[metric], denominator), percentOptions)}
            </bdi>
            <bdi className="block text-xs text-muted-foreground">
              {format.currency(concentration[metric], currency)}
            </bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Concentration({ report }: { report: AvailableReport }) {
  const { currentAccount: copy } = useStatsMessages();
  const { concentration } = report;
  switch (concentration.state) {
    case "empty":
      return null;
    case "withheld":
      return (
        <p className="text-sm text-muted-foreground">
          {concentration.reason === "unresolved-organization"
            ? copy.unresolvedConcentration
            : copy.missingValueConcentration}
        </p>
      );
    case "no-positive-net":
      return <p className="text-sm text-muted-foreground">{copy.noPositiveNet}</p>;
    case "available":
      return (
        <div className="space-y-2">
          <ConcentrationShares concentration={concentration} currency={report.currency} />
          <p className="text-xs text-muted-foreground">{copy.concentrationBasis}</p>
        </div>
      );
  }
}

function ReportCoverage({ report }: { report: AvailableReport }) {
  const { currentAccount: copy } = useStatsMessages();
  const format = useFormatters();
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric} className="min-w-0 rounded-lg border bg-muted/30 p-3">
            <dt className="text-sm text-muted-foreground">{copy[metric]}</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              <bdi>{format.number(report.coverage[metric])}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <dl className="space-y-1 text-sm">
        <dt className="text-muted-foreground">{copy.linkedKnownNominalNet}</dt>
        <dd className="font-semibold tabular-nums">
          {report.linkedKnownNominalNet === null ? (
            copy.noKnownAmount
          ) : (
            <bdi>{format.currency(report.linkedKnownNominalNet, report.currency)}</bdi>
          )}
        </dd>
      </dl>
    </>
  );
}

function AvailableAccountReport({ report, scope }: { report: AvailableReport; scope: Scope }) {
  const S = useStatsMessages();
  const { currentAccount: copy } = S;
  const format = useFormatters();
  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{copy.wonPeriod}</dt>
          <dd>
            <bdi>{format.dateOnly(report.from)}</bdi> {S.rangeSeparator}{" "}
            <bdi>{format.dateOnly(report.to)}</bdi>
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
        <p className="text-sm text-muted-foreground">{copy.ownWinsOnly}</p>
      )}
      {report.coverage.eligibleWonDeals > 0 && <ReportCoverage report={report} />}
      <Concentration report={report} />
    </div>
  );
}

function matchesReportScope(report: AvailableReport, scope: Scope): boolean {
  return report.from === scope.from && report.to === scope.to && report.currency === scope.currency;
}

export function CurrentAccountConcentrationPanel({ scope }: { scope: Scope }) {
  const S = useStatsMessages();
  const copy = S.currentAccount;
  const pending = useLocalePreferencePending();
  const query = trpc.stats.currentAccountConcentration.useQuery(scope, {
    enabled: !pending,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
    trpc: { abortOnUnmount: true },
  });
  const fresh =
    !pending &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isPaused &&
    !query.isPlaceholderData;
  let report: CurrentAccountConcentrationReport | undefined;
  if (fresh && query.isError) {
    const code = query.error.data?.code;
    report = {
      state: code === "FORBIDDEN" || code === "UNAUTHORIZED" ? "permission" : "unavailable",
    };
  } else if (fresh) {
    report = query.data ?? { state: "unavailable" };
    if (report.state === "available" && !matchesReportScope(report, scope))
      report = { state: "scope-unavailable" };
  }
  const empty = report?.state === "available" && report.coverage.eligibleWonDeals === 0;
  return (
    <ReportPanel
      state={report?.state ?? "loading"}
      copy={copy}
      loading={S.loading}
      scopeUnavailable={copy.scopeUnavailable}
      retry={S.retry}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={empty}
    >
      {report?.state === "available" && <AvailableAccountReport report={report} scope={scope} />}
    </ReportPanel>
  );
}
