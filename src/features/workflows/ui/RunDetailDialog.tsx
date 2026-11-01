"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
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
  const query = trpc.workflows.run.useQuery(
    { id: workflowId, runId },
    {
      refetchInterval: (state) =>
        state.state.data?.status === "queued" || state.state.data?.status === "running"
          ? 2500
          : false,
    },
  );
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
        {query.isLoading && (
          <p role="status" className="p-5">
            {t("loading")}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="p-5 text-destructive">
            {t("loadError")}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {query.data !== undefined && <RunTrace key={query.data.id} detail={query.data} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
