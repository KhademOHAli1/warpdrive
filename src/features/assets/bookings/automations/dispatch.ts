import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import { lockAssetRegister } from "../../service";
import { assetBookingHandoverAllocations, assetBookingHandovers } from "../handover/schema";
import { assetBookings } from "../schema";
import { readBookingRoles } from "../scope";
import type { BookingAutomationOutcome, BookingAutomationReason } from "./contracts";
import {
  assetBookingAutomationAttempts as attempts,
  type BookingAutomationAttemptRow,
  type BookingAutomationRunRow,
  assetBookingAutomationProfiles as profiles,
  assetBookingAutomationRuns as runs,
} from "./schema";

export type BookingAutomationDeliveryGate = (
  run: Readonly<Pick<BookingAutomationRunRow, "id" | "siteId" | "bookingId" | "trigger">>,
) => "temporary" | null | Promise<"temporary" | null>;

const batchSize = 25;

async function currentRecipient(tx: Db, recipientId: string | null, siteId: string) {
  if (recipientId === null) return false;
  const [recipient] = await tx
    .select({ admin: users.isAdmin })
    .from(users)
    .where(
      and(
        eq(users.id, recipientId),
        eq(users.isActive, true),
        eq(users.projectsGuestOnly, false),
        sql`${users.invitedAt} IS NULL`,
      ),
    );
  if (recipient === undefined) return false;
  if (recipient.admin) return true;
  const role = (await readBookingRoles(tx, recipientId)).get(siteId);
  return role === "manager" || role === "base" || role === "self_service";
}

