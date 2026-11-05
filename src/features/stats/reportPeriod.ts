import { sql } from "drizzle-orm";
import type { DashboardFilters } from "@/types/stats";

// Civil midnights are converted independently: a reporting day can be 23 or 25 hours.
// Never add 24 hours to a zoned instant to find the next reporting day.
export function reportPeriod(filters: Pick<DashboardFilters, "from" | "to" | "timeZone">) {
  const timeZone = filters.timeZone ?? "UTC";
  return {
    from: sql`(${filters.from}::date::timestamp AT TIME ZONE ${timeZone})`,
    toExclusive: sql`((${filters.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})`,
  };
}
