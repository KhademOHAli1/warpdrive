"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { useWorkflowLifecycle } from "./useWorkflowLifecycle";

export function EditorRecovery({
  lifecycle,
  libraryReturn,
}: {
  lifecycle: ReturnType<typeof useWorkflowLifecycle>;
  libraryReturn: string;
}) {
  const t = useAppTranslations("workflows");
  if (!lifecycle.refreshFailed && !lifecycle.unknown && !lifecycle.navigationPending) return null;
  const message = lifecycle.unknown
    ? "writeUnknown"
    : lifecycle.navigationPending
      ? "navigationAfterAck"
      : "refreshAfterAck";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
      <p>{t(message)}</p>
      <Button
        variant="outline"
        disabled={lifecycle.refreshing}
        onClick={() => void lifecycle.refresh()}
      >
        {t("refresh")}
      </Button>
      {lifecycle.copyId !== null && (
        <Button variant="outline" onClick={() => lifecycle.openCopy()}>
          {t("openCopy")}
        </Button>
      )}
      {lifecycle.unknown && (
        <>
          <Link href={libraryReturn}>{t("reviewLibrary")}</Link>
          <p>{t("retryReconcileHint")}</p>
          <Button variant="outline" onClick={() => lifecycle.allowRetry()}>
            {t("allowRetry")}
          </Button>
        </>
      )}
    </div>
  );
}
