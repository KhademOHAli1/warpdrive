import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  newsletterOperationalReceipts as receipts,
  newsletterOperationalState as states,
  users,
} from "@/db/schema";
import { recordAudit } from "@/features/identity/audit";
import { createNotification } from "@/features/notifications/produce";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import {
  OPERATIONAL_ENGINE_KEY,
  type OperationalEvent,
  type OperationalNotice,
  operationalEventSchema,
  operationalNoticeSchema,
  operationalOutcome,
  type ReadinessReason,
} from "./operationalContracts";

export { OPERATIONAL_ENGINE_KEY } from "./operationalContracts";
export interface HealthObservation {
  fingerprint: string;
  reason: ReadinessReason | null;
}

async function lock(tx: DbOrTx, engineKey: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  // AbortSignal cannot cancel an already-dispatched pg query. Bound real DB waits as well.
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '10s'`);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`newsletter-operations:${engineKey}`}, 0))`,
  );
  signal.throwIfAborted();
}

function action(notice: OperationalNotice): string {
  if (notice.category === "readiness")
    return notice.reason === "recovered" ? "recovered" : "unavailable";
  return {
    "delivery.failed": "rejected",
    "delivery.uncertain": "uncertain",
    "delivery.resolved": "resolved",
    "feedback.bounce": "bounce",
    "feedback.complaint": "complaint",
  }[notice.category];
}

async function recordNotice(
  tx: DbOrTx,
  notice: OperationalNotice,
  signal: AbortSignal,
): Promise<void> {
  const safe = operationalNoticeSchema.parse(notice);
  await recordAudit(
    tx,
    {
      actorId: null,
      targetType: "settings",
      targetId: null,
      action: `newsletter.delivery.${action(safe)}`,
      after: { outcome: operationalOutcome(safe), operational: safe },
      correlationId: randomUUID(),
    },
    signal,
  );
  const operators = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.isAdmin, true)))
    .orderBy(asc(users.id))
    .limit(500);
  for (const operator of operators) {
    signal.throwIfAborted();
    // The producer rehydrates and checks current newsletter authority and in-app preference.
    // Direct production stores/realtimes only; it never queues the email notification helpers.
    const result = await createNotification(
      tx,
      {
        recipientId: operator.id,
        type: "newsletter_operational",
        actorId: null,
        entityType: null,
        entityId: null,
        payload: safe,
      },
      signal,
    );
    if (!result.ok) throw result.error;
  }
}

export async function recordOperationalHealth(
  db: Db,
  observation: HealthObservation,
  signal: AbortSignal,
  engineKey = OPERATIONAL_ENGINE_KEY,
): Promise<{ changed: boolean; level: "warn" | "info" }> {
  if (!/^[a-z_/]{1,160}$/.test(observation.fingerprint))
    throw new AppError(
      ERROR_IDS.INTEGRATION_STATE_INVALID,
      "Invalid newsletter health fingerprint",
    );
  return db.transaction(async (tx) => {
    await lock(tx, engineKey, signal);
    await tx.insert(states).values({ engineKey, fingerprint: "ready" }).onConflictDoNothing();
    const [before] = await tx
      .select()
      .from(states)
      .where(eq(states.engineKey, engineKey))
      .for("update");
    if (!before)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Newsletter monitoring state unavailable");
    const warning = observation.reason !== null;
    const changed = warning
      ? !before.incidentOpen || before.problem !== observation.fingerprint
      : observation.fingerprint === "ready" && before.incidentOpen;
    if (changed)
      await recordNotice(
        tx,
        {
          category: "readiness",
          reason: observation.reason ?? "recovered",
          count: 0,
        },
        signal,
      );
    const recovered = observation.fingerprint === "ready";
    await tx
      .update(states)
      .set({
        fingerprint: observation.fingerprint,
        checkedAt: sql`clock_timestamp()`,
        incidentOpen: warning ? true : recovered ? false : before.incidentOpen,
        problem: warning ? observation.fingerprint : recovered ? null : before.problem,
      })
      .where(eq(states.engineKey, engineKey));
    signal.throwIfAborted();
    return { changed, level: warning ? "warn" : "info" };
  });
}

export async function persistOperationalEvents(
  db: Db,
  input: OperationalEvent[],
  signal: AbortSignal,
  engineKey = OPERATIONAL_ENGINE_KEY,
): Promise<number> {
  if (input.length > 100)
    throw new AppError(ERROR_IDS.INTEGRATION_STATE_INVALID, "Operational batch exceeds bound");
  const events = input.map((event) => operationalEventSchema.parse(event));
  if (new Set(events.map((event) => event.id)).size !== events.length)
    throw new AppError(ERROR_IDS.INTEGRATION_STATE_INVALID, "Duplicate operational event identity");
  return db.transaction(async (tx) => {
    await lock(tx, engineKey, signal);
    const added: OperationalEvent[] = [];
    for (const event of events) {
      signal.throwIfAborted();
      const [inserted] = await tx
        .insert(receipts)
        .values({
          engineKey,
          eventId: event.id,
          kind: event.kind,
          reason: event.reason,
          occurredAt: event.occurred_at,
        })
        .onConflictDoNothing({ target: [receipts.engineKey, receipts.eventId] })
        .returning({ id: receipts.eventId });
      if (inserted) added.push(event);
      else {
        const [existing] = await tx
          .select()
          .from(receipts)
          .where(and(eq(receipts.engineKey, engineKey), eq(receipts.eventId, event.id)));
        if (
          !existing ||
          existing.kind !== event.kind ||
          existing.reason !== event.reason ||
          existing.occurredAt !== event.occurred_at
        ) {
          throw new AppError(
            ERROR_IDS.INTEGRATION_STATE_INVALID,
            "Newsletter operational event identity changed",
          );
        }
      }
    }
    const groups = new Map<string, OperationalNotice>();
    for (const event of added) {
      const key = `${event.kind}:${event.reason}`;
      const previous = groups.get(key);
      groups.set(key, {
        category: event.kind,
        reason: event.reason,
        count: (previous?.count ?? 0) + 1,
      });
    }
    for (const notice of groups.values()) await recordNotice(tx, notice, signal);
    signal.throwIfAborted();
    return added.length;
  });
}

/** A pure event poll has completed and every returned fact is durably consumed/ACKed. */
export async function recordOperationalPoll(db: Db, signal: AbortSignal): Promise<void> {
  await db.transaction(async (tx) => {
    await lock(tx, OPERATIONAL_ENGINE_KEY, signal);
    await tx
      .insert(states)
      .values({
        engineKey: OPERATIONAL_ENGINE_KEY,
        fingerprint: "ready",
        lastPolledAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: states.engineKey,
        set: { lastPolledAt: sql`clock_timestamp()` },
      });
    signal.throwIfAborted();
  });
}
