export const WORKSPACE_NAV_ITEMS = [
  {
    href: "/pipeline",
    key: "dashboard",
    section: "/pipeline",
    additionalSections: ["/dashboard"],
  },
  { href: "/activities", key: "activities", section: "/activities" },
  { href: "/leads", key: "leads", section: "/leads" },
  { href: "/inbox", key: "inbox", section: "/inbox" },
  { href: "/contacts/people", key: "contacts", section: "/contacts" },
] as const;

export const UTILITY_NAV_ITEMS = [
  // The /settings index redirects by role (admins -> company settings, everyone else -> personal
  // preferences), so a non-admin never lands on an admin-only page.
  { href: "/settings", key: "settings", section: "/settings" },
  { href: "/workflows", key: "workflows", section: "/workflows" },
] as const;

// Keyboard shortcuts follow the same order as the visible workspace and utility groups.
export const NAV_ITEMS = [...WORKSPACE_NAV_ITEMS, ...UTILITY_NAV_ITEMS] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export const OPEN_SIDEBAR_EVENT = "warpdrive:open-sidebar";
export const MOBILE_SIDEBAR_ID = "mobile-navigation-panel";
export const MOBILE_SIDEBAR_TRIGGER_ID = "mobile-navigation-trigger";
