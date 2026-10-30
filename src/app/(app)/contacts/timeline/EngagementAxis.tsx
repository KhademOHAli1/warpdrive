"use client";
import type React from "react";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import type { NumberingSystem } from "@/lib/numberingSystem";

export function monthLabel(
  key: string,
  locale: Locale = "en",
  numberingSystem?: NumberingSystem,
): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return key;
  return new Intl.DateTimeFormat(localeTagForFormatting({ locale, numberingSystem }), {
    calendar: "gregory",
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  }).format(new Date(`${key}-15T12:00:00Z`));
}

// The month header row: a pinned "Contact" column, then one fixed-layout column per month.
export function EngagementAxis({ months }: { months: string[] }): React.ReactNode {
  const t = useAppTranslations("contacts");
  const { locale, numberingSystem } = useLocalePreferences();
  return (
    <thead>
      <tr>
        <th
          scope="col"
          className="sticky start-0 z-20 border-b border-e bg-muted px-3 py-2 text-start text-xs font-semibold text-muted-foreground"
        >
          {t("contact")}
        </th>
        {months.map((key, i) => (
          <th
            key={key}
            scope="col"
            className={`border-b bg-muted/40 px-3 py-2 text-center text-xs font-semibold text-muted-foreground ${i > 0 ? "border-s" : ""}`}
          >
            {/* The period always ends at the current month, so the rightmost tick is "now": PD
                labels it "Today" rather than repeating the month name. */}
            {i === months.length - 1 ? t("today") : monthLabel(key, locale, numberingSystem)}
          </th>
        ))}
      </tr>
    </thead>
  );
}
