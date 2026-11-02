"use client";

import { Tip } from "@/components/ui/tooltip";
import { useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { FinanceNavGlyph } from "./NavIcons";

export function SidebarToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const messages = useMessages();
  const rtl = useLocale() === "fa";
  const label = expanded ? messages.navigation.collapse : messages.navigation.expand;
  const pointsRight = expanded ? rtl : !rtl;
  return (
    <Tip
      label={label}
      side={rtl ? "left" : "right"}
      className={styles.tooltip}
      delayDuration={0}
      sideOffset={10}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls="primary-navigation"
        className={cn(
          styles.navItem,
          styles.navItemInactive,
          styles.sidebarToggleAction,
          expanded ? styles.navItemOpen : styles.navItemCollapsed,
        )}
        onClick={onToggle}
      >
        <span aria-hidden="true" className={styles.navIconFrame}>
          <FinanceNavGlyph
            name={pointsRight ? "chevron-right" : "chevron-left"}
            size={20}
            mirror={false}
          />
        </span>
        <span
          aria-hidden={!expanded}
          className={styles.sidebarCopy}
          data-sidebar-copy-state={expanded ? "expanded" : "collapsed"}
        >
          {label}
        </span>
      </button>
    </Tip>
  );
}
