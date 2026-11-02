"use client";

import { Search, X } from "lucide-react";
import type React from "react";
import { useId, useRef, useState } from "react";
import { SecondaryNavLink } from "@/components/navigation/SecondaryNavLink";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { SettingsNavSection } from "./settingsNavSections";

function normalizeSearch(value: string, locale: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .toLocaleLowerCase(locale)
    .trim();
}

export function SettingsNavContent({
  sections,
  activeHref,
  onNavigate,
}: {
  sections: SettingsNavSection[];
  activeHref?: string;
  onNavigate?: () => void;
}): React.ReactNode {
  const L = useSettingsMessages();
  const locale = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const words = normalizeSearch(query, locale).split(/\s+/).filter(Boolean);
  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const text = normalizeSearch(`${section.title} ${item.label}`, locale);
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <nav aria-label={L._extra.settingsSections} className="space-y-5">
      <div className="sticky top-0 z-10 bg-background pb-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={L._hierarchy.navigationSearch}
            placeholder={L._hierarchy.navigationSearch}
            className="pe-9 ps-9"
          />
          {query !== "" && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-0 top-0 size-8"
              aria-label={L._hierarchy.clearNavigationSearch}
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {visible.length === 0 && (
        <p role="status" className="px-2 text-sm text-muted-foreground">
          {L._hierarchy.navigationEmpty}
        </p>
      )}
      {visible.map((section) => (
        <section key={section.id} aria-labelledby={`${id}-${section.id}`}>
          <h2
            id={`${id}-${section.id}`}
            className="mb-2 px-2 text-xs font-semibold text-muted-foreground"
          >
            {section.title}
          </h2>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <SecondaryNavLink
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={activeHref === item.href}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
