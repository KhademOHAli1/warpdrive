import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { assetBookings } from "../schema";
import type {
  BookingAutomationAttempt,
  BookingAutomationNotice,
  BookingAutomationProfile,
  BookingAutomationRun,
  BookingAutomationRunInput,
} from "./contracts";
import { bookingAutomationId } from "./inputs";
import {
  assetBookingAutomationAttempts as attempts,
  assetBookingAutomationProfiles as profiles,
  assetBookingAutomationRuns as runs,
} from "./schema";

const pageSize = 5;
const recentAttemptLimit = 19;
const cursorTime = z.iso.datetime({ precision: 6 });
type Cursor = { scheduledAt: string; id: string };

export function decodeRunCursor({
  siteId,
  status,
  cursor,
}: BookingAutomationRunInput): Cursor | null | undefined {
  if (cursor === undefined) return undefined;
  const [site, filter, at, runId, ...extra] = cursor.split("|");
  if (site !== siteId || filter !== (status ?? "all") || extra.length !== 0) return null;
  const scheduledAt = cursorTime.safeParse(at);
  const id = bookingAutomationId.safeParse(runId);
  return scheduledAt.success && id.success ? { scheduledAt: scheduledAt.data, id: id.data } : null;
}

export function bookingAutomationProfile(
  row: typeof profiles.$inferSelect | undefined,
): BookingAutomationProfile {
  if (row === undefined) return { version: 0, triggers: [] };
  const triggers: BookingAutomationProfile["triggers"] = [];
  if (row.sentBackEnabledAt !== null) triggers.push("request_sent_back");
  if (row.overdueEnabledAt !== null) triggers.push("return_overdue");
  if (row.pickupExpiredEnabledAt !== null) triggers.push("pickup_expired");
  return { version: row.version, triggers };
}

export async function readSiteAutomationProfile(tx: Db, siteId: string) {
  const [row] = await tx.select().from(profiles).where(eq(profiles.siteId, siteId));
  return row;
}

function runQuery(tx: Db) {
  return tx
    .select({
      id: runs.id,
      bookingId: runs.bookingId,
      title: assetBookings.title,
      recipientName: sql<
        string | null
      >`CASE WHEN ${assetBookings.requesterId} = ${runs.recipientId} THEN ${assetBookings.requesterName} ELSE NULL END`,
      trigger: runs.trigger,
      state: runs.state,
      scheduledAt: runs.scheduledAt,
      dueAt: runs.dueAt,
      cursorAt: sql<string>`to_char(${runs.scheduledAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(runs)
    .innerJoin(
      assetBookings,
      and(eq(runs.siteId, assetBookings.siteId), eq(runs.bookingId, assetBookings.id)),
    );
}

type RunRow = Awaited<ReturnType<typeof runQuery>>[number];

async function runAttemptHistory(tx: Db, siteId: string, ids: string[]) {
  const history = new Map<string, BookingAutomationAttempt[]>();
  if (ids.length === 0) return history;
  const exactRun = sql`a.site_id = ${siteId} AND a.run_id = requested.id`;
  const selected = sql`a.id, a.run_id, a.ordinal, a.at, a.outcome, a.reason`;
  // Keep the original attempt and the recent attempts, including the failure available for retry.
  const { rows } = await tx.execute<BookingAutomationAttempt & { runId: string }>(sql`
    SELECT chosen.id, chosen.run_id AS "runId", to_jsonb(chosen.at) #>> '{}' AS at,
      chosen.outcome, chosen.reason
    FROM unnest(ARRAY[${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]) AS requested(id)
    CROSS JOIN LATERAL (
      (SELECT ${selected} FROM ${attempts} AS a WHERE ${exactRun} ORDER BY a.ordinal LIMIT 1)
      UNION
      (SELECT ${selected} FROM ${attempts} AS a WHERE ${exactRun} ORDER BY a.ordinal DESC LIMIT ${recentAttemptLimit})
    ) AS chosen
    ORDER BY chosen.run_id, chosen.ordinal
  `);
  for (const { runId, at, ...attempt } of rows) {
    const run = history.get(runId) ?? [];
    run.push({ ...attempt, at: new Date(at).toISOString() });
    history.set(runId, run);
  }
  return history;
}

function projectRun(row: RunRow, history: BookingAutomationAttempt[]): BookingAutomationRun {
  const { id, bookingId, title, recipientName, trigger, state, scheduledAt, dueAt } = row;
  const latest = history.at(-1);
  return {
    id,
    bookingId,
    title,
    recipientName,
    trigger,
    state,
    scheduledAt: scheduledAt.toISOString(),
    dueAt: dueAt?.toISOString() ?? null,
    attempts: history,
    failureId: state === "failed" && latest?.outcome === "failed" ? latest.id : null,
  };
}

export async function pageBookingAutomationRuns(
  tx: Db,
  input: BookingAutomationRunInput,
  anchor: Cursor | undefined,
) {
  const { siteId, status } = input;
  const rows = await runQuery(tx)
    .where(
      and(
        eq(runs.siteId, siteId),
        status === undefined ? undefined : eq(runs.state, status),
        anchor === undefined
          ? undefined
          : sql`(${runs.scheduledAt}, ${runs.id}) < (${anchor.scheduledAt}::timestamptz, ${anchor.id}::uuid)`,
      ),
    )
    .orderBy(desc(runs.scheduledAt), desc(runs.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const history = await runAttemptHistory(
    tx,
    siteId,
    page.map(({ id }) => id),
  );
  const last = page.at(-1);
  return {
    runs: page.map((run) => projectRun(run, history.get(run.id) ?? [])),
    nextCursor:
      rows.length > pageSize && last !== undefined
        ? [siteId, status ?? "all", last.cursorAt, last.id].join("|")
        : null,
  };
}

export async function projectBookingAutomationRun(tx: Db, siteId: string, id: string) {
  const [row] = await runQuery(tx).where(and(eq(runs.siteId, siteId), eq(runs.id, id)));
  if (row === undefined) return null;
  const history = await runAttemptHistory(tx, siteId, [id]);
  return projectRun(row, history.get(id) ?? []);
}

/** The caller still holds the exact booking read scope. */
export async function readDeliveredBookingNotices(
  tx: Db,
  siteId: string,
  bookingId: string,
  recipientId: string,
): Promise<BookingAutomationNotice[]> {
  const rows = await tx
    .select({
      id: runs.id,
      bookingId: runs.bookingId,
      trigger: runs.trigger,
      dueAt: runs.dueAt,
      deliveredAt: attempts.at,
    })
    .from(runs)
    .innerJoin(attempts, and(eq(attempts.siteId, runs.siteId), eq(attempts.runId, runs.id)))
    .where(
      and(
        eq(runs.siteId, siteId),
        eq(runs.bookingId, bookingId),
        eq(runs.recipientId, recipientId),
        eq(runs.state, "delivered"),
        eq(attempts.outcome, "delivered"),
      ),
    )
    .orderBy(desc(attempts.at), desc(runs.id));
  return rows.map(({ deliveredAt, dueAt, ...notice }) => ({
    ...notice,
    deliveredAt: deliveredAt.toISOString(),
    dueAt: dueAt?.toISOString() ?? null,
  }));
}
