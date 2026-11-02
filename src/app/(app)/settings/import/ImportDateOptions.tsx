"use client";
import { useMemo } from "react";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CalendarSystem } from "@/lib/localeFormatting";

export function ImportDateOptions({
  calendar,
  timeZone,
  onCalendar,
  onTimeZone,
  disabled,
}: {
  calendar: CalendarSystem;
  timeZone: string;
  onCalendar: (calendar: CalendarSystem) => void;
  onTimeZone: (zone: string) => void;
  disabled: boolean;
}) {
  const t = useAppTranslations("dataConventions");
  const zones = useMemo(
    () =>
      [
        ...new Set([
          "UTC",
          "Asia/Tehran",
          "Europe/Berlin",
          timeZone,
          ...Intl.supportedValuesOf("timeZone"),
        ]),
      ].sort(),
    [timeZone],
  );
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("dates.calendar")}</p>
          <Select
            ariaLabel={t("dates.calendar")}
            value={calendar}
            options={[
              { value: "gregory", label: t("dates.gregory") },
              { value: "persian", label: t("dates.persian") },
            ]}
            onChange={(value) => {
              if (value === "gregory" || value === "persian") onCalendar(value);
            }}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("dates.timeZone")}</p>
          <Select
            ariaLabel={t("dates.timeZone")}
            value={timeZone}
            options={zones.map((zone) => ({ value: zone, label: zone }))}
            onChange={(zone) => {
              if (zones.includes(zone)) onTimeZone(zone);
            }}
            disabled={disabled}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("dates.hint")}</p>
    </fieldset>
  );
}
