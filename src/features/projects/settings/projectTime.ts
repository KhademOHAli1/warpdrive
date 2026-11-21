import { instantCivilDate } from "@/lib/zonedDateTime";

export function projectToday(timeZone = "UTC", now = new Date()) {
  return instantCivilDate(now, timeZone);
}
