"use client";

import Link from "next/link";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { FinanceNavGlyph } from "./NavIcons";

function matchesSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

function isPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function SidebarLinkTooltip({
  expanded,
  label,
  rtl,
  children,
}: {
  expanded: boolean;
  label: string;
  rtl: boolean;
  children: ReactNode;
}): ReactNode {
  if (expanded) return children;
  return (
    <Tip
      label={label}
      side={rtl ? "left" : "right"}
      className={styles.tooltip}
      delayDuration={0}
      sideOffset={10}
    >
      {children}
    </Tip>
  );
}

export interface SidebarChild {
  href: string;
  label: string;
}
export interface SidebarItem {
  href: string;
  section: string;
  label: string;
  Icon: ComponentType<{ className?: string; size?: number }>;
  children?: SidebarChild[];
}

export function SidebarMenuItem({
  item,
  pathname,
  expanded,
  onNavigate,
}: {
  item: SidebarItem;
  pathname: string;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const t = useAppTranslations("shell.sidebar");
  const rtl = useLocale() === "fa";
  const active = matchesSection(pathname, item.section);
  const [override, setOverride] = useState<{ path: string; open: boolean } | null>(null);
  const open = expanded && (override?.path === pathname ? override.open : active);
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  function activate(event: MouseEvent<HTMLAnchorElement>): void {
    if (!isPrimaryClick(event)) return;
    if (expanded && hasChildren && !open) {
      event.preventDefault();
      setOverride({ path: pathname, open: true });
      return;
    }
    onNavigate?.();
  }
  const link = (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      aria-label={expanded ? undefined : item.label}
      className={cn(
        styles.navItem,
        expanded ? styles.navItemOpen : styles.navItemCollapsed,
        active ? styles.navItemActive : styles.navItemInactive,
        expanded && hasChildren && styles.navItemWithDisclosure,
      )}
      onClick={activate}
    >
      <span className={styles.navIconFrame} aria-hidden="true">
        <item.Icon
          className={cn(styles.navIcon, active ? styles.navIconActive : styles.navIconInactive)}
          size={20}
        />
      </span>
      <span
        aria-hidden={!expanded}
        className={styles.sidebarCopy}
        data-sidebar-copy-state={expanded ? "expanded" : "collapsed"}
      >
        {item.label}
      </span>
    </Link>
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => setOverride({ path: pathname, open: value })}
      className={cn(styles.menuGroup, !expanded && styles.menuGroupCollapsed)}
    >
      <div className={cn(styles.navRow, !expanded && styles.navRowCollapsed)}>
        <SidebarLinkTooltip expanded={expanded} label={item.label} rtl={rtl}>
          {link}
        </SidebarLinkTooltip>
        {expanded && hasChildren && (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={t(open ? "collapseGroup" : "expandGroup", { label: item.label })}
              className={styles.disclosureButton}
            >
              <FinanceNavGlyph
                name="chevron-down"
                size={20}
                className={open ? styles.disclosureIconExpanded : styles.disclosureIcon}
              />
            </button>
          </CollapsibleTrigger>
        )}
      </div>
      {hasChildren && (
        <CollapsibleContent
          forceMount
          className={styles.subnav}
          data-expanded={open}
          aria-hidden={!open}
          inert={!open}
        >
          {children.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              prefetch={false}
              tabIndex={open ? undefined : -1}
              className={cn(
                styles.subnavLink,
                matchesSection(pathname, child.href)
                  ? styles.subnavLinkActive
                  : styles.subnavLinkInactive,
              )}
              aria-current={matchesSection(pathname, child.href) ? "page" : undefined}
              onClick={(event) => {
                if (isPrimaryClick(event)) onNavigate?.();
              }}
            >
              {child.label}
            </Link>
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
