import { type SQL, sql } from "drizzle-orm";
import { activities } from "@/db/schema/activities";
import { instantCivilDate } from "@/lib/zonedDateTime";
// Canonical all-day dates never shift with the viewing zone. Old all-day placeholders use the
// same explicit compatibility projection as activityDay; timed midnight remains a timed instant.
export function activityDueDaySql(zone: string): SQL<string> {
  return sql<string>`case when ${activities.allDay} and ${activities.dueDate} is not null then ${activities.dueDate}::text else to_char(${activities.dueAt} at time zone ${zone}::text,'YYYY-MM-DD') end`;
}
export function activityWindowSql(range: { from: Date; to: Date }, zone: string): SQL {
  const fromDay = instantCivilDate(range.from, zone),
    toDay = instantCivilDate(range.to, zone);
  return sql`((${activities.allDay} and ${activities.dueDate} is not null and ${activities.dueDate} < ${toDay}::date and coalesce(${activities.endDate},${activities.dueDate}) >= ${fromDay}::date) or ((not ${activities.allDay} or ${activities.dueDate} is null) and ${activities.dueAt} < ${range.to} and coalesce(${activities.endAt},${activities.dueAt}) >= ${range.from}))`;
}
