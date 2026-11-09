import { Button } from "@/components/ui/Button";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";

const metrics = ["overdueActivities", "dealsWithoutNextStep"] as const;

export function CurrentAttentionPanel({
  scope,
}: {
  scope: { currency: string; pipelineId: string | null; ownerScope: OwnerScope };
}) {
  const S = useStatsMessages();
  const copy = S.currentAttention;
  const format = useFormatters();
  const preferences = useLocalePreferences();
  const pending = useLocalePreferencePending();
  const query = trpc.stats.currentAttention.useQuery(scope, {
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
  const report = fresh && !query.isError ? query.data : undefined;
  const code = query.error?.data?.code;
  const permitted =
    code !== "UNAUTHORIZED" && code !== "FORBIDDEN" && report?.state !== "permission";
  return (
    <Panel title={copy.title} isEmpty={false} emptyText="">
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{copy.definition}</p>
        {!fresh && <p role="status">{S.loading}</p>}
        {fresh && !permitted && <p role="status">{copy.permission}</p>}
        {fresh && permitted && report?.state !== "available" && (
          <div className="space-y-3">
            <p role="alert">
              {report?.state === "unavailable" && report.reason === "match-limit"
                ? copy.matchLimit
                : copy.unavailable}
            </p>
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
        {report?.state === "available" && (
          <>
            <p className="text-sm text-muted-foreground">
              {copy.observedAt}{" "}
              <bdi>
                {formatDateTime(report.observedAt, { ...preferences, timeZone: report.timeZone })}
              </bdi>{" "}
              <bdi>({report.timeZone})</bdi>
            </p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {metrics.map((metric) => (
                <div key={metric} className="rounded-lg border bg-muted/30 p-3">
                  <dt className="text-sm text-muted-foreground">{copy[metric]}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    <bdi>{format.number(report.counts[metric])}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Panel>
  );
}
