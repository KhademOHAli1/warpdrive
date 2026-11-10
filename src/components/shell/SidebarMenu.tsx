"use client";

import { BriefcaseBusiness, Folders, GitBranch, LayoutDashboard } from "lucide-react";
import { usePathname } from "next/navigation";
import { DOCS_SITE_URL } from "@/constants/docs";
import type { NavKey } from "@/constants/nav";
import { useAppTranslations, useMessages } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import {
  ActivitiesIcon,
  ContactsIcon,
  DocsIcon,
  InboxIcon,
  LeadsIcon,
  SettingsIcon,
} from "./NavIcons";
import { type SidebarChild, SidebarMenuItem } from "./SidebarMenuItem";
import { SidebarToggle } from "./SidebarToggle";
import { useWorkspaceNavigation } from "./WorkspaceShellProvider";

const ICONS: Record<NavKey, typeof ActivitiesIcon> = {
  dashboard: LayoutDashboard,
  work: BriefcaseBusiness,
  projects: Folders,
  leads: LeadsIcon,
  contacts: ContactsIcon,
  activities: ActivitiesIcon,
  inbox: InboxIcon,
  settings: SettingsIcon,
  workflows: GitBranch,
};

export function SidebarMenu({
  expanded,
  onNavigate,
  onToggle,
  mobile = false,
}: {
  expanded: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const navItems = useWorkspaceNavigation();
  const messages = useMessages();
  const t = useAppTranslations("shell.sidebar");
  const activities = useAppTranslations("activities");
  function children(key: NavKey): SidebarChild[] | undefined {
    if (key === "contacts")
      return [
        { href: "/contacts/people", label: messages.nav.people },
        { href: "/contacts/orgs", label: messages.nav.orgs },
        { href: "/contacts/timeline", label: messages.nav.contactsTimeline },
      ];
    if (key === "activities")
      return [
        { href: "/activities/list", label: activities("list") },
        { href: "/activities/calendar", label: activities("calendar") },
      ];
    return undefined;
  }
  function menuItem(item: (typeof navItems)[number]) {
    return (
      <SidebarMenuItem
        key={item.key}
        item={{
          ...item,
          label: messages.nav[item.key],
          Icon: ICONS[item.key],
          children: children(item.key),
        }}
        pathname={pathname}
        expanded={expanded}
        onNavigate={onNavigate}
      />
    );
  }
  const docs = (
    <a
      href={DOCS_SITE_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={messages.nav.docs}
      className={cn(
        styles.navItem,
        styles.navItemInactive,
        expanded ? styles.navItemOpen : styles.navItemCollapsed,
      )}
    >
      <span aria-hidden="true" className={styles.navIconFrame}>
        <DocsIcon size={20} className={styles.navIcon} />
      </span>
      <span
        className={styles.sidebarCopy}
        data-sidebar-copy-state={expanded ? "expanded" : "collapsed"}
      >
        {messages.nav.docs}
      </span>
    </a>
  );
  return (
    <div className={cn(styles.sidebarBody, !expanded && styles.sidebarBodyCollapsed)}>
      <nav
        id={mobile ? "mobile-primary-navigation" : "primary-navigation"}
        aria-label={messages.navigation.primary}
        className={styles.nav}
      >
        <div className={styles.workspaceNav}>
          <p className={styles.sidebarSectionTitle} aria-hidden={!expanded}>
            {t("section")}
          </p>
          <div className={cn(styles.menuList, !expanded && styles.menuListCollapsed)}>
            {navItems
              .filter((item) => item.key !== "settings" && item.key !== "workflows")
              .map(menuItem)}
          </div>
        </div>
        <div className={styles.utilityNav}>
          {expanded && (
            <>
              {navItems.filter((item) => item.key === "settings").map(menuItem)}
              {navItems.filter((item) => item.key === "workflows").map(menuItem)}
              {docs}
            </>
          )}
          {!mobile && onToggle !== undefined && (
            <div className={styles.sidebarToggleDock}>
              <SidebarToggle expanded={expanded} onToggle={onToggle} />
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
