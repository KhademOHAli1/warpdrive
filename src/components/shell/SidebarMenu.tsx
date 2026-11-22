"use client";

import {
  Boxes,
  BriefcaseBusiness,
  ClipboardCheck,
  Folders,
  GitBranch,
  LayoutDashboard,
  Megaphone,
  Toolbox,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { DOCS_SITE_URL } from "@/constants/docs";
import type { NavKey } from "@/constants/nav";
import { auditMessages } from "@/features/assets/audits/ui/messages";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { campaignNavigation } from "@/features/newsletter/ui/navigation";
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
import { useWorkspaceNavigation, useWorkspaceShell } from "./WorkspaceShellProvider";

const FRONTEND_VERSION = "1.9.1";

const ICONS: Record<NavKey, typeof ActivitiesIcon> = {
  dashboard: LayoutDashboard,
  work: BriefcaseBusiness,
  projects: Folders,
  inventory: Boxes,
  assets: Toolbox,
  equipmentAudits: ClipboardCheck,
  leads: LeadsIcon,
  contacts: ContactsIcon,
  activities: ActivitiesIcon,
  inbox: InboxIcon,
  settings: SettingsIcon,
  workflows: GitBranch,
  campaigns: Megaphone,
};

export function SidebarMenu({
  expanded,
  pinnedExpanded = expanded,
  onNavigate,
  onToggle,
  onRequestExpand,
  mobile = false,
}: {
  expanded: boolean;
  pinnedExpanded?: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
  onRequestExpand?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const navItems = useWorkspaceNavigation();
  const messages = useMessages();
  const t = useAppTranslations("shell.sidebar");
  const activities = useAppTranslations("activities");
  const { campaignCapabilities } = useWorkspaceShell();
  const locale = useLocale();
  const campaignNav = campaignNavigation(locale, campaignCapabilities);
  const campaign = navItems.find((item) => item.key === "campaigns");
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
    if (key === "campaigns") return campaignNav.items;
    return undefined;
  }
  function menuItem(item: (typeof navItems)[number]) {
    return (
      <SidebarMenuItem
        key={item.key}
        item={{
          ...item,
          label:
            item.key === "equipmentAudits" ? auditMessages[locale].title : messages.nav[item.key],
          Icon: ICONS[item.key],
          children: children(item.key),
        }}
        pathname={pathname}
        expanded={expanded}
        onRequestExpand={onRequestExpand}
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
      className={styles.navItem}
      data-expanded={expanded}
    >
      <span aria-hidden="true" className={styles.navIconFrame}>
        <DocsIcon size={16} className={styles.navIcon} />
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
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") onRequestExpand?.();
        }}
      >
        <div className={styles.workspaceNav}>
          <p className={styles.sidebarSectionTitle} aria-hidden={!expanded}>
            {t("section")}
          </p>
          <div className={styles.menuList}>
            {navItems
              .filter(
                (item) =>
                  item.key !== "settings" && item.key !== "workflows" && item.key !== "campaigns",
              )
              .map(menuItem)}
          </div>
          {campaign && (
            <>
              <p className={styles.sidebarSectionTitle} aria-hidden={!expanded}>
                {campaignNav.actions}
              </p>
              <div className={styles.menuList}>{menuItem(campaign)}</div>
            </>
          )}
        </div>
        {expanded && (
          <div className={styles.utilityNav}>
            {navItems.filter((item) => item.key === "settings").map(menuItem)}
            {navItems.filter((item) => item.key === "workflows").map(menuItem)}
            {docs}
          </div>
        )}
      </nav>
      {!mobile && onToggle !== undefined && (
        <div className={styles.sidebarToggleDock}>
          <SidebarToggle expanded={pinnedExpanded} onToggle={onToggle} />
          {expanded && (
            <bdi dir="ltr" className={styles.frontendVersion}>
              {FRONTEND_VERSION}
            </bdi>
          )}
        </div>
      )}
    </div>
  );
}
