import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { civilDateRange, instantCivilDate } from "@/lib/zonedDateTime";
import { internalProjectIntakeRequests as requests } from "./schema";

export async function retimeProjectIntakeSnoozes(
  db: Db,
  projectId: string,
  oldZone: string,
  newZone: string,
  now: Date,
) {
  const open = and(
    eq(requests.projectId, projectId),
    eq(requests.status, "snoozed"),
    isNull(requests.withdrawnAt),
    gt(requests.snoozedUntil, now),
  );
  const rows = await db
    .select({ id: requests.id, until: requests.snoozedUntil })
    .from(requests)
    .where(open);
  // The owner settings command already holds the same write lock as Intake review.
  for (const { id, until } of rows) {
    if (until === null) continue;
    const day = instantCivilDate(until, oldZone);
    const next = civilDateRange(day, day, newZone).from;
    await db
      .update(requests)
      .set({ snoozedUntil: next })
      .where(and(open, eq(requests.id, id)));
  }
}
