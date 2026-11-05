"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import styles from "./LeftNav.module.css";

export function SidebarToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const messages = useMessages();
  const rtl = useLocale() === "fa";
  const label = expanded ? messages.navigation.collapse : messages.navigation.expand;
  const Icon = expanded ? ChevronLeft : ChevronRight;
  return (
    <Tip
      label={label}
      side={rtl ? "left" : "right"}
      className={styles.tooltip}
      delayDuration={200}
      sideOffset={8}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls="primary-navigation"
        className={styles.sidebarToggle}
        onClick={onToggle}
      >
        <Icon
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          focusable="false"
          data-rtl-mirror="true"
        />
      </button>
    </Tip>
  );
}
