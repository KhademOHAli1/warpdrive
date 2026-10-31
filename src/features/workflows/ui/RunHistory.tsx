"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { cancelWorkflowAction } from "../actions";

export function RunHistory({ workflowId, canCancel }: { workflowId: string; canCancel: boolean }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const list = trpc.workflows.runs.useQuery(
    { id: workflowId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((row) => row.status === "queued" || row.status === "running") ===
        true
          ? 2500
          : false,
    },
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);
  async function cancel(id: string) {
    setPending(id);
    setError(false);
    try {
      const result = await cancelWorkflowAction(id, readCsrfToken());
      if (!result.ok) setError(true);
      await list.refetch();
    } catch {
      setError(true);
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="space-y-5 p-6" aria-label={t("runs")}>
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">{t("runs")}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          <RefreshCw className="size-4" />
          {t("refresh")}
        </Button>
      </header>
      {(error || list.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {t("error")}
        </p>
      )}
      {list.isLoading && <p role="status">{t("loading")}</p>}
      {list.data?.length === 0 && (
        <div className="py-16 text-center">
          <Activity className="mx-auto mb-4 size-7 text-muted-foreground" />
          <h3 className="font-medium">{t("historyEmpty")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t("historyHint")}</p>
        </div>
      )}
      <div className="space-y-3">
        {list.data?.map((run) => (
          <article key={run.id} className="rounded-lg border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Badge
                  variant={
                    run.status === "succeeded"
                      ? "success"
                      : run.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {t(`status.${run.status}`)}
                </Badge>
                <span className="text-sm font-medium">
                  {t(run.mode === "simulation" ? "simulationMode" : "liveMode")}
                </span>
              </div>
              <time
                className="text-xs text-muted-foreground"
                dateTime={run.createdAt.toISOString()}
              >
                {fmt.dateTime(run.createdAt)}
              </time>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("completedSteps", { count: run.steps.length })}
            </p>
            {run.status === "queued" && (
              <p className="mt-3 text-sm text-muted-foreground">{t("queuedHint")}</p>
            )}
            {run.status === "failed" && (
              <p className="mt-3 text-sm text-destructive">
                {t("runError")} <bdi className="font-mono text-xs">{run.errorId}</bdi>
              </p>
            )}
            {canCancel && (run.status === "queued" || run.status === "running") && (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => void cancel(run.id)}
              >
                {t("cancelRun")}
              </Button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
