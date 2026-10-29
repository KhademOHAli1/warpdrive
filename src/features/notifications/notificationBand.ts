import { instantCivilDate } from "@/lib/zonedDateTime";

// Compare civil days in one validated viewer zone, using one clock for the whole feed.
export function notificationBand(createdAt: Date, now: Date, timeZone = "UTC"): "today" | "earlier" {
  return instantCivilDate(createdAt, timeZone) >= instantCivilDate(now, timeZone) ? "today" : "earlier";
}
