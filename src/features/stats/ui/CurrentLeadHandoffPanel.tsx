import { Button } from "@/components/ui/Button";
import { useLocalePreferencePending } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import type { CurrentLeadHandoffReport } from "../currentLeadHandoffReport";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";

interface Scope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
  from: string;
  to: string;
  timeZoneIdentity: string;
}

const metrics = [
  "eligibleLeads",
  "linkedLeads",
  "distinctLinkedDeals",
  "pendingUnlinkedLeads",
  "archivedUnlinkedLeads",
  "unavailableLinkedLeads",
] as const;

function HandoffCounts({
  report,
  scope,
}: {
  report: Extract<CurrentLeadHandoffReport, { state: "available" }>;
  scope: Scope;
}) {
  const S = useStatsMessages();
  const format = useFormatters();
  const copy = S.currentHandoff;
  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{copy.creationPeriod}</dt>
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
        <p className="text-sm text-muted-foreground">{copy.ownLeadsOnly}</p>
      )}
      {report.counts.eligibleLeads > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric} className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <dt className="text-sm text-muted-foreground">{copy[metric]}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                <bdi>{format.number(report.counts[metric])}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function CurrentLeadHandoffPanel({ scope }: { scope: Scope }) {
  const S = useStatsMessages();
  const copy = S.currentHandoff;
  const pending = useLocalePreferencePending();
  const query = trpc.stats.currentLeadHandoff.useQuery(scope, {
    enabled: !pending && scope.pipelineId === null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
    trpc: { abortOnUnmount: true },
  });

  let report: CurrentLeadHandoffReport | undefined;
  if (scope.pipelineId !== null) {
    report = { state: "scope-unavailable" };
  } else if (
    !pending &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isPaused &&
    !query.isPlaceholderData
  ) {
    const code = query.error?.data?.code;
    report = query.isError
      ? { state: code === "FORBIDDEN" || code === "UNAUTHORIZED" ? "permission" : "unavailable" }
      : (query.data ?? { state: "unavailable" });
  }
  const empty = report?.state === "available" && report.counts.eligibleLeads === 0;
  return (
    <Panel title={copy.title} isEmpty={empty} emptyText={copy.empty}>
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{copy.definition}</p>
        {report === undefined && <p role="status">{S.loading}</p>}
        {report?.state === "available" && <HandoffCounts report={report} scope={scope} />}
        {report?.state === "permission" && <p role="status">{copy.permission}</p>}
        {report?.state === "scope-unavailable" && <p role="status">{copy.allPipelines}</p>}
        {report?.state === "unavailable" && (
          <div className="space-y-3">
            <p role="alert">{copy.unavailable}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              {S.retry}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
