// The primary nav, in display order. Shared by LeftNav (which renders it) and the number-key
// shortcuts (which index into it), so 1..N always addresses what the rail actually shows.
export const NAV_ITEMS = [
  { href: "/pipeline", key: "pipeline", section: "/pipeline" },
  { href: "/work", key: "work", section: "/work" },
  { href: "/activities", key: "activities", section: "/activities" },
  { href: "/inbox", key: "inbox", section: "/inbox" },
  { href: "/leads", key: "leads", section: "/leads" },
  { href: "/contacts/people", key: "contacts", section: "/contacts" },
  { href: "/dashboard", key: "dashboard", section: "/dashboard" },
  { href: "/workflows", key: "workflows", section: "/workflows" },
  // The /settings index redirects by role (admins -> company settings, everyone else -> personal
  // preferences), so a non-admin never lands on an admin-only page.
  { href: "/settings", key: "settings", section: "/settings" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export const OPEN_SIDEBAR_EVENT = "warpdrive:open-sidebar";
export const MOBILE_SIDEBAR_ID = "mobile-navigation-panel";
export const MOBILE_SIDEBAR_TRIGGER_ID = "mobile-navigation-trigger";
