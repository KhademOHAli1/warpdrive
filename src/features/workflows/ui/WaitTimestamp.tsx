"use client";

import { useId } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";

export function WaitTimestamp({
  value,
  label,
  precision = "minute",
  exactValue,
}: {
  value: Date | null;
  label: string;
  precision?: "minute" | "millisecond";
  exactValue?: string;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const exactId = useId();
  const shown =
    value === null
      ? null
      : fmt.dateTime(value, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          ...(precision === "millisecond"
            ? { second: "2-digit" as const, fractionalSecondDigits: 3 as const }
            : {}),
          timeZoneName: "short",
        });
  return (
    <span>
      <span>{label}</span>
      {": "}
      {value === null ? (
        <span>{t("waitTimingUnavailable")}</span>
      ) : (
        <>
          <time dir="auto" dateTime={value.toISOString()} aria-describedby={exactId}>
            {shown}
          </time>
          <span id={exactId} className="sr-only">
            {t("waitExactInstant")}
            {": "}
            <bdi dir="ltr">{exactValue ?? value.toISOString()}</bdi>
          </span>
        </>
      )}
    </span>
  );
}
