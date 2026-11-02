"use client";

import Link from "next/link";
import { APP_NAME } from "@/constants/app";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";

export function SidebarChrome({
  expanded,
  onNavigate,
}: {
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const t = useAppTranslations("shell");
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
      <Link
        className={styles.logoLink}
        href="/pipeline"
        aria-label={t("home", { app: APP_NAME })}
        onClick={onNavigate}
      >
        {logo}
      </Link>
    </div>
  );
}
