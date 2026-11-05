"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { RunHumanForm } from "./RunHumanForm";
import { RunTrace } from "./RunTrace";

export function RunDetailDialog({
  workflowId,
  runId,
  onClose,
  onCloseAutoFocus,
}: {
  workflowId: string;
  runId: string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-none flex-col gap-4 overflow-hidden p-0 sm:max-w-none"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="px-5 pt-5 pe-12">
          <DialogTitle>{t("runDetails")}</DialogTitle>
          <DialogDescription>{t("historicalGraphHint")}</DialogDescription>
        </DialogHeader>
        <RunDetailRead
          key={JSON.stringify([workflowId, runId])}
          workflowId={workflowId}
          runId={runId}
        />
      </DialogContent>
    </Dialog>
  );
}

function RunDetailRead({ workflowId, runId }: { workflowId: string; runId: string }) {
  const t = useAppTranslations("workflows");
  const [retrying, setRetrying] = useState(false);
  const query = trpc.workflows.run.useQuery(
    { id: workflowId, runId },
    {
      placeholderData: undefined,
      retry: false,
      refetchInterval: (state) =>
        state.state.status === "success" &&
        state.state.data?.id === runId &&
        ["queued", "running", "waiting"].includes(state.state.data.status)
          ? 2500
          : false,
    },
  );
  const readProblem = query.isError || (query.data !== undefined && query.data.id !== runId);
  const visibleDetail =
    query.isError || query.isPlaceholderData || query.data?.id !== runId ? undefined : query.data;
  const loading = query.isLoading || query.isPlaceholderData || retrying;

  async function retryRead() {
    if (query.isFetching || retrying) return;
    setRetrying(true);
    try {
      await query.refetch({ cancelRefetch: false, throwOnError: false });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      {loading && (
        <p role="status" className="px-5 py-3">
          {t("loading")}
        </p>
      )}
      {(readProblem || retrying) && (
        <div className="space-y-3 px-5 py-3">
          {readProblem && (
            <p role="alert" className="text-destructive">
              {t("loadError")}
            </p>
          )}
          <Button
            variant="outline"
            disabled={query.isFetching || retrying}
            onClick={() => void retryRead()}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {visibleDetail?.pendingForm !== undefined && (
          <RunHumanForm
            key={visibleDetail.pendingForm.nodeId}
            form={visibleDetail.pendingForm}
            workflowId={workflowId}
            runId={runId}
            onSubmitted={() => {
              void retryRead();
            }}
          />
        )}
        {visibleDetail !== undefined && (
          <RunTrace key={visibleDetail.id} detail={visibleDetail} workflowId={workflowId} />
        )}
      </div>
    </>
  );
}
