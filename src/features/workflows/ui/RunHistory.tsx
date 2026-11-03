"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { cancelWorkflowAction } from "../actions";
import { RunDetailDialog } from "./RunDetailDialog";
import { RunRecovery } from "./RunRecovery";
import { useDialogFocus } from "./useDialogFocus";
import { WaitTimestamp } from "./WaitTimestamp";

type CancelStatus = Extract<
  Awaited<ReturnType<typeof cancelWorkflowAction>>,
  { ok: true }
>["value"];

export function RunHistory({ workflowId, canCancel }: { workflowId: string; canCancel: boolean }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const list = trpc.workflows.runs.useQuery(
    { id: workflowId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((row) => ["queued", "running", "waiting"].includes(row.status)) ===
        true
          ? 2500
          : false,
    },
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set());
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<CancelStatus | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const cancelling = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const detailFocus = useDialogFocus();
  const refreshButton = useRef<HTMLButtonElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  async function refresh() {
    try {
      const result = await list.refetch();
      setRefreshFailed(result.isError);
      if (!result.isError) setReviewed(true);
    } catch {
      setRefreshFailed(true);
    }
  }
  async function cancel(id: string) {
    if (unknown || cancelling.current || cancelled.has(id)) return;
    cancelling.current = true;
    setPending(id);
    setError(false);
    setCancelNotice(null);
    try {
      const result = await cancelWorkflowAction(id, readCsrfToken());
      if (!result.ok) {
        setError(true);
        return;
      }
      setCancelled((current) => new Set([...current, id]));
      setCancelNotice(result.value);
      // Record the cancellation before the independently fallible history read.
      await refresh();
    } catch {
      setUnknown(true);
      setReviewed(false);
    } finally {
      cancelling.current = false;
      setPending(null);
    }
  }
  return (
    <section className="space-y-5 p-6" aria-label={t("runs")}>
      <header className="flex items-center justify-between">
        <h2 ref={historyHeading} tabIndex={-1} className="font-semibold">
          {t("runs")}
        </h2>
        <Button
          ref={refreshButton}
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={list.isFetching}
        >
          <RefreshCw className="size-4" />
          {t("refresh")}
        </Button>
      </header>
      {cancelNotice !== null && (
        <p role="status" className="text-sm text-success">
          {cancelNotice === "cancelled" ? t("runCancelled") : t(`status.${cancelNotice}`)}
        </p>
      )}
      {refreshFailed && (
        <p className="text-sm text-muted-foreground">
          {t(cancelled.size > 0 ? "refreshAfterAck" : "loadError")}
        </p>
      )}
      {unknown && (
        <div className="space-y-2">
          <p role="alert">{t("cancelUnknown")}</p>
          <Button
            variant="outline"
            disabled={!reviewed}
            onClick={() => {
              setUnknown(false);
              setReviewed(false);
            }}
          >
            {t("allowCancelRetry")}
          </Button>
        </div>
      )}
      {list.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("error")}
        </p>
      )}
      {list.isLoading && <p role="status">{t("loading")}</p>}
      {!list.isError && !list.isLoading && list.data?.length === 0 && (
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
            {run.status === "waiting" && (
              <p className="mt-3 text-sm text-muted-foreground">
                <WaitTimestamp value={run.resumeAt} label={t("scheduledResume")} />
                <span className="mt-1 block text-xs">{t("waitRecoveryHint")}</span>
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(event) => {
                detailFocus.remember(event.currentTarget);
                setSelected(run.id);
              }}
            >
              {t("viewRun")}
            </Button>
            {run.status === "queued" && (
              <p className="mt-3 text-sm text-muted-foreground">{t("queuedHint")}</p>
            )}
            {run.status === "failed" && (
              <p className="mt-3 text-sm text-destructive">
                {t("runError")} <bdi className="font-mono text-xs">{run.errorId}</bdi>
              </p>
            )}
            {run.recovery !== undefined && (
              <RunRecovery
                workflowId={workflowId}
                runId={run.id}
                status={run.status}
                recovery={run.recovery}
              />
            )}
            {canCancel &&
              !cancelled.has(run.id) &&
              ["queued", "running", "waiting"].includes(run.status) && (
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  disabled={unknown || pending !== null}
                  onClick={() => void cancel(run.id)}
                >
                  {t("cancelRun")}
                </Button>
              )}
          </article>
        ))}
      </div>
      {selected !== null && (
        <RunDetailDialog
          workflowId={workflowId}
          runId={selected}
          onCloseAutoFocus={(event) => {
            const refresh = refreshButton.current;
            const fallback =
              refresh?.isConnected === true && !refresh.disabled ? refresh : historyHeading.current;
            detailFocus.restore(event, fallback);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
