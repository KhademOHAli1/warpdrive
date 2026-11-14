"use client";

import Link from "next/link";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Tip } from "@/components/ui/tooltip";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { FinanceNavGlyph } from "./NavIcons";

function matchesSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

function matchesChild(pathname: string, child: SidebarChild): boolean {
  return child.exact === true ? pathname === child.href : matchesSection(pathname, child.href);
}

function isPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function isGroupOpen(
  expanded: boolean,
  pathname: string,
  active: boolean,
  override: { path: string; open: boolean } | null,
): boolean {
  return expanded && (override?.path === pathname ? override.open : active);
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
  return (
    <Tip
      label={label}
      side={rtl ? "left" : "right"}
      className={cn(styles.tooltip, expanded && styles.tooltipHidden)}
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
  exact?: boolean;
}
export interface SidebarItem {
  href: string;
  section: string;
  additionalSections?: readonly string[];
  label: string;
  Icon: ComponentType<{ className?: string; size?: number }>;
  children?: SidebarChild[];
}

export function SidebarMenuItem({
  item,
  pathname,
  expanded,
  onNavigate,
  onRequestExpand,
}: {
  item: SidebarItem;
  pathname: string;
  expanded: boolean;
  onNavigate?: () => void;
  onRequestExpand?: () => void;
}) {
  const rtl = useLocale() === "fa";
  const active = [item.section, ...(item.additionalSections ?? [])].some((section) =>
    matchesSection(pathname, section),
  );
  const [override, setOverride] = useState<{ path: string; open: boolean } | null>(null);
  const open = isGroupOpen(expanded, pathname, active, override);
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const currentChild = open ? children.find((child) => matchesChild(pathname, child)) : undefined;
  function activate(event: MouseEvent<HTMLAnchorElement>): void {
    if (!isPrimaryClick(event)) return;
    onNavigate?.();
  }
  const content = (
    <>
      <span className={styles.navIconFrame} aria-hidden="true">
        <item.Icon className={styles.navIcon} size={16} />
      </span>
      <span
        aria-hidden={!expanded}
        className={styles.sidebarCopy}
        data-sidebar-copy-state={expanded ? "expanded" : "collapsed"}
      >
        {item.label}
      </span>
    </>
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        if (value && !expanded) onRequestExpand?.();
        setOverride({ path: pathname, open: value });
      }}
      className={styles.menuGroup}
      data-sidebar-branch={hasChildren ? true : undefined}
    >
      <div className={styles.navRow}>
        <SidebarLinkTooltip expanded={expanded} label={item.label} rtl={rtl}>
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-current={active && currentChild === undefined ? "page" : undefined}
                className={styles.navItem}
                data-expanded={expanded}
                data-active={active}
              >
                {content}
                {expanded && (
                  <FinanceNavGlyph
                    name="chevron-down"
                    size={12}
                    className={open ? styles.disclosureIconExpanded : styles.disclosureIcon}
                  />
                )}
              </button>
            </CollapsibleTrigger>
          ) : (
            <Link
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              aria-label={expanded ? undefined : item.label}
              className={styles.navItem}
              data-expanded={expanded}
              data-active={active}
              onClick={activate}
            >
              {content}
            </Link>
          )}
        </SidebarLinkTooltip>
      </div>
      {hasChildren && (
        <CollapsibleContent
          forceMount
          className={styles.subnav}
          data-expanded={open}
          aria-hidden={!open}
          inert={!open}
        >
          {children.map((child) => {
            const activeChild = matchesChild(pathname, child);
            return (
              <Link
                key={child.href}
                href={child.href}
                prefetch={false}
                tabIndex={open ? undefined : -1}
                className={styles.subnavLink}
                data-active={activeChild}
                aria-current={child === currentChild ? "page" : undefined}
                onClick={(event) => {
                  if (isPrimaryClick(event)) onNavigate?.();
                }}
              >
                {child.label}
              </Link>
            );
          })}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
