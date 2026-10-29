import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities } from "@/db/schema";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { activityDueDaySql } from "./activityDateSql";

export interface DayLoadQuery {
  userId: string;
  from: Date;
  to: Date;
  timeZone: string;
}

function toZonePostgresAccepts(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export async function getDayLoad(
  db: Db,
  query: DayLoadQuery,
  signal: AbortSignal,
): Promise<Record<string, number>> {
  signal.throwIfAborted();
  const zone = toZonePostgresAccepts(query.timeZone);
  const dueDayInZone = activityDueDaySql(zone);
  const rows = await db
    .select({ day: dueDayInZone, count: sql<number>`count(*)::int` })
    .from(activities)
    .where(
      and(
        eq(activities.assigneeId, query.userId),
        isNull(activities.deletedAt),
        isNotNull(activities.dueAt),
        sql`${dueDayInZone} >= ${instantCivilDate(query.from, zone)}`,
        sql`${dueDayInZone} < ${instantCivilDate(query.to, zone)}`,
      ),
    )
    .groupBy(sql`1`);
  signal.throwIfAborted();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.day] = row.count;
  return counts;
}
