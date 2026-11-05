import { NAV_ITEMS, type NavKey } from "./nav";

const moduleFor: Partial<Record<NavKey, string>> = {
  pipeline: "sales",
  leads: "sales",
  contacts: "contacts",
  activities: "activities",
  work: "work",
};
/** Presentation only: every destination retains its own server permission checks. */
export function workspaceNavItems(modules: readonly string[], canViewWork: boolean) {
  const configured = modules.length > 0;
  return NAV_ITEMS.filter((item) => {
    if (item.key === "work" && !canViewWork) return false;
    if (!configured) return true;
    const area = moduleFor[item.key];
    return area === undefined || modules.includes(area);
  });
}
