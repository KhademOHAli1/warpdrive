"use client";

import { useConnection } from "@xyflow/react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { cn } from "@/lib/utils";

export function ConnectionFeedback({ occupied }: { occupied: { from: string; port: string }[] }) {
  const connection = useConnection();
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  if (!connection.inProgress) return null;
  const rewiring = occupied.some(
    (edge) => edge.from === connection.fromHandle.nodeId && edge.port === connection.fromHandle.id,
  );
  return (
    <p
      role="status"
      dir={directionForLocale(locale)}
      className={cn(
        "pointer-events-none absolute start-1/2 top-3 z-10 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-center text-xs shadow-sm",
        connection.isValid === false && "border-destructive/30 text-destructive",
      )}
    >
      {t(
        connection.isValid === false
          ? "connectionBlocked"
          : connection.isValid === true
            ? "releaseConnection"
            : rewiring
              ? "rewiringConnection"
              : "drawingConnection",
      )}
    </p>
  );
}
