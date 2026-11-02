"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { DeliveryReportsPanel } from "./DeliveryReportsPanel";
import type { DeliveryObservationReaderScope } from "./deliveryObservationReader.types";
import { invalidateDeliveryObservationReaders } from "./invalidateDeliveryObservationReaders";
import { useDeliveryObservationReader } from "./useDeliveryObservationReader";
import { useDeliveryObservationVisibility } from "./useDeliveryObservationVisibility";

export function ReaderDeliveryReports(
  props: DeliveryObservationReaderScope & { threadId?: string },
): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useDeliveryObservationVisibility(ref);
  const t = useAppTranslations("deliveryReports");
  const utils = trpc.useUtils();
  const onReviewed = useCallback(() => invalidateDeliveryObservationReaders(utils), [utils]);
  const state = useDeliveryObservationReader(props, visible, onReviewed);
  return (
    <div ref={ref} aria-busy={visible && state.loading}>
      {visible && state.loading && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {visible && state.error !== null && (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          {t(
            state.error === "permission" || state.error === "not_found"
              ? "permission"
              : state.error === "conflict"
                ? "conflict"
                : "loadFailure",
          )}
        </p>
      )}
      {visible && !state.loading && (state.reports.length > 0 || state.error !== null) && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={state.refresh}>
            <RefreshCw aria-hidden="true" className="me-1.5 size-3.5" />
            {t("refresh")}
          </Button>
        </div>
      )}
      {visible && !state.loading && state.error === null && (
        <DeliveryReportsPanel
          key={state.generation}
          isOwner
          reports={state.reports}
          targets={state.targets}
          onReview={state.onReview}
        />
      )}
    </div>
  );
}
