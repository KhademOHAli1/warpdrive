"use client";

import Image from "next/image";
import Link from "next/link";
import { APP_NAME } from "@/constants/app";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { useWorkspaceShell } from "./WorkspaceShellProvider";

export function SidebarChrome({
  expanded,
  onNavigate,
}: {
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const t = useAppTranslations("shell");
  const { brand } = useWorkspaceShell();
  const logo = (
    <span aria-hidden="true" className={styles.logo} dir="ltr">
      {brand.iconUrl !== null ? (
        <Image
          src={brand.iconUrl}
          alt=""
          width={32}
          height={32}
          unoptimized
          className="size-8 shrink-0 rounded object-contain"
          style={{ backgroundColor: brand.accentColor ?? undefined }}
        />
      ) : brand.displayName !== APP_NAME ? (
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded font-semibold"
          style={{
            backgroundColor: brand.accentColor ?? undefined,
            color: brand.accentColor !== null ? brand.foregroundColor : undefined,
          }}
        >
          {brand.displayName.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <span
          className={styles.logoMark}
          style={brand.accentColor !== null ? { color: brand.accentColor } : undefined}
        >
          <i />
          <i />
          <i />
        </span>
      )}
      {expanded && <bdi className={styles.logoWordmark}>{brand.displayName}</bdi>}
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
        aria-label={t("home", { app: brand.displayName })}
        onClick={onNavigate}
      >
        {logo}
      </Link>
    </div>
  );
}
