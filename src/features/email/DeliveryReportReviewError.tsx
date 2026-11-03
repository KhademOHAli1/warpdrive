"use client";

import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { DeliveryObservationError } from "./deliveryObservationTypes";

const MESSAGE_KEYS = {
  invalid_input: "failure",
  not_found: "permission",
  conflict: "conflict",
  permission: "permission",
  rate_limit: "failure",
  unknown: "saveUnconfirmed",
} as const satisfies Record<DeliveryObservationError, string>;

export function DeliveryReportReviewError({ error }: { error: DeliveryObservationError | null }) {
  const t = useAppTranslations("deliveryReports");
  if (error === null) return null;
  return (
    <p role="alert" className="text-sm leading-relaxed text-destructive">
      {t(MESSAGE_KEYS[error])}
    </p>
  );
}
