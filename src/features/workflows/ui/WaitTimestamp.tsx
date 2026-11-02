"use client";

import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";

export function WaitTimestamp({ value, label }: { value: Date | null; label: string }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  return (
    <span>
      <span>{label}</span>
      {": "}
      {value === null ? (
        t("waitTimingUnavailable")
      ) : (
        <time dir="auto" dateTime={value.toISOString()}>
          {fmt.dateTime(value, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          })}
        </time>
      )}
    </span>
  );
}
