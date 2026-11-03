"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { retryWorkflowAction } from "../actions";
import type { RunRecovery as Recovery } from "../runRetryTypes";

type RetryError = "retryDenied" | "retryConflict" | "retryUnavailable" | "retryUnknown";

function errorKey(code: string): RetryError {
  if (code === ERROR_IDS.WORKFLOW_DENIED) return "retryDenied";
  if (code === ERROR_IDS.WORKFLOW_CONFLICT) return "retryConflict";
  return "retryUnavailable";
}

export function RunRecovery({
  workflowId,
  runId,
  status,
  recovery,
  detailed = false,
  nodeName,
}: {
  workflowId: string;
  runId: string;
  status: string;
  recovery: Recovery;
  detailed?: boolean;
  nodeName?: (id: string | null) => string | undefined;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ failureId: string; key: RetryError } | null>(null);
  const [requested, setRequested] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ failureId: string; requestKey: string } | null>(null);

  async function retry() {
    const failureId = recovery.failureId;
    if (inFlight.current || !recovery.eligible || failureId === null) return;
    if (intent.current?.failureId !== failureId)
      intent.current = { failureId, requestKey: crypto.randomUUID() };
    const command = { runId, ...intent.current };
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await retryWorkflowAction(command, readCsrfToken());
      if (!result.ok) setError({ failureId, key: errorKey(result.error) });
      else setRequested(true);
    } catch {
      setError({ failureId, key: "retryUnknown" });
    } finally {
      try {
        await Promise.all([
          utils.workflows.runs.invalidate({ id: workflowId }),
          utils.workflows.run.invalidate({ id: workflowId, runId }),
        ]);
      } catch {
        // A read refresh failure cannot change the authoritative retry outcome.
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  const lastRetry = recovery.history.find((entry) => entry.retriedAt !== null);
  return (
    <section className="mt-3 space-y-3" aria-label={t("retryRecovery")}>
      {status === "failed" && (
        <>
          <p className="max-w-prose text-xs leading-5 text-muted-foreground">
            {recovery.eligible ? t("retryHint") : t(`retryReason.${recovery.reason}`)}
          </p>
          {recovery.eligible && recovery.failureId !== null && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void retry()}
            >
              <RotateCcw className="size-4" />
              {t(pending ? "retrying" : "retryRun")}
            </Button>
          )}
          {error !== null && error.failureId === recovery.failureId && (
            <p role="alert" className="text-sm text-destructive">
              {t(error.key)}
            </p>
          )}
        </>
      )}
      {requested && status !== "failed" && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("retryRequested")}
        </p>
      )}
      {!detailed && lastRetry?.retriedAt != null && (
        <p className="text-xs text-muted-foreground">
          {t("retryRecorded")}{" "}
          <time dateTime={lastRetry.retriedAt.toISOString()}>
            {fmt.dateTime(lastRetry.retriedAt)}
          </time>
        </p>
      )}
      {detailed && recovery.history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("retryHistory")}</h3>
          <ol className="space-y-2 border-s ps-4 text-xs text-muted-foreground">
            {recovery.history.map((entry) => (
              <li key={entry.id} className="space-y-1">
                <p>
                  <bdi className="font-medium text-foreground">
                    {nodeName?.(entry.nodeId) ?? t("retryFailedStep")}
                  </bdi>
                </p>
                <p>
                  {t(
                    entry.origin === "legacy_snapshot"
                      ? "retryLegacyFailure"
                      : "retryFailureRecorded",
                  )}{" "}
                  <time dateTime={entry.failedAt.toISOString()}>
                    {fmt.dateTime(entry.failedAt)}
                  </time>
                </p>
                <p>
                  {t("runError")} <bdi className="font-mono">{entry.errorId}</bdi>
                </p>
                {entry.originalResumeAt !== null && (
                  <p>
                    {t("retryOriginalDeadline")}{" "}
                    <time dateTime={entry.originalResumeAt.toISOString()}>
                      {fmt.dateTime(entry.originalResumeAt)}
                    </time>
                  </p>
                )}
                {entry.retriedAt !== null && (
                  <p>
                    {t("retryRecorded")}{" "}
                    <time dateTime={entry.retriedAt.toISOString()}>
                      {fmt.dateTime(entry.retriedAt)}
                    </time>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
