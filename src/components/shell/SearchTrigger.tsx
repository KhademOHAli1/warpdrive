"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { OPEN_SEARCH_EVENT } from "@/features/search/ui/events";

// SearchTrigger: looks like the static search input but dispatches the named
// custom event on click. Fully decoupled from CommandPalette (no shared state).
export function SearchTrigger() {
  const t = useAppTranslations("shell");
  return (
    <Button
      variant="outline"
      static
      aria-label={t("searchOpen")}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
      className="w-full max-w-md justify-start truncate bg-background text-start font-normal text-muted-foreground"
    >
      {t("searchPlaceholder")}
    </Button>
  );
}
