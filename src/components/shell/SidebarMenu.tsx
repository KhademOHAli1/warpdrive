"use client";

import { GitBranch } from "lucide-react";
import { usePathname } from "next/navigation";
import { Tip } from "@/components/ui/tooltip";
import { DOCS_SITE_URL } from "@/constants/docs";
import { NAV_ITEMS, type NavKey } from "@/constants/nav";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import {
  ActivitiesIcon,
  ContactsIcon,
  DashboardIcon,
  DocsIcon,
  InboxIcon,
  LeadsIcon,
  PipelineIcon,
  SettingsIcon,
} from "./NavIcons";
import { type SidebarChild, SidebarMenuItem } from "./SidebarMenuItem";

const ICONS: Record<NavKey, typeof PipelineIcon> = {
  pipeline: PipelineIcon,
  leads: LeadsIcon,
  contacts: ContactsIcon,
  activities: ActivitiesIcon,
  inbox: InboxIcon,
  dashboard: DashboardIcon,
  settings: SettingsIcon,
  workflows: GitBranch,
};

export function SidebarMenu({
  expanded,
  onNavigate,
  mobile = false,
}: {
  expanded: boolean;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const messages = useMessages();
  const t = useAppTranslations("shell.sidebar");
  const activities = useAppTranslations("activities");
  const rtl = useLocale() === "fa";
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
        <p className={styles.sidebarSectionTitle} aria-hidden={!expanded}>
          {t("section")}
        </p>
        <div className={cn(styles.menuList, !expanded && styles.menuListCollapsed)}>
          {NAV_ITEMS.map((item) => (
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
          ))}
        </div>
        <div className={styles.docsSlot}>
          {expanded ? (
            docs
          ) : (
            <Tip
              label={messages.nav.docs}
              side={rtl ? "left" : "right"}
              className={styles.tooltip}
              delayDuration={0}
              sideOffset={10}
            >
              {docs}
            </Tip>
          )}
        </div>
      </nav>
    </div>
  );
}