async function staleReason(
  tx: Db,
  run: BookingAutomationRunRow,
): Promise<Exclude<BookingAutomationReason, "temporary"> | null> {
  // Keep both the deadline and the rule activation in PostgreSQL's exact timestamp precision.
  const facts = await tx.execute<{ rule_enabled: boolean; source_current: boolean }>(sql`
    SELECT COALESCE(CASE r.trigger
      WHEN 'request_sent_back' THEN p.sent_back_enabled_at <= r.scheduled_at
      WHEN 'return_overdue' THEN p.overdue_enabled_at <= r.due_at
      WHEN 'pickup_expired' THEN p.pickup_expired_enabled_at <= r.due_at
    END, false) AS rule_enabled,
      NOT s.archived AND NOT b.archived AND b.requester_id IS NOT DISTINCT FROM r.recipient_id
      AND CASE r.trigger
        WHEN 'request_sent_back' THEN b.status = 'draft' AND b.version = r.source_version
        WHEN 'return_overdue' THEN b.status = 'confirmed' AND b.end_at = r.due_at
          AND b.end_at <= clock_timestamp() AND EXISTS (
            SELECT 1 FROM ${assetBookingHandoverAllocations} a
            WHERE a.site_id = b.site_id AND a.booking_id = b.id AND a.outstanding > 0
          )
        WHEN 'pickup_expired' THEN b.status = 'confirmed' AND b.end_at = r.due_at
          AND b.end_at <= clock_timestamp() AND NOT EXISTS (
            SELECT 1 FROM ${assetBookingHandoverAllocations} a
            WHERE a.site_id = b.site_id AND a.booking_id = b.id
          ) AND NOT EXISTS (
            SELECT 1 FROM ${assetBookingHandovers} h
            WHERE h.site_id = b.site_id AND h.booking_id = b.id AND h.pickup_closed
          )
        ELSE false
      END AS source_current
    FROM ${runs} r
    JOIN ${assetBookings} b ON b.site_id = r.site_id AND b.id = r.booking_id
    JOIN ${directorySites} s ON s.id = r.site_id
    JOIN ${profiles} p ON p.site_id = r.site_id AND p.principal_id = r.principal_id
    WHERE r.site_id = ${run.siteId} AND r.id = ${run.id}
  `);
  const [fact] = facts.rows;
  if (fact === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking automation lost its pinned source");
  if (!fact.rule_enabled) return "rule_disabled";
  if (!fact.source_current) return "superseded";
  return (await currentRecipient(tx, run.recipientId, run.siteId)) ? null : "recipient_unavailable";
}

function postgresLockTimeout(error: unknown) {
  let cause = error;
  for (let depth = 0; depth < 5 && typeof cause === "object" && cause !== null; depth++) {
    if ("code" in cause && cause.code === "55P03") return true;
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return false;
}

type AttemptIdentity = Pick<
  BookingAutomationAttemptRow,
  "siteId" | "runId" | "ordinal" | "actorId"
>;

async function insertAttempt(
  tx: Db,
  identity: AttemptIdentity,
  outcome: BookingAutomationOutcome,
  reason: BookingAutomationReason | null,
) {
  const [attempt] = await tx
    .insert(attempts)
    .values({ ...identity, at: sql`clock_timestamp()`, outcome, reason })
    .returning();
  if (attempt === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Booking automation attempt was not recorded");
  return attempt;
}

/** The caller holds the Asset write fence and qualifies either pending work or the exact failed attempt. */
export async function appendBookingAutomationAttempt(
  tx: Db,
  run: BookingAutomationRunRow,
  actorId: string | null,
  signal: AbortSignal,
  gate?: BookingAutomationDeliveryGate,
): Promise<BookingAutomationAttemptRow> {
  signal.throwIfAborted();
  const reason = await staleReason(tx, run);
  const [latest] = await tx
    .select({ ordinal: attempts.ordinal })
    .from(attempts)
    .where(and(eq(attempts.siteId, run.siteId), eq(attempts.runId, run.id)))
    .orderBy(desc(attempts.ordinal))
    .limit(1);
  const identity = {
    siteId: run.siteId,
    runId: run.id,
    ordinal: (latest?.ordinal ?? 0) + 1,
    actorId,
  };
  signal.throwIfAborted();
  if (reason !== null) return insertAttempt(tx, identity, "skipped", reason);

  const { id, siteId, bookingId, trigger } = run;
  if ((await gate?.({ id, siteId, bookingId, trigger })) === "temporary") {
    signal.throwIfAborted();
    return insertAttempt(tx, identity, "failed", "temporary");
  }
  signal.throwIfAborted();
  try {
    return await tx.transaction((savepoint) =>
      insertAttempt(savepoint, identity, "delivered", null),
    );
  } catch (error) {
    signal.throwIfAborted();
    if (!postgresLockTimeout(error)) throw error;
    // A contended delivery savepoint was rolled back. Retrying uses the resulting exact failure ID.
    return insertAttempt(tx, identity, "failed", "temporary");
  }
}

const duePending = and(eq(runs.state, "pending"), sql`${runs.scheduledAt} <= clock_timestamp()`);

async function dispatchPendingRun(
  db: Db,
  identity: Pick<BookingAutomationRunRow, "id" | "siteId">,
  signal: AbortSignal,
  gate?: BookingAutomationDeliveryGate,
) {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      await lockAssetRegister(tx, "write", signal);
      const [run] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, identity.id), eq(runs.siteId, identity.siteId), duePending))
        .for("update", { noWait: true });
      if (run === undefined) return false;
      await appendBookingAutomationAttempt(tx, run, null, signal, gate);
      return true;
    });
  } catch (error) {
    signal.throwIfAborted();
    if (!postgresLockTimeout(error)) throw error;
    // An unclaimed run remains pending and has no delivery attempt to record.
    return false;
  }
}

export async function dispatchBookingAutomations(
  db: Db,
  signal: AbortSignal,
  gate?: BookingAutomationDeliveryGate,
): Promise<number> {
  signal.throwIfAborted();
  const pending = await db
    .select({ id: runs.id, siteId: runs.siteId })
    .from(runs)
    .where(duePending)
    .orderBy(asc(runs.scheduledAt), asc(runs.id))
    .limit(batchSize);
  // Each attempt commits independently so later contention cannot roll back earlier deliveries.
  let completed = 0;
  for (const candidate of pending) {
    if (await dispatchPendingRun(db, candidate, signal, gate)) completed++;
  }
  signal.throwIfAborted();
  return completed;
}
