"use client";

import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useLocale,
  useLocalePreferencePending,
  useMessages,
  useSetLocalePreferences,
} from "./LocaleProvider";
import { directionForLocale, LOCALE_REGISTRY, parseLocale, SELECTABLE_LOCALES } from "./registry";

function LanguageChoices(): ReactNode {
  const locale = useLocale();
  const choose = useSetLocalePreferences();
  const pending = useLocalePreferencePending();
  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => void choose({ locale: parseLocale(value) })}
    >
      {SELECTABLE_LOCALES.map((choice) => (
        <DropdownMenuRadioItem key={choice} value={choice} disabled={pending}>
          <span lang={choice} dir={directionForLocale(choice)}>
            {LOCALE_REGISTRY[choice].name}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function LanguageSwitcher(): ReactNode {
  const locale = useLocale();
  const { preferences } = useMessages();
  const pending = useLocalePreferencePending();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        aria-label={preferences.language}
        className="rounded px-2 py-1 text-sm hover:bg-muted"
      >
        <span lang={locale} dir={directionForLocale(locale)}>
          {LOCALE_REGISTRY[locale].name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <LanguageChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageMenuItem(): ReactNode {
  const { preferences } = useMessages();
  const pending = useLocalePreferencePending();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={pending}>{preferences.language}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <LanguageChoices />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
