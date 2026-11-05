"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Select } from "@/components/ui/Select";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
  useNumberingSystem,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { regionalFormatDefaults } from "@/features/i18n/regionalContext";
import { IranianMoneySetting } from "./IranianMoneySetting";

export function RegionalFormatsSettings() {
  const t = useAppTranslations("preferences");
  const preferences = useLocalePreferences();
  const numbers = useNumberingSystem();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  const relevantNumbers =
    preferences.locale === "fa" || preferences.country === "IR" || numbers === "arabext";
  return (
    <Collapsible className="border-t pt-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ms-2 gap-2 text-muted-foreground">
          {t("customizeFormats")}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3">
        <p className="text-xs text-muted-foreground">
          {t(preferences.country === undefined ? "countryRequired" : "formatDefaults")}
        </p>
        {preferences.locale === "fa" && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("calendar")}</p>
            <Select
              ariaLabel={t("calendar")}
              value={preferences.calendar}
              disabled={pending}
              options={[
                { value: "persian", label: t("persianCalendar") },
                { value: "gregory", label: t("gregorianCalendar") },
              ]}
              onChange={(value) => {
                if (value === "persian" || value === "gregory") void choose({ calendar: value });
              }}
            />
          </div>
        )}
        {relevantNumbers && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("numberDisplay")}</p>
            <Select
              ariaLabel={t("numberDisplay")}
              value={numbers}
              disabled={pending}
              options={[
                { value: "arabext", label: t("persianNumbers") },
                { value: "latn", label: t("englishNumbers") },
              ]}
              onChange={(value) => {
                if (value === "arabext" || value === "latn")
                  void choose({ numberingSystem: value });
              }}
            />
          </div>
        )}
        {preferences.country === "IR" && <IranianMoneySetting />}
        <Button
          variant="outline"
          size="sm"
          disabled={pending || preferences.country === undefined}
          onClick={() =>
            void choose(regionalFormatDefaults(preferences.country, preferences.locale))
          }
        >
          {t("resetFormats")}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
