import { and, asc, desc, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  operationsIncidents,
  operationsReceipts,
  operationsSources,
  operationsTransitions,
} from "@/db/schema";
import { OPERATIONS_MAX_BODY_BYTES } from "./contracts";
import { OPERATIONS_SOURCE_LIMIT } from "./storage";

export const OPERATIONS_RECEIPT_LIMIT = 256;
export const OPERATIONS_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const OPERATIONS_CLOSED_INCIDENT_LIMIT = 256;
export const OPERATIONS_TRANSITION_LIMIT = 64;
export const OPERATIONS_DELETE_CHUNK = 1000;
// Closed incident cascading deletes are <=15*(64 transitions+1 incident)=975.
const CLOSED_DELETE_CHUNK = 15;
export const OPERATIONS_MAX_RETAINED_PAYLOAD_BYTES =
  OPERATIONS_SOURCE_LIMIT * OPERATIONS_RECEIPT_LIMIT * OPERATIONS_MAX_BODY_BYTES;

async function excessTransitions(tx: Db, sourceId: string, limit: number) {
  return tx
    .select({ id: operationsTransitions.id })
    .from(operationsTransitions)
    .innerJoin(operationsIncidents, eq(operationsIncidents.id, operationsTransitions.incidentId))
    .where(
      and(
        eq(operationsIncidents.sourceId, sourceId),
        lte(
          operationsTransitions.revision,
          sql`${operationsIncidents.revision}-${OPERATIONS_TRANSITION_LIMIT}`,
        ),
      ),
    )
    .orderBy(asc(operationsTransitions.id))
    .limit(limit);
}

/** Caller owns the source lock. Every SQL delete is bounded to1000 rows; a closed
 * incident is deleted only after its transition count is already capped at64.
 * A large historical excess holds new admission, and later passes keep reclaiming.
 */
export async function pruneOperationsSourceLocked(
  tx: Db,
  sourceId: string,
  now: Date,
  signal: AbortSignal,
) {
  const cutoff = new Date(now.getTime() - OPERATIONS_RECEIPT_RETENTION_MS);
  const excess = tx
    .select({ id: operationsReceipts.id })
    .from(operationsReceipts)
    .where(eq(operationsReceipts.sourceId, sourceId))
    .orderBy(desc(operationsReceipts.ordinal))
    .offset(OPERATIONS_RECEIPT_LIMIT)
    .limit(OPERATIONS_DELETE_CHUNK);
  const receipts = await tx
    .select({ id: operationsReceipts.id })
    .from(operationsReceipts)
    .where(
      and(
        eq(operationsReceipts.sourceId, sourceId),
        or(lt(operationsReceipts.receivedAt, cutoff), inArray(operationsReceipts.id, excess)),
      ),
    )
    .orderBy(asc(operationsReceipts.receivedAt), asc(operationsReceipts.id))
    .limit(OPERATIONS_DELETE_CHUNK);
  if (receipts.length)
    await tx.delete(operationsReceipts).where(
      inArray(
        operationsReceipts.id,
        receipts.map((row) => row.id),
      ),
    );
  signal.throwIfAborted();
  const transitions = await excessTransitions(tx, sourceId, OPERATIONS_DELETE_CHUNK);
  if (transitions.length)
    await tx.delete(operationsTransitions).where(
      inArray(
        operationsTransitions.id,
        transitions.map((row) => row.id),
      ),
    );
  const remainingTransitions = await excessTransitions(tx, sourceId, 1);
  let deletedIncidents = 0;
  if (!remainingTransitions.length) {
    const incidents = await tx
      .select({ id: operationsIncidents.id })
      .from(operationsIncidents)
      .where(
        and(eq(operationsIncidents.sourceId, sourceId), isNotNull(operationsIncidents.recoveredAt)),
      )
      .orderBy(desc(operationsIncidents.updatedAt), desc(operationsIncidents.id))
      .offset(OPERATIONS_CLOSED_INCIDENT_LIMIT)
      .limit(CLOSED_DELETE_CHUNK);
    if (incidents.length) {
      await tx.delete(operationsIncidents).where(
        inArray(
          operationsIncidents.id,
          incidents.map((row) => row.id),
        ),
      );
      deletedIncidents = incidents.length;
    }
  }
  signal.throwIfAborted();
  const pressure = await tx.execute<{
    receipts: boolean;
    incidents: boolean;
    expired: boolean;
  }>(sql`SELECT
    EXISTS(SELECT 1 FROM ${operationsReceipts} WHERE ${operationsReceipts.sourceId}=${sourceId} OFFSET ${OPERATIONS_RECEIPT_LIMIT} LIMIT 1) AS receipts,
    EXISTS(SELECT 1 FROM ${operationsIncidents} WHERE ${operationsIncidents.sourceId}=${sourceId} AND ${operationsIncidents.recoveredAt} IS NOT NULL OFFSET ${OPERATIONS_CLOSED_INCIDENT_LIMIT} LIMIT 1) AS incidents,
    EXISTS(SELECT 1 FROM ${operationsReceipts} WHERE ${operationsReceipts.sourceId}=${sourceId} AND ${operationsReceipts.receivedAt}<${cutoff} LIMIT 1) AS expired`);
  const status = pressure.rows[0];
  const pressured =
    !status ||
    status.receipts ||
    status.incidents ||
    status.expired ||
    remainingTransitions.length > 0;
  await tx
    .update(operationsSources)
    .set({ admissionState: pressured ? "storage_pressure" : "ready" })
    .where(eq(operationsSources.id, sourceId));
  signal.throwIfAborted();
  return {
    deletedReceipts: receipts.length,
    deletedTransitions: transitions.length,
    deletedIncidents,
    pressured,
  };
}
