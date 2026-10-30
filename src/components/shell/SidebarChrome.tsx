"use client";

import Link from "next/link";
import { Tip } from "@/components/ui/tooltip";
import { APP_NAME } from "@/constants/app";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { FinanceNavGlyph } from "./NavIcons";

export function SidebarChrome({
  expanded,
  onToggle,
  mobile = false,
  onNavigate,
}: {
  expanded: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const messages = useMessages();
  const t = useAppTranslations("shell");
  const rtl = useLocale() === "fa";
  const label = expanded ? messages.navigation.collapse : messages.navigation.expand;
  const logo = (
    <span aria-hidden="true" className={styles.logo} dir="ltr">
      <span className={styles.logoMark}>
        <i />
        <i />
        <i />
      </span>
      {expanded && <bdi className={styles.logoWordmark}>{APP_NAME}</bdi>}
    </span>
  );
  return (
    <div
      className={cn(
        styles.sidebarTopbar,
        expanded ? styles.sidebarTopbarExpanded : styles.sidebarTopbarCollapsed,
      )}
    >
      {expanded ? (
        <Link
          className={styles.logoLink}
          href="/pipeline"
          aria-label={t("home", { app: APP_NAME })}
          onClick={onNavigate}
        >
          {logo}
        </Link>
      ) : (
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
            aria-expanded={false}
            aria-controls="primary-navigation"
            className={styles.logoLink}
            onClick={onToggle}
          >
            {logo}
          </button>
        </Tip>
      )}
      {expanded && !mobile && (
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
            aria-expanded
            className={styles.sidebarCollapseButton}
            aria-controls="primary-navigation"
            onClick={onToggle}
          >
            <FinanceNavGlyph
              name={rtl ? "chevron-right" : "chevron-left"}
              size={20}
              mirror={false}
            />
          </button>
        </Tip>
      )}
    </div>
  );
}
