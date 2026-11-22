import { and, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_BOOKING_HANDOVER_NOTICE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import { lockAssetRegister } from "../../service";
import { dispatchBookingAutomations } from "../automations/dispatch";
import { assetBookings } from "../schema";
import type { BookingHandoverNotice } from "./contracts";
import {
  assetBookingHandoverAllocations as allocations,
  assetBookingHandoverNoticeEpoch as epoch,
  assetBookingHandovers as handovers,
  assetBookingHandoverNotices as notices,
} from "./schema";

const batchSize = 100;

/** Called after authorizing a read of the exact booking in its current site. */
export async function readBookingHandoverNotices(
  tx: Db,
  bookingId: string,
  siteId: string,
  dueAt: string,
): Promise<BookingHandoverNotice[]> {
  const rows = await tx
    .select({ kind: notices.kind, at: notices.at, dueAt: notices.dueAt })
    .from(notices)
    .where(
      and(
        eq(notices.bookingId, bookingId),
        eq(notices.siteId, siteId),
        eq(notices.dueAt, new Date(dueAt)),
      ),
    )
    .orderBy(notices.at, notices.kind);
  return rows.map(({ kind, at, dueAt }) => {
    const deadline = dueAt.toISOString();
    return { id: `${bookingId}:${kind}:${deadline}`, kind, at: at.toISOString(), dueAt: deadline };
  });
}

/** One tick records active notices for current deadlines under the same fence as handovers. */
export async function recordBookingHandoverNotices(db: Db, signal: AbortSignal): Promise<number> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    await lockAssetRegister(tx, "write", signal);
    const result = await tx.execute(sql`
      WITH tick AS MATERIALIZED (
        SELECT clock_timestamp() AS at
      ), candidates AS (
        SELECT b.id AS booking_id, b.site_id, b.end_at AS due_at, tick.at,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM ${allocations} a
              WHERE a.booking_id = b.id AND a.site_id = b.site_id AND a.outstanding > 0
            ) THEN 'overdue'
            WHEN b.end_at >= e.active_at AND NOT coalesce(h.pickup_closed, false) AND NOT EXISTS (
              SELECT 1 FROM ${allocations} a
              WHERE a.booking_id = b.id AND a.site_id = b.site_id
            ) THEN 'expired'
          END AS kind
        FROM ${assetBookings} b
        JOIN ${directorySites} s ON s.id = b.site_id AND NOT s.archived
        LEFT JOIN ${handovers} h ON h.booking_id = b.id AND h.site_id = b.site_id
        CROSS JOIN tick
        CROSS JOIN ${epoch} e
        WHERE e.id AND b.status = 'confirmed' AND NOT b.archived AND b.end_at <= tick.at
          AND (b.end_at >= e.active_at OR h.booking_id IS NOT NULL)
      )
      INSERT INTO ${notices} (booking_id, site_id, due_at, at, kind)
      SELECT c.booking_id, c.site_id, c.due_at, c.at, c.kind
      FROM candidates c
      WHERE c.kind IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${notices} n
        WHERE n.booking_id = c.booking_id AND n.due_at = c.due_at AND n.kind = c.kind
      )
      ORDER BY c.due_at, c.booking_id
      LIMIT ${batchSize}
      ON CONFLICT (booking_id, due_at, kind) DO NOTHING
      RETURNING booking_id
    `);
    return result.rows.length;
  });
}

export async function registerBookingHandoverNoticeWorker(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_BOOKING_HANDOVER_NOTICE);
  await boss.work(PGBOSS_QUEUE_BOOKING_HANDOVER_NOTICE, async () => {
    await recordBookingHandoverNotices(db, AbortSignal.timeout(25_000));
    await dispatchBookingAutomations(db, AbortSignal.timeout(25_000));
  });
  await boss.schedule(PGBOSS_QUEUE_BOOKING_HANDOVER_NOTICE, "* * * * *");
}
