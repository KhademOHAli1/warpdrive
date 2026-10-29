"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { useDirection } from "@/components/ui/direction";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { Appearance } from "./appearance";
import type { AppearanceChoice } from "./useAppearanceChoice";

const OPTIONS = ["system", "day", "night"] as const satisfies readonly Appearance[];
const ICONS = { system: Monitor, day: Sun, night: Moon };

// Keep these in the menu's own focus group. Horizontal keys move between the icons;
// Enter/Space and the menu's normal vertical navigation remain managed by Radix.
export function AppearanceMenuSection({ choice }: { choice: AppearanceChoice }): React.ReactNode {
  const t = useAppTranslations("shell.appearance");
  const direction = useDirection();
  const items = useRef<Record<Appearance, HTMLDivElement | null>>({
    system: null,
    day: null,
    night: null,
  });

  function navigate(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = OPTIONS.findIndex((option) => items.current[option] === event.target);
    if (current === -1) return;
    const delta = (event.key === "ArrowRight") === (direction === "ltr") ? 1 : -1;
    const next = OPTIONS[(current + delta + OPTIONS.length) % OPTIONS.length];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    items.current[next]?.focus();
  }

  return (
    <DropdownMenuRadioGroup
      value={choice.value}
      onValueChange={choice.choose}
      aria-label={t("title")}
      onKeyDown={navigate}
      className="flex gap-1 rounded-md bg-muted/40 p-1"
    >
      {OPTIONS.map((option) => {
        const Icon = ICONS[option];
        return (
          <DropdownMenuRadioItem
            key={option}
            value={option}
            aria-label={t(option)}
            ref={(item) => {
              items.current[option] = item;
            }}
            className="h-8 min-w-0 flex-1 justify-center rounded p-0 text-muted-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-xs [&>span]:hidden"
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
