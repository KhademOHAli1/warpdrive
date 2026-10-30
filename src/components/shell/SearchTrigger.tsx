"use client";
import { Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { OPEN_SEARCH_EVENT } from "@/features/search/ui/events";
import styles from "./TopBar.module.css";

// Platform stays constant for the lifetime of the page; the server hint hydrates without a mismatch.
const subscribePlatform = () => () => undefined;
const platformShortcut = () => (navigator.platform.startsWith("Mac") ? "⌘ K" : "Ctrl K");
const serverShortcut = () => "⌘ K";

// SearchTrigger: looks like the static search input but dispatches the named
// custom event on click. Fully decoupled from CommandPalette (no shared state).
export function SearchTrigger() {
  const t = useAppTranslations("shell");
  const shortcut = useSyncExternalStore(subscribePlatform, platformShortcut, serverShortcut);
  return (
    <Button
      variant="ghost"
      static
      aria-label={t("searchOpen")}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
      className={styles.searchTrigger}
    >
      <Search aria-hidden="true" className={styles.searchIcon} strokeWidth={1.6} />
      <span className={styles.searchText}>{t("searchHeaderPlaceholder")}</span>
      <kbd dir="ltr" className={styles.shortcut}>
        {shortcut}
      </kbd>
    </Button>
  );
}
