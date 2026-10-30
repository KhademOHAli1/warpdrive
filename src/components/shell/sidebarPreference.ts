import { NAV_PREF_COOKIE } from "@/constants/cookies";

// Keep the existing server-readable preference so adopting Finance OS does not reset a choice.
export function readSidebarPreference(): boolean | null {
  try {
    for (const part of document.cookie.split(";")) {
      const [key, value] = part.trim().split("=");
      if (key === NAV_PREF_COOKIE) return value === "1" ? true : value === "0" ? false : null;
    }
  } catch {
    // Persistence is optional in restricted browser environments.
  }
  return null;
}

export function writeSidebarPreference(expanded: boolean): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Preserve the synchronous, server-readable navigation preference.
    document.cookie = `${NAV_PREF_COOKIE}=${expanded ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // The current-page choice still works when cookies are unavailable.
  }
}
