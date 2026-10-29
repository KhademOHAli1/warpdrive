"use client";

import type { ReactNode } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  useLocale,
  useLocalePreferencePending,
  useMessages,
  useSetLocalePreferences,
} from "./LocaleProvider";

function useLanguageChoice() {
  const locale = useLocale();
  const { language } = useMessages();
  const choose = useSetLocalePreferences();
  const pending = useLocalePreferencePending();
  const next = locale === "fa" ? "en" : "fa";
  return { language, next, pending, switchLanguage: () => void choose({ locale: next }) };
}

export function LanguageSwitcher(): ReactNode {
  const { language, next, pending, switchLanguage } = useLanguageChoice();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={switchLanguage}
      aria-label={language.switchLabel}
      className="rounded px-2 py-1 text-sm hover:bg-muted"
    >
      <span lang={next} dir={next === "fa" ? "rtl" : "ltr"}>
        {language.switchTo}
      </span>
    </button>
  );
}

export function LanguageMenuItem(): ReactNode {
  const { language, next, pending, switchLanguage } = useLanguageChoice();
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={switchLanguage}
      aria-label={language.switchLabel}
    >
      <span lang={next} dir={next === "fa" ? "rtl" : "ltr"}>
        {language.switchTo}
      </span>
    </DropdownMenuItem>
  );
}
