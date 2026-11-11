import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { operationsCurrent } from "@/db/schema";
import { type OperationsBatch, operationsObservationKey } from "./contracts";
import { recordOperationsIncident } from "./incidents";
import {
  operationsOrderingAt,
  projectOperationsCurrent,
  type StoredOperationsSource,
} from "./projection";

/** Caller holds the source lock and has already admitted this generation's new
 * high-water sequence. Individual older metric timestamps cannot regress facts.
 */
export async function applyOperationsCurrent(
  tx: Db,
  source: StoredOperationsSource,
  receiptId: string,
  payloadSha256: string,
  batch: OperationsBatch,
  now: Date,
  signal: AbortSignal,
) {
  let appliedObservations = 0;
  const transitions: string[] = [];
  for (const observation of batch.observations) {
    signal.throwIfAborted();
    const observationKey = operationsObservationKey(observation);
    const orderingAt = operationsOrderingAt(observation, new Date(batch.observedAtMs));
    const [previous] = await tx
      .select()
      .from(operationsCurrent)
      .where(
        and(
          eq(operationsCurrent.sourceId, source.id),
          eq(operationsCurrent.observationKey, observationKey),
        ),
      )
      .limit(1);
    if (
      previous &&
      (orderingAt.getTime() < previous.orderingAt.getTime() ||
        batch.observedAtMs < previous.batchObservedAt.getTime())
    )
      continue;
    const values = {
      sourceId: source.id,
      observationKey,
      generationId: batch.generationId,
      sequence: batch.sequence,
      receiptId,
      payloadSha256,
      observation,
      batchObservedAt: new Date(batch.observedAtMs),
      orderingAt,
      receivedAt: now,
    };
    await tx
      .insert(operationsCurrent)
      .values(values)
      .onConflictDoUpdate({
        target: [operationsCurrent.sourceId, operationsCurrent.observationKey],
        set: values,
      });
    const transition = await recordOperationsIncident(
      tx,
      projectOperationsCurrent(values, source, now),
      now,
      signal,
    );
    if (transition !== null) transitions.push(transition);
    appliedObservations++;
  }
  return { appliedObservations, transitions };
}
