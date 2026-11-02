"use client";

import { ChevronDown, Settings2 } from "lucide-react";
import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { SettingsNavContent } from "./SettingsNavContent";
import {
  activeSettingsItem,
  type SettingsNavAccess,
  type SettingsNavSection,
  settingsNavSections,
} from "./settingsNavSections";

const DESKTOP_SETTINGS_QUERY = "(min-width: 768px)";

function MobileSettingsNav({
  sections,
  activeHref,
  currentLabel,
}: {
  sections: SettingsNavSection[];
  activeHref?: string;
  currentLabel: string;
}): React.ReactNode {
  const L = useSettingsMessages();
  const rtl = useLocale() === "fa";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheetId = useId();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_SETTINGS_QUERY);
    const onBreakpoint = (): void => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", onBreakpoint);
    return () => media.removeEventListener("change", onBreakpoint);
  }, []);

  return (
    <div className="md:hidden">
      <Button
        ref={trigger}
        variant="outline"
        className="h-auto min-h-10 w-full justify-between gap-3 px-3 py-2 text-start"
        aria-label={`${L._hierarchy.sectionNavigation}: ${currentLabel}`}
        aria-controls={sheetId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 whitespace-normal">{currentLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id={sheetId}
          side={rtl ? "right" : "left"}
          aria-describedby={undefined}
          className="w-80 max-w-[calc(100vw-2rem)] p-4 pt-5"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <SheetTitle className="mb-5 pe-8 text-base">{L._extra.settingsSections}</SheetTitle>
          <SettingsNavContent
            sections={sections}
            activeHref={activeHref}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function SettingsNav(access: SettingsNavAccess): React.ReactNode {
  const L = useSettingsMessages();
  const locale = useLocale();
  const pathname = usePathname();
  const sections = settingsNavSections(L, locale, access);
  const active = activeSettingsItem(sections, pathname);

  return (
    <>
      <MobileSettingsNav
        key={pathname}
        sections={sections}
        activeHref={active?.href}
        currentLabel={active?.label ?? L._extra.settingsNav}
      />
      <div className="hidden w-60 shrink-0 md:sticky md:top-4 md:block md:max-h-[calc(100dvh-6rem)] md:self-start md:overflow-y-auto md:pe-2">
        <SettingsNavContent sections={sections} activeHref={active?.href} />
      </div>
    </>
  );
}
